import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { ensureSchema } from "./migrate";
import { getRetentionSettings } from "./settings";

/**
 * Data retention: summarise, then prune.
 *
 * A 5-minute cadence means 288 snapshots per host per day, each with a full
 * `raw_payload` JSONB plus a row per package and per container. Nothing ever
 * removed them, so a modest fleet would quietly consume gigabytes a year.
 *
 * The order matters: a day is only ever pruned *after* it has been rolled up,
 * so trends survive even though the underlying rows do not.
 */

export interface RetentionResult {
  rolledUpDays: number;
  deletedSnapshots: number;
  deletedMetrics: number;
  deletedHeartbeats: number;
  deletedCheckResults: number;
  deletedRollups: number;
}

/**
 * Builds (or refreshes) daily rollups for every day that is complete and not
 * yet older than the rollup horizon.
 *
 * `ON CONFLICT DO UPDATE` makes this idempotent, so a re-run after a partial
 * failure simply recomputes the same numbers.
 */
async function buildRollups(rawDays: number, rollupDays: number): Promise<number> {
  const db = getDb();

  // Re-derive a small trailing window rather than the whole history: days
  // older than the raw window have no raw rows left to summarise anyway.
  const result = await db.execute<{ host_id: number }>(sql`
    with days as (
      select
        m.host_id,
        (m.collected_at at time zone 'UTC')::date as day,
        avg(m.cpu_pct)                            as cpu_pct_avg,
        max(m.cpu_pct)                            as cpu_pct_max,
        avg(
          case when m.mem_total_bytes > 0
               then (m.mem_used_bytes::float / m.mem_total_bytes) * 100 end
        )                                         as mem_used_pct_avg,
        max(
          case when m.mem_total_bytes > 0
               then (m.mem_used_bytes::float / m.mem_total_bytes) * 100 end
        )                                         as mem_used_pct_max,
        (
          select max(d.use_pct)
          from disk_usage d
          join host_metrics m2 on m2.id = d.metric_id
          where m2.host_id = m.host_id
            and (m2.collected_at at time zone 'UTC')::date
                = (m.collected_at at time zone 'UTC')::date
        )                                         as disk_use_pct_max,
        count(*)                                  as sample_count
      from host_metrics m
      where m.collected_at >= now() - make_interval(days => ${rawDays + 2})
        and m.collected_at <  date_trunc('day', now())
      group by 1, 2
    ),
    pkg as (
      -- Latest snapshot of each day carries that day's package position.
      select distinct on (s.host_id, (s.collected_at at time zone 'UTC')::date)
        s.host_id,
        (s.collected_at at time zone 'UTC')::date as day,
        (select count(*) from packages p
          where p.snapshot_id = s.id and p.available_version is not null) as outdated,
        (select count(*) from packages p
          where p.snapshot_id = s.id and p.is_security_update)            as security,
        (select di.containers_running from docker_info di
          where di.snapshot_id = s.id limit 1)                            as running,
        (select di.containers_total from docker_info di
          where di.snapshot_id = s.id limit 1)                            as total
      from snapshots s
      where s.collected_at >= now() - make_interval(days => ${rawDays + 2})
        and s.collected_at <  date_trunc('day', now())
      order by s.host_id, 2, s.collected_at desc
    ),
    down as (
      select
        e.host_id,
        g.day::date as day,
        sum(
          extract(epoch from (
            least(coalesce(e.ended_at, now()), g.day + interval '1 day')
            - greatest(e.started_at, g.day)
          ))
        )::int as downtime_sec
      from downtime_events e
      join lateral generate_series(
        date_trunc('day', e.started_at),
        date_trunc('day', coalesce(e.ended_at, now())),
        interval '1 day'
      ) as g(day) on true
      where g.day >= date_trunc('day', now() - make_interval(days => ${rawDays + 2}))
        and g.day <  date_trunc('day', now())
      group by 1, 2
    )
    insert into host_daily_rollup (
      host_id, day, uptime_pct, downtime_sec,
      outdated_packages, security_packages,
      containers_running, containers_total,
      cpu_pct_avg, cpu_pct_max, mem_used_pct_avg, mem_used_pct_max,
      disk_use_pct_max, sample_count
    )
    select
      coalesce(d.host_id, p.host_id, dn.host_id),
      coalesce(d.day, p.day, dn.day),
      greatest(0, 100 - (coalesce(dn.downtime_sec, 0)::float / 864)),
      coalesce(dn.downtime_sec, 0),
      p.outdated, p.security, p.running, p.total,
      d.cpu_pct_avg, d.cpu_pct_max, d.mem_used_pct_avg, d.mem_used_pct_max,
      d.disk_use_pct_max, coalesce(d.sample_count, 0)
    from days d
    full outer join pkg p on p.host_id = d.host_id and p.day = d.day
    full outer join down dn
      on dn.host_id = coalesce(d.host_id, p.host_id)
     and dn.day = coalesce(d.day, p.day)
    where coalesce(d.host_id, p.host_id, dn.host_id) is not null
    on conflict (host_id, day) do update set
      uptime_pct        = excluded.uptime_pct,
      downtime_sec      = excluded.downtime_sec,
      outdated_packages = coalesce(excluded.outdated_packages, host_daily_rollup.outdated_packages),
      security_packages = coalesce(excluded.security_packages, host_daily_rollup.security_packages),
      containers_running = coalesce(excluded.containers_running, host_daily_rollup.containers_running),
      containers_total   = coalesce(excluded.containers_total, host_daily_rollup.containers_total),
      cpu_pct_avg       = coalesce(excluded.cpu_pct_avg, host_daily_rollup.cpu_pct_avg),
      cpu_pct_max       = coalesce(excluded.cpu_pct_max, host_daily_rollup.cpu_pct_max),
      mem_used_pct_avg  = coalesce(excluded.mem_used_pct_avg, host_daily_rollup.mem_used_pct_avg),
      mem_used_pct_max  = coalesce(excluded.mem_used_pct_max, host_daily_rollup.mem_used_pct_max),
      disk_use_pct_max  = coalesce(excluded.disk_use_pct_max, host_daily_rollup.disk_use_pct_max),
      sample_count      = greatest(excluded.sample_count, host_daily_rollup.sample_count)
    returning host_id
  `);

  // Drop rollups past the long horizon.
  await db.execute(sql`
    delete from host_daily_rollup
    where day < (now() - make_interval(days => ${rollupDays}))::date
  `);

  return result.rowCount ?? 0;
}

/**
 * Runs a full retention pass. Safe to call repeatedly; each step is a bounded
 * delete, so a long-neglected instance catches up over successive runs rather
 * than issuing one enormous statement.
 */
export async function runRetention(): Promise<RetentionResult> {
  await ensureSchema();
  const db = getDb();
  const { rawDays, rollupDays } = await getRetentionSettings();

  const rolledUpDays = await buildRollups(rawDays, rollupDays);

  // Deleting snapshots cascades to packages, docker_info, containers and the
  // host_metrics rows that reference them; disk_usage cascades from those.
  const snaps = await db.execute(sql`
    delete from snapshots
    where id in (
      select id from snapshots
      where collected_at < now() - make_interval(days => ${rawDays})
      limit 20000
    )
  `);

  // Metrics not tied to a snapshot (defensive — ingest always links them).
  const metrics = await db.execute(sql`
    delete from host_metrics
    where id in (
      select id from host_metrics
      where collected_at < now() - make_interval(days => ${rawDays})
      limit 20000
    )
  `);

  const checkRows = await db.execute(sql`
    delete from check_results
    where id in (
      select id from check_results
      where ran_at < now() - make_interval(days => ${rawDays})
      limit 20000
    )
  `);

  const heartbeats = await db.execute(sql`
    delete from heartbeats
    where id in (
      select id from heartbeats
      where received_at < now() - make_interval(days => ${rawDays})
      limit 50000
    )
  `);

  const result: RetentionResult = {
    rolledUpDays,
    deletedSnapshots: snaps.rowCount ?? 0,
    deletedMetrics: metrics.rowCount ?? 0,
    deletedHeartbeats: heartbeats.rowCount ?? 0,
    deletedCheckResults: checkRows.rowCount ?? 0,
    deletedRollups: 0,
  };

  if (
    result.deletedSnapshots > 0 ||
    result.deletedMetrics > 0 ||
    result.deletedHeartbeats > 0 ||
    result.deletedCheckResults > 0
  ) {
    console.log(
      `[retention] pruned ${result.deletedSnapshots} snapshots, ` +
        `${result.deletedMetrics} metrics, ${result.deletedHeartbeats} heartbeats, ` +
        `${result.deletedCheckResults} check results ` +
        `(keeping ${rawDays}d raw, ${rollupDays}d rollups)`,
    );
  }
  return result;
}

/** Approximate on-disk size of the biggest tables, for the settings page. */
export async function getStorageStats(): Promise<
  { table: string; rows: number; size: string }[]
> {
  const db = getDb();
  const { rows } = await db.execute<{
    table_name: string;
    row_estimate: number;
    total_size: string;
  }>(sql`
    select c.relname as table_name,
           greatest(c.reltuples, 0)::bigint as row_estimate,
           pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'snapshots', 'packages', 'containers', 'host_metrics',
        'disk_usage', 'heartbeats', 'host_daily_rollup',
        'host_vulnerabilities', 'vulnerabilities', 'check_results'
      )
    order by pg_total_relation_size(c.oid) desc
  `);

  return rows.map((r) => ({
    table: r.table_name,
    rows: Number(r.row_estimate),
    size: r.total_size,
  }));
}
