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