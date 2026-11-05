import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { History, RAW_LIMIT } from "../../src/backend/history";
import { parseReading } from "../../src/backend/parsers";
import { READ_OUTPUT } from "./fixtures";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

const NOW = 1_800_000_000;

describe("history", () => {
  it("keeps raw samples for 24h and averages by the hour after", () => {
    const h = new History(null);
    const r = parseReading(READ_OUTPUT);
    for (let i = 0; i < 6; i++) h.add(1, NOW - 3600 * 2 + i * 600, r);
    const day = h.range(1, "sda", "24h", NOW);
    expect(day).toHaveLength(6);
    expect(day[0].p).toBe(38);
    expect(day[0].r).toBe(8);
    expect(h.range(1, "sda", "7d", NOW).length).toBeGreaterThan(0);
    expect(h.range(2, "sda", "24h", NOW)).toEqual([]);
    expect(h.range(1, "nope", "24h", NOW)).toEqual([]);
  });

  it("skips a drive that gave no data", () => {
    const h = new History(null);
    h.add(1, NOW, parseReading(READ_OUTPUT));
    expect(h.range(1, "sdc", "24h", NOW)).toEqual([]);
  });

  it("caps raw samples", () => {
    const h = new History(null);
    const r = parseReading(READ_OUTPUT);
    for (let i = 0; i < RAW_LIMIT + 50; i++) h.add(1, NOW - 90_000 + i * 60, r);
    expect(h.range(1, "sda", "24h", NOW).length).toBeLessThanOrEqual(RAW_LIMIT);
  });

  it("saves to a file and loads it back", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "storage-hist-"));
    dirs.push(dir);
    const a = new History(dir);
    a.add(3, NOW, parseReading(READ_OUTPUT));
    await a.flush();
    const b = new History(dir);
    await b.load();
    expect(b.range(3, "nvme0n1", "24h", NOW)).toHaveLength(1);
  });

  it("forgets a host", () => {
    const h = new History(null);
    h.add(1, NOW, parseReading(READ_OUTPUT));
    h.dropHost(1);
    expect(h.range(1, "sda", "24h", NOW)).toEqual([]);
  });
});
