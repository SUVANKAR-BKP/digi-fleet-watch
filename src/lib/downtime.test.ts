import { describe, expect, it } from "vitest";
import { downtimeMsInWindow, statusFor, type DowntimeInterval } from "./downtime";
import { DOWN_MS, STALE_MS } from "./thresholds";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Fixed clock so the assertions below do not drift. */
const NOW = new Date("2026-08-18T12:00:00.000Z");
const WINDOW_START = new Date(NOW.getTime() - 30 * DAY);

function ago(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

describe("downtimeMsInWindow", () => {
  it("counts an outage fully inside the window", () => {
    const events: DowntimeInterval[] = [
      { startedAt: ago(10), endedAt: new Date(ago(10).getTime() + 2 * HOUR) },
    ];
    expect(downtimeMsInWindow(events, WINDOW_START, NOW)).toBe(2 * HOUR);
  });

  it("clips an outage that began before the window to the overlapping part", () => {
    // The regression: an outage from 40 days ago that ended 10 days ago was
    // excluded entirely (it neither started inside the window nor was open),
    // so a host with 20 days of downtime reported 100% uptime.
    const events: DowntimeInterval[] = [
      { startedAt: ago(40), endedAt: ago(10) },
    ];
    expect(downtimeMsInWindow(events, WINDOW_START, NOW)).toBe(20 * DAY);
  });

  it("counts an still-open outage up to now, not beyond", () => {
    const events: DowntimeInterval[] = [{ startedAt: ago(3), endedAt: null }];
    expect(downtimeMsInWindow(events, WINDOW_START, NOW)).toBe(3 * DAY);
  });

  it("ignores an outage that ended before the window began", () => {
    const events: DowntimeInterval[] = [
      { startedAt: ago(50), endedAt: ago(45) },
    ];
    expect(downtimeMsInWindow(events, WINDOW_START, NOW)).toBe(0);
  });

  it("clips an outage older than the whole window", () => {
    const events: DowntimeInterval[] = [{ startedAt: ago(90), endedAt: null }];
    expect(downtimeMsInWindow(events, WINDOW_START, NOW)).toBe(30 * DAY);
  });

  it("sums multiple outages", () => {
    const events: DowntimeInterval[] = [
      { startedAt: ago(20), endedAt: new Date(ago(20).getTime() + HOUR) },
      { startedAt: ago(5), endedAt: new Date(ago(5).getTime() + 3 * HOUR) },
    ];
    expect(downtimeMsInWindow(events, WINDOW_START, NOW)).toBe(4 * HOUR);
  });

  it("returns zero for a host with no events", () => {
    expect(downtimeMsInWindow([], WINDOW_START, NOW)).toBe(0);
  });
});

describe("statusFor", () => {
  it("treats a host that has never reported as down", () => {
    expect(statusFor(null)).toBe("down");
  });

  it("is online inside the stale threshold", () => {
    expect(statusFor(new Date(Date.now() - STALE_MS / 2))).toBe("online");
  });

  it("is stale between the two thresholds", () => {
    expect(statusFor(new Date(Date.now() - (STALE_MS + DOWN_MS) / 2))).toBe("stale");
  });

  it("is down past the down threshold", () => {
    expect(statusFor(new Date(Date.now() - DOWN_MS - 1000))).toBe("down");
  });
});
