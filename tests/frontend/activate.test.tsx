import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import {
  enabled,
  formatBytes,
  formatHours,
  rowTone,
} from "../../src/frontend/format";
import { parseReading } from "../../src/backend/parsers";
import { applyHealth, DEFAULT_LIMITS } from "../../src/backend/conditions";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";
import { READ_OUTPUT } from "../backend/fixtures";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const reading = parseReading(READ_OUTPUT);
applyHealth(reading, DEFAULT_LIMITS);

const view = (canEdit = true) => ({
  hostId: 1,
  canEdit,
  useSudo: true,
  config: {
    hostId: 1,
    alerts: true,
    intervalMin: 15,
    tempWarnC: 0,
    tempCritC: 0,
    wearWarnPct: 80,
    thinWarnPct: 90,
  },
  status: "fail",
  reading,
  error: "",
  readAt: Date.now(),
  active: ["smart-failing|sdb"],
});

function api(data: unknown) {
  return {
    get: vi.fn(async (url: string) => {
      const path = url.split("?")[0];
      if (path.endsWith("/events")) return { data: [] };
      if (path.endsWith("/history")) return { data: { points: [] } };
      if (path.endsWith("/summary")) return { data: [] };
      return { data };
    }),
    post: vi.fn(async () => ({ data: { ok: true, message: "Started" } })),
    put: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  } as never;
}

const host = {
  id: 1,
  name: "nas",
  ip: "10.0.0.1",
  enableSsh: true,
  pluginSettings: { "storage-health": { enableStorage: true } },
};

describe(`${manifest.id} frontend`, () => {
  it("registers the tab and the dashboard card", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["storage-health"]);
    expect(rendered.registered.dashboardCards()).toEqual(["storage-hosts"]);
  });

  it("only offers the tab on hosts that turned it on", () => {
    expect(enabled(host)).toBe(true);
    expect(enabled({ pluginSettings: {} })).toBe(false);
    expect(enabled(null)).toBe(false);
  });

  it("lists the drives with the worst first", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(view()),
    });
    rendered.renderTab("storage-health", { isVisible: true, host });
    expect(await screen.findByText(/sdb \| Samsung SSD 860 EVO/)).toBeTruthy();
    const rows = screen.getAllByText(/^(nvme0n1|sda|sdb|sdc) \|/);
    expect(rows[0].textContent).toContain("sdb");
    expect(screen.getAllByText(locales.health.fail).length).toBeGreaterThan(0);
  });

  it("opens a drive and offers self tests", async () => {
    const mock = api(view());
    rendered = await renderWithApp(plugin, { manifest, locales, api: mock });
    rendered.renderTab("storage-health", { isVisible: true, host });
    fireEvent.click(await screen.findByText(/sda \| WDC/));
    expect(await screen.findByText(locales.detail.short)).toBeTruthy();
    expect(screen.getByText(locales.detail.long)).toBeTruthy();
    expect(
      screen.getByText("Current_Pending_Sector", { exact: false }),
    ).toBeTruthy();
    fireEvent.click(screen.getByText(locales.detail.short));
    await vi.waitFor(() =>
      expect(
        (mock as unknown as { post: ReturnType<typeof vi.fn> }).post,
      ).toHaveBeenCalledWith("/1/selftest", { device: "sda", action: "short" }),
    );
  });

  it("disables tests without edit access", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(view(false)),
    });
    rendered.renderTab("storage-health", { isVisible: true, host });
    fireEvent.click(await screen.findByText(/sda \| WDC/));
    const button = (await screen.findByText(locales.detail.short)).closest(
      "button",
    );
    expect(button?.disabled).toBe(true);
  });

  it("shows pools, arrays and filesystems", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(view()),
    });
    rendered.renderTab("storage-health", { isVisible: true, host });
    fireEvent.click(await screen.findByText(locales.tab.viewPools));
    expect(await screen.findByText("tank")).toBeTruthy();
    expect(screen.getByText("md0")).toBeTruthy();
    expect(screen.getByText("md1")).toBeTruthy();
    expect(screen.getByText("vg0/thinpool")).toBeTruthy();
  });

  it("shows why a host cannot be read", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api({
        ...view(),
        reading: null,
        error: "Connection lost",
        status: "unknown",
      }),
    });
    rendered.renderTab("storage-health", { isVisible: true, host });
    expect(await screen.findByText(/Connection lost/)).toBeTruthy();
  });
});

describe("formatting", () => {
  it("writes sizes and hours", () => {
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4_000_787_030_016)).toBe("4.0 TB");
    expect(formatHours(null)).toBe("-");
    expect(formatHours(5)).toBe("5h");
    expect(formatHours(100)).toBe("4d 4h");
    expect(formatHours(41_000)).toBe("4y 248d");
  });

  it("picks a tone for each health", () => {
    expect(rowTone("fail")).toBe("destructive");
    expect(rowTone("warn")).toBe("warning");
    expect(rowTone("ok")).toBe("success");
    expect(rowTone("unknown")).toBe("muted");
  });
});
