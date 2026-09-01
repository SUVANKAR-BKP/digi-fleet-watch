export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // agent cadence (5 min)

/** Hosts not seen within this window are "stale". */
export const STALE_MS = 15 * 60 * 1000;

/** Hosts not seen within this window are "down". */
export const DOWN_MS = 60 * 60 * 1000;

/**
 * A downtime event is opened once a host has been silent for this long
 * (3 missed heartbeats at a 5-minute cadence). Mirrors STALE_MS.
 */
export const OPEN_DOWNTIME_AFTER_MS = STALE_MS;

/** Uptime window used for percentages and the chart. */
export const UPTIME_WINDOW_DAYS = 30;
/** Disk usage at or above this fraction raises an alert. */
export const DISK_WARN_PCT = 85;

/** Disk usage at or above this fraction is treated as critical. */
export const DISK_CRITICAL_PCT = 95;

/**
 * Disk alerts fire on a *threshold crossing*, not on every report: a host
 * sitting at 90% would otherwise alert every 5 minutes forever. The previous
 * sample is compared against the current one, mirroring how new package
 * updates and Docker deprecation are detected.
 */
