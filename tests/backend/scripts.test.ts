import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseReading } from "../../src/backend/parsers";
import {
  READ_SCRIPT,
  scrubScript,
  selfTestScript,
} from "../../src/backend/scripts";

const hasBash = spawnSync("bash", ["--version"]).status === 0;

function syntax(script: string): string {
  const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  return result.status === 0 ? "" : result.stderr;
}

describe.skipIf(!hasBash)("generated scripts", () => {
  it("are valid bash", () => {
    const scripts: Record<string, string> = {
      read: READ_SCRIPT,
      short: selfTestScript("sda", "short"),
      long: selfTestScript("nvme0n1", "long"),
      abort: selfTestScript("sdb", "abort"),
      zfs: scrubScript({ kind: "zfs", name: "tank" }, false),
      zfsStop: scrubScript({ kind: "zfs", name: "tank" }, true),
      btrfs: scrubScript({ kind: "btrfs", mount: "/mnt/my data" }, false),
      md: scrubScript({ kind: "md", name: "md0" }, false),
      mdStop: scrubScript({ kind: "md", name: "md0" }, true),
    };
    for (const [name, script] of Object.entries(scripts)) {
      expect(syntax(script), name).toBe("");
    }
  });
});

describe.skipIf(!hasBash)("reader run with fake tools", () => {
  it("runs every tool and prints its section", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "storage-fake-"));
    const fake = (name: string, body: string) => {
      const file = path.join(dir, name);
      writeFileSync(file, `#!/bin/bash\n${body}\n`);
      chmodSync(file, 0o755);
    };
    fake(
      "lsblk",
      'case "$*" in *-J*) echo \'{"blockdevices":[{"name":"sda","type":"disk"}]}\';; *) echo "sda disk";; esac',
    );
    fake(
      "smartctl",
      'echo \'{"smart_status":{"passed":true},"args":"\'"$*"\'"}\'',
    );
    fake(
      "zpool",
      'case "$1" in list) printf "tank\\t100\\t50\\t50\\tONLINE\\n";; status) echo "  pool: tank";; esac',
    );
    fake("lvs", 'echo \'{"report":[{"lv":[]}]}\'');
    fake("vgs", 'echo \'{"report":[{"vg":[]}]}\'');
    const result = spawnSync("bash", ["-s"], {
      input: READ_SCRIPT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      },
    });
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).toBe(0);
    const reading = parseReading(result.stdout);
    expect(reading.tools).toEqual(
      expect.arrayContaining(["smartctl", "lsblk", "zpool", "lvs", "vgs"]),
    );
    expect(reading.devices).toHaveLength(1);
    expect(reading.devices[0].passed).toBe(true);
    expect(result.stdout).toContain("-a -n standby --json=c /dev/sda");
    expect(reading.pools[0]).toMatchObject({ name: "tank", state: "ONLINE" });
  });
});

describe("script safety", () => {
  it("only reads: no write commands in the reader", () => {
    expect(READ_SCRIPT).not.toMatch(
      /scrub (start|cancel)|smartctl -t|rm |sync_action/,
    );
  });

  it("refuses drive names that are not plain", () => {
    expect(() => selfTestScript("sda; reboot", "short")).toThrow();
    expect(() => selfTestScript("$(id)", "short")).toThrow();
    expect(() => selfTestScript("../etc", "short")).toThrow();
    expect(() => scrubScript({ kind: "zfs", name: "a b" }, false)).toThrow();
    expect(() => scrubScript({ kind: "md", name: "sda" }, false)).toThrow();
  });

  it("quotes the device and mount", () => {
    expect(selfTestScript("sda", "short")).toContain("'/dev/sda'");
    expect(scrubScript({ kind: "btrfs", mount: "/mnt/a'b" }, false)).toContain(
      "'/mnt/a'\\''b'",
    );
  });

  it("starts and stops with the right flags", () => {
    expect(selfTestScript("sda", "long")).toContain("smartctl -t long");
    expect(selfTestScript("sda", "abort")).toContain("smartctl -X");
    expect(scrubScript({ kind: "zfs", name: "tank" }, true)).toContain(
      "zpool scrub -s 'tank'",
    );
    expect(scrubScript({ kind: "md", name: "md0" }, false)).toContain(
      "echo check >",
    );
    expect(scrubScript({ kind: "md", name: "md0" }, true)).toContain(
      "echo idle >",
    );
  });

  it("does not skip a failing self test", () => {
    expect(selfTestScript("sda", "short")).toContain("SCRIPT_ERR");
  });
});
