import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";
import { READ_HEALTHY, READ_OUTPUT } from "./fixtures";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const RUN = ["storage-health.use", "storage-health.run-tests"];

async function start(
  options: Parameters<typeof startServer>[0] = {},
): Promise<TestServer> {
  server = await startServer({ permissions: RUN, ...options });
  server.ssh.replies.push({ match: "@@root", stdout: READ_OUTPUT });
  return server;
}

describe("reading a host", () => {
  it("reads drives, pools and arrays", async () => {
    const s = await start();
    const res = await s.request("GET", "/1");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("fail");
    expect(res.body.canEdit).toBe(true);
    expect(res.body.reading.devices).toHaveLength(4);
    expect(res.body.reading.pools[0].name).toBe("tank");
    expect(res.body.reading.arrays).toHaveLength(2);
    expect(res.body.active).toContain("smart-failing|sdb");
    expect(res.body.config.intervalMin).toBe(15);
  });

  it("reuses a fresh reading and reads again on refresh", async () => {
    const s = await start();
    await s.request("GET", "/1");
    await s.request("GET", "/1");
    expect(s.ssh.calls).toHaveLength(1);
    await s.request("POST", "/1/refresh");
    expect(s.ssh.calls).toHaveLength(2);
  });

  it("sends the reader script on stdin, never as the command", async () => {
    const s = await start();
    await s.request("GET", "/1");
    expect(s.ssh.calls[0].stdin).toContain("@@root");
    expect(s.ssh.calls[0].command).not.toContain("@@root");
  });

  it("falls back to the login user when sudo is refused", async () => {
    let n = 0;
    const s = await start({
      exec: async () => {
        n += 1;
        return n === 1
          ? {
              stdout: "",
              stderr: "sudo: a password is required",
              code: 1,
              truncated: false,
              timedOut: false,
            }
          : {
              stdout: READ_HEALTHY.replace("@@root 0", "@@root 1000"),
              stderr: "",
              code: 0,
              truncated: false,
              timedOut: false,
            };
      },
    });
    const res = await s.request("GET", "/1");
    expect(res.status).toBe(200);
    expect(n).toBe(2);
    expect(res.body.reading.warnings).toContain("not-root");
  });

  it("shows the error when the host cannot be read", async () => {
    const s = await start({
      exec: async () => ({
        stdout: "",
        stderr: "ssh: connection lost",
        code: 255,
        truncated: false,
        timedOut: false,
      }),
    });
    const res = await s.request("GET", "/1");
    expect(res.status).toBe(200);
    expect(res.body.reading).toBeNull();
    expect(res.body.error).toContain("connection lost");
    expect(res.body.status).toBe("unknown");
  });

  it("is off until the host turns it on", async () => {
    const s = await start({ hostSettings: { enableStorage: false } });
    const res = await s.request("GET", "/1");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("disabled");
    expect(s.ssh.calls).toHaveLength(0);
  });

  it("hides a host the user cannot open", async () => {
    const s = await start({ level: "none" });
    expect((await s.request("GET", "/1")).status).toBe(404);
  });

  it("rejects a bad host id", async () => {
    const s = await start();
    expect((await s.request("GET", "/abc")).status).toBe(400);
  });
});

describe("summary", () => {
  it("lists watched hosts with their status", async () => {
    const s = await start();
    expect((await s.request("GET", "/summary")).body).toEqual([]);
    await s.request("GET", "/1");
    const res = await s.request("GET", "/summary");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      hostId: 1,
      status: "fail",
      drives: 4,
      hottestC: 52,
    });
    expect(res.body[0].problems).toBeGreaterThan(3);
  });
});

describe("settings", () => {
  it("saves thresholds", async () => {
    const s = await start();
    const res = await s.request("PUT", "/1/config", {
      alerts: false,
      intervalMin: 30,
      tempWarnC: 45,
    });
    expect(res.status).toBe(200);
    const after = await s.request("GET", "/1");
    expect(after.body.config).toMatchObject({
      alerts: false,
      intervalMin: 30,
      tempWarnC: 45,
      wearWarnPct: 80,
    });
    expect(after.body.active).toContain("temp-high|nvme0n1");
  });

  it("refuses values out of range", async () => {
    const s = await start();
    expect(
      (await s.request("PUT", "/1/config", { intervalMin: 1 })).status,
    ).toBe(400);
    expect(
      (await s.request("PUT", "/1/config", { wearWarnPct: 99 })).status,
    ).toBe(400);
    expect(
      (await s.request("PUT", "/1/config", { tempWarnC: "hot" })).status,
    ).toBe(400);
  });

  it("needs edit access", async () => {
    const s = await start({ level: "connect" });
    const res = await s.request("PUT", "/1/config", { intervalMin: 30 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("HOST_EDIT_REQUIRED");
    const view = await s.request("GET", "/1");
    expect(view.body.canEdit).toBe(false);
  });
});

describe("self tests and scrubs", () => {
  it("starts a self test and logs it", async () => {
    const s = await start();
    const res = await s.request("POST", "/1/selftest", {
      device: "sda",
      action: "short",
    });
    expect(res.status).toBe(200);
    const call = s.ssh.calls.find((c) => c.stdin.includes("smartctl -t short"));
    expect(call?.stdin).toContain("'/dev/sda'");
    const events = await s.request("GET", "/1/events");
    expect(events.body[0]).toMatchObject({ type: "command" });
    expect(events.body[0].text).toContain("short self test on sda");
  });

  it("refuses an unknown drive, a bad action and a drive with no SMART", async () => {
    const s = await start();
    s.ssh.replies.unshift({
      match: "@@root",
      stdout: READ_OUTPUT.replace(
        "Device is in STANDBY mode, exit(2)",
        "Unavailable - device lacks SMART capability.",
      ),
    });
    expect(
      (
        await s.request("POST", "/1/selftest", {
          device: "sdz",
          action: "short",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await s.request("POST", "/1/selftest", {
          device: "sda",
          action: "wipe",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.request("POST", "/1/selftest", {
          device: "sdc",
          action: "short",
        })
      ).status,
    ).toBe(400);
    expect(s.ssh.calls.some((c) => c.stdin.includes("smartctl -t"))).toBe(
      false,
    );
  });

  it("needs the run-tests permission", async () => {
    const s = await start({ permissions: ["storage-health.use"] });
    const res = await s.request("POST", "/1/selftest", {
      device: "sda",
      action: "short",
    });
    expect(res.status).not.toBe(200);
    expect(s.ssh.calls).toHaveLength(0);
  });

  it("needs edit access and a host that is not read only", async () => {
    const view = await start({ level: "connect" });
    expect(
      (
        await view.request("POST", "/1/selftest", {
          device: "sda",
          action: "short",
        })
      ).status,
    ).toBe(403);
    await view.close();
    server = await startServer({
      permissions: RUN,
      hostSettings: { readOnly: true },
    });
    const res = await server.request("POST", "/1/scrub", {
      target: "zfs:tank",
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("readOnly");
  });

  it("scrubs a pool, a filesystem and an array, and stops one", async () => {
    const s = await start();
    expect(
      (await s.request("POST", "/1/scrub", { target: "zfs:tank" })).status,
    ).toBe(200);
    expect(
      s.ssh.calls.some((c) => c.stdin.includes("zpool scrub 'tank'")),
    ).toBe(true);
    expect(
      (await s.request("POST", "/1/scrub", { target: "btrfs:/mnt/data" }))
        .status,
    ).toBe(200);
    expect(
      (await s.request("POST", "/1/scrub", { target: "md:md1" })).status,
    ).toBe(200);
    expect(
      (await s.request("POST", "/1/scrub", { target: "zfs:tank", stop: true }))
        .status,
    ).toBe(200);
    expect(
      s.ssh.calls.some((c) => c.stdin.includes("zpool scrub -s 'tank'")),
    ).toBe(true);
  });

  it("refuses a target that was not found on the host", async () => {
    const s = await start();
    const res = await s.request("POST", "/1/scrub", {
      target: "zfs:ghost; reboot",
    });
    expect(res.status).toBe(404);
    expect(s.ssh.calls.some((c) => c.stdin.includes("reboot"))).toBe(false);
  });
});

describe("events and history", () => {
  it("logs the problems found on the first read", async () => {
    const s = await start();
    await s.request("GET", "/1");
    const events = await s.request("GET", "/1/events");
    const types = events.body.map((e: { type: string }) => e.type);
    expect(types).toContain("smart-failing");
    expect(types).toContain("pool-degraded");
    expect(types).toContain("raid-degraded");
  });

  it("sends alerts and events for a failing drive", async () => {
    const s = await start();
    await s.request("GET", "/1");
    const sent = s.mock.notifications.map((n) => n.notification);
    const categories = sent.map((n) => n.category);
    expect(categories).toContain("storage-health.smart_failing");
    expect(categories).toContain("storage-health.pool_degraded");
    expect(categories).toContain("storage-health.raid_degraded");
    // A rebuild is logged but never alerts.
    expect(categories).not.toContain("storage-health.raid_rebuilding");
    const failing = sent.find(
      (n) => n.category === "storage-health.smart_failing",
    );
    expect(failing?.severity).toBe("critical");
    expect(failing?.title).toContain("sdb");
    expect(failing?.dedupeKey).toBe("storage-health:1:smart-failing:sdb:on");
  });

  it("alerts once for the same problem", async () => {
    const s = await start();
    await s.request("POST", "/1/refresh");
    const first = s.mock.notifications.length;
    await s.request("POST", "/1/refresh");
    expect(s.mock.notifications).toHaveLength(first);
  });

  it("does not alert when alerts are off", async () => {
    const s = await start();
    await s.request("PUT", "/1/config", { alerts: false });
    await s.request("POST", "/1/refresh");
    expect(s.mock.notifications).toHaveLength(0);
  });

  it("answers the history of a drive and needs a drive name", async () => {
    const s = await start();
    await s.request("GET", "/1");
    const res = await s.request("GET", "/1/history?device=sda&range=24h");
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(1);
    expect((await s.request("GET", "/1/history")).status).toBe(400);
  });
});
