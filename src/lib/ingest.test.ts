import { describe, expect, it } from "vitest";
import { parseAgentPayload } from "./ingest";

// A realistic agent.payload — mirrors what agent.sh actually POSTs,
// including a locally-built image with no RepoDigest (so image_digest / null)
// and containers without a healthcheck.
const REAL_SAMPLE = {
  hostname: "web-prod-01",
  label: "frontend fleet",
  os: { name: "Ubuntu", version: "24.04 LTS", kernel: "6.8.0-45-generic" },
  collected_at: "2026-08-18T10:54:00Z",
  packages: [
    {
      name: "nginx",
      installed: "1.24.0-2ubuntu7.1",
      available: "1.24.0-2ubuntu7.2",
      security: false,
      cve_ids: [],
    },
  ],
  docker: {
    engine_version: "27.4.1",
    api_version: "1.47",
    deprecated: false,
    containers_running: 3,
    containers_total: 4,
  },
  containers: [
    {
      container_id: "abc123",
      name: "web",
      image: "nginx:1.27.3",
      image_tag: "1.27.3",
      image_digest:
        "sha256:9f2c3d1e4b5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c",
      status: "running",
      health_status: "healthy",
      restart_count: 0,
      created_at: "2026-05-01T10:00:00Z",
      age_days: 109.5,
      is_unpinned_latest: false,
    },
    // Locally-built image, no RepoDigest -> image_digest can be "" / null.
    {
      container_id: "def456",
      name: "local-app",
      image: "my-local/app:1.0.0",
      image_tag: "1.0.0",
      image_digest: null,
      status: "running",
      health_status: null,
      restart_count: 1,
      created_at: "2026-08-10T10:00:00Z",
      age_days: 8.0,
      is_unpinned_latest: false,
    },
    // No healthcheck configured -> health_status can be "" / null.
    {
      container_id: "ghi789",
      name: "prom",
      image: "prom/prometheus:latest",
      image_tag: "latest",
      image_digest: "",
      status: "restarting",
      health_status: "",
      restart_count: 5,
      created_at: "2026-07-01T10:00:00Z",
      age_days: 48.0,
      is_unpinned_latest: true,
    },
  ],
};

describe("parseAgentPayload", () => {
  it("accepts a realistic agent payload incl. containers", () => {
    const parsed = parseAgentPayload(REAL_SAMPLE);
    expect(parsed.hostname).toBe("web-prod-01");
    expect(parsed.containers).toHaveLength(3);
    expect(parsed.containers?.[0].image_tag).toBe("1.27.3");
  });

  it("accepts empty strings / null for optional container fields", () => {
    // This is the regression that used to fail with HTTP 422.
    const slim = parseAgentPayload({
      hostname: "minimal",
      containers: [
        {
          container_id: "abc",
          name: "web",
          image: "my-image",
          image_tag: "latest",
          image_digest: "",
          status: "running",
          health_status: "",
          restart_count: 0,
          created_at: "",
        },
      ],
    });
    expect(slim.containers?.[0].name).toBe("web");
  });

  it("rejects a non-object / empty payload", () => {
    expect(() => parseAgentPayload(null)).toThrow();
    expect(() => parseAgentPayload("garbage")).toThrow();
  });
});