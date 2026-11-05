import { describe, expect, it } from "vitest";
import {
  parseBtrfs,
  parseLvm,
  parseMdstat,
  parseNvmeCli,
  parseReading,
  parseSmart,
  parseZfs,
  splitSections,
} from "../../src/backend/parsers";
import {
  BTRFS_SCRUB,
  BTRFS_STATS,
  LVS,
  MDSTAT,
  READ_OUTPUT,
  VGS,
  ZPOOL_LIST,
  ZPOOL_STATUS,
} from "./fixtures";

describe("reading", () => {
  const reading = parseReading(READ_OUTPUT);

  it("finds every drive, sorted", () => {
    expect(reading.devices.map((d) => d.id)).toEqual([
      "nvme0n1",
      "sda",
      "sdb",
      "sdc",
    ]);
    expect(reading.root).toBe(true);
    expect(reading.warnings).toEqual([]);
    expect(reading.tools).toContain("smartctl");
  });

  it("reads an ATA hard disk", () => {
    const d = reading.devices.find((x) => x.id === "sda")!;
    expect(d.kind).toBe("hdd");
    expect(d.passed).toBe(true);
    expect(d.tempC).toBe(38);
    expect(d.powerOnHours).toBe(41000);
    expect(d.pending).toBe(8);
    expect(d.reallocated).toBe(0);
    expect(d.selfTest).toContain("Completed without error");
    expect(d.sizeBytes).toBe(4000787030016);
  });

  it("reads wear from the SSD attributes", () => {
    const d = reading.devices.find((x) => x.id === "sdb")!;
    expect(d.kind).toBe("ssd");
    expect(d.passed).toBe(false);
    expect(d.wearPct).toBe(4);
    expect(d.reallocated).toBe(120);
  });

  it("reads NVMe health", () => {
    const d = reading.devices.find((x) => x.id === "nvme0n1")!;
    expect(d.kind).toBe("nvme");
    expect(d.wearPct).toBe(3);
    expect(d.criticalWarning).toBe(0);
    expect(d.mediaErrors).toBe(0);
    expect(d.tempC).toBe(52);
  });

  it("keeps a sleeping drive without data", () => {
    const d = reading.devices.find((x) => x.id === "sdc")!;
    expect(d.passed).toBeNull();
    expect(d.note).toMatch(/asleep/i);
    expect(d.model).toBe("ST8000");
    expect(d.kind).toBe("hdd");
  });
});

describe("zfs", () => {
  it("reads a degraded pool", () => {
    const [pool] = parseZfs(ZPOOL_LIST, ZPOOL_STATUS);
    expect(pool.name).toBe("tank");
    expect(pool.state).toBe("DEGRADED");
    expect(pool.health).toBe("fail");
    expect(pool.usedPct).toBe(50);
    expect(pool.scan).toContain("scrub repaired");
    expect(pool.scrubbing).toBe(false);
    expect(pool.members.map((m) => m.name)).toContain("sdd");
    expect(pool.members.find((m) => m.name === "sdd")?.state).toBe("UNAVAIL");
  });

  it("counts errors on an online pool", () => {
    const status = ZPOOL_STATUS.replace(/DEGRADED/g, "ONLINE")
      .replace("UNAVAIL", "ONLINE")
      .replace(
        "sdc     ONLINE       0     0     0",
        "sdc     ONLINE       0     0     5",
      );
    const list = ZPOOL_LIST.replace("DEGRADED", "ONLINE");
    const [pool] = parseZfs(list, status);
    expect(pool.errors).toBe(5);
    expect(pool.health).toBe("warn");
  });

  it("sees a scrub in progress", () => {
    const status = ZPOOL_STATUS.replace(
      /scan: .*/,
      "scan: scrub in progress since Sun Nov 1\n\t1.2T scanned, 40% done",
    );
    const [pool] = parseZfs(ZPOOL_LIST, status);
    expect(pool.scrubbing).toBe(true);
  });

  it("handles a host with no pools", () => {
    expect(parseZfs("", "no pools available\n")).toEqual([]);
  });
});

describe("mdadm", () => {
  it("reads a degraded rebuilding array and a healthy one", () => {
    const [md0, md1] = parseMdstat(MDSTAT);
    expect(md0.name).toBe("md0");
    expect(md0.level).toBe("raid1");
    expect(md0.total).toBe(2);
    expect(md0.active).toBe(1);
    expect(md0.health).toBe("fail");
    expect(md0.failed).toEqual(["sda1"]);
    expect(md0.syncAction).toBe("recovery");
    expect(md0.syncPct).toBe(8.4);
    expect(md0.syncEta).toBe("2.1min");
    expect(md1.level).toBe("raid6");
    expect(md1.health).toBe("ok");
    expect(md1.syncAction).toBe("");
  });

  it("has no arrays when the file is empty", () => {
    expect(parseMdstat("Personalities :\nunused devices: <none>\n")).toEqual(
      [],
    );
  });
});

describe("btrfs", () => {
  it("adds device counters and scrub errors", () => {
    const [fs] = parseBtrfs(
      splitSections(
        `@@btrfs /mnt/data|data\n${BTRFS_STATS}@@scrub\n${BTRFS_SCRUB}`,
      ),
    );
    expect(fs.mount).toBe("/mnt/data");
    expect(fs.label).toBe("data");
    expect(fs.counters).toHaveLength(5);
    expect(fs.errors).toBe(6);
    expect(fs.scrub).toContain("finished");
    expect(fs.health).toBe("warn");
  });

  it("is healthy with zero counters", () => {
    const [fs] = parseBtrfs(
      splitSections(
        "@@btrfs /a|\n[/dev/sda].write_io_errs 0\n@@scrub\nStatus: running\nError summary: no errors found\n",
      ),
    );
    expect(fs.errors).toBe(0);
    expect(fs.scrubbing).toBe(true);
    expect(fs.health).toBe("ok");
  });
});

describe("lvm", () => {
  it("lists thin pools with their group", () => {
    const [vg] = parseLvm(LVS, VGS);
    expect(vg.name).toBe("vg0");
    expect(vg.freeBytes).toBe(20000000000);
    expect(vg.thin).toEqual([{ name: "thinpool", dataPct: 93.5, metaPct: 12 }]);
  });

  it("copes with empty output", () => {
    expect(parseLvm("", "")).toEqual([]);
  });
});

describe("nvme-cli fallback", () => {
  it("turns kelvin into celsius", () => {
    const d = parseNvmeCli(
      "nvme1n1",
      JSON.stringify({
        critical_warning: 0,
        temperature: 318,
        percent_used: 7,
        media_errors: 0,
        power_on_hours: 99,
      }),
    );
    expect(d.tempC).toBe(45);
    expect(d.wearPct).toBe(7);
    expect(d.passed).toBe(true);
  });
});

describe("real host quirks", () => {
  it("ignores the 0 C a virtual drive reports", () => {
    const d = parseSmart(
      "sda",
      JSON.stringify({
        model_name: "QEMU HARDDISK",
        rotation_rate: 0,
        temperature: { current: 0 },
        smartctl: { messages: [] },
      }),
    );
    expect(d.tempC).toBeNull();
    expect(d.kind).toBe("ssd");
    expect(d.note).toBe("No SMART data from this drive");
    expect(d.health).toBe("unknown");
  });

  it("says a btrfs filesystem was never scrubbed", () => {
    const [fs] = parseBtrfs(
      splitSections(
        "@@btrfs /a|\n[/dev/sda].write_io_errs 0\n@@scrub\nUUID: 1\n\tno stats available\nError summary:    no errors found\n",
      ),
    );
    expect(fs.scrub).toBe("Never scrubbed");
    expect(fs.health).toBe("ok");
  });
});

describe("bad input", () => {
  it("never throws on junk", () => {
    expect(parseSmart("sdx", "not json").note).toMatch(/no answer/i);
    expect(parseReading("").devices).toEqual([]);
    expect(parseReading("@@smart sda\n{broken").devices[0].note).toBeTruthy();
  });

  it("warns when not root and without a SMART tool", () => {
    const r = parseReading(
      '@@root 1000\n@@lsblk\n{"blockdevices":[{"name":"sda","type":"disk"}]}\n@@end\n',
    );
    expect(r.warnings).toEqual(["not-root", "no-smart-tool"]);
  });
});
