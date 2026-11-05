import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  applyHealth,
  conditionsOf,
  diff,
  messageFor,
  overall,
  parseKey,
} from "../../src/backend/conditions";
import { parseReading } from "../../src/backend/parsers";
import { READ_HEALTHY, READ_OUTPUT } from "./fixtures";

describe("conditions", () => {
  const reading = parseReading(READ_OUTPUT);
  const found = [...conditionsOf(reading, DEFAULT_LIMITS).keys()].sort();

  it("finds the failing and the warning drives", () => {
    expect(found).toContain("smart-failing|sdb");
    expect(found).toContain("smart-attention|sda");
    expect(found).toContain("smart-attention|sdb");
    expect(found).not.toContain("smart-failing|sda");
    expect(found.filter((k) => k.endsWith("|sdc"))).toEqual([]);
  });

  it("finds pool, array, btrfs and thin pool problems", () => {
    expect(found).toContain("pool-degraded|tank");
    expect(found).toContain("raid-degraded|md0");
    expect(found).toContain("raid-rebuilding|md0");
    expect(found).not.toContain("raid-degraded|md1");
    expect(found).toContain("btrfs-errors|/mnt/data");
    expect(found).toContain("thin-full|vg0/thinpool");
  });

  it("is quiet for a healthy drive", () => {
    const ok = parseReading(READ_HEALTHY);
    expect(conditionsOf(ok, DEFAULT_LIMITS).size).toBe(0);
    applyHealth(ok, DEFAULT_LIMITS);
    expect(overall(ok)).toBe("ok");
  });

  it("uses the limits for heat and wear", () => {
    const ok = parseReading(READ_HEALTHY);
    const hot = conditionsOf(ok, { ...DEFAULT_LIMITS, tempWarnC: 50 });
    expect([...hot.keys()]).toEqual(["temp-high|nvme0n1"]);
    const crit = conditionsOf(ok, {
      ...DEFAULT_LIMITS,
      tempWarnC: 40,
      tempCritC: 51,
    });
    expect([...crit.keys()]).toEqual(["temp-critical|nvme0n1"]);
    const worn = conditionsOf(ok, { ...DEFAULT_LIMITS, wearWarnPct: 3 });
    expect([...worn.keys()]).toEqual(["wear-high|nvme0n1"]);
  });

  it("sets health on every part", () => {
    applyHealth(reading, DEFAULT_LIMITS);
    const health = Object.fromEntries(
      reading.devices.map((d) => [d.id, d.health]),
    );
    expect(health).toEqual({
      nvme0n1: "ok",
      sda: "warn",
      sdb: "fail",
      sdc: "unknown",
    });
    expect(reading.pools[0].health).toBe("fail");
    expect(reading.arrays[1].health).toBe("ok");
    expect(reading.groups[0].health).toBe("warn");
    expect(overall(reading)).toBe("fail");
  });

  it("is unknown with no data", () => {
    expect(overall(null)).toBe("unknown");
  });
});

describe("diff and messages", () => {
  it("lists what started and what cleared", () => {
    const changes = diff(
      new Set(["temp-high|sda", "pool-errors|tank"]),
      new Set(["temp-high|sda", "smart-failing|sdb"]),
    );
    expect(changes.map((c) => `${c.kind}|${c.subject}|${c.on}`).sort()).toEqual(
      ["pool-errors|tank|false", "smart-failing|sdb|true"],
    );
  });

  it("ignores keys it does not know", () => {
    expect(parseKey("nonsense|x")).toBeNull();
    expect(parseKey("nopipe")).toBeNull();
    expect(diff(new Set(), new Set(["nonsense|x"]))).toEqual([]);
  });

  it("writes plain messages", () => {
    const reading = parseReading(READ_OUTPUT);
    const on = messageFor(
      {
        key: "smart-failing|sdb",
        kind: "smart-failing",
        subject: "sdb",
        on: true,
      },
      reading,
      "nas",
    );
    expect(on.severity).toBe("critical");
    expect(on.title).toBe(
      "sdb (Samsung SSD 860 EVO) is failing its SMART check on nas",
    );
    const off = messageFor(
      {
        key: "smart-failing|sdb",
        kind: "smart-failing",
        subject: "sdb",
        on: false,
      },
      reading,
      "nas",
    );
    expect(off.severity).toBe("info");
    expect(off.title).toContain("back to normal");
    expect(`${on.title}${on.body}${off.title}`).not.toMatch(/[–—]/);
  });
});
