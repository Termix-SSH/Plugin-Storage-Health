import { describe, expect, it } from "vitest";
import { parseManifest } from "@termix-ssh/plugin-sdk/manifest";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import manifest from "../../manifest.json";
import { registerOperations } from "../../src/backend/operations.js";

type Actions = {
  id: string;
  risk: string;
  hostAccess?: string;
  permission?: string;
}[];
const actions = () =>
  (manifest.contributes as unknown as { operations: { actions: Actions } })
    .operations.actions;

describe("declared actions", () => {
  it("is a valid manifest", () => {
    expect(parseManifest(manifest).errors ?? []).toEqual([]);
  });

  it("has a handler for every declared action and nothing else", () => {
    const registered: string[] = [];
    const ctx = {
      operations: {
        register: (id: string) => {
          registered.push(id);
        },
      },
    } as unknown as PluginContext;
    (registerOperations as (...args: unknown[]) => void)(ctx, {});
    expect([...registered].sort()).toEqual(
      actions()
        .map((a) => a.id)
        .sort(),
    );
  });

  it("needs edit for anything that changes a host", () => {
    for (const action of actions()) {
      if (action.risk !== "read") {
        expect(["edit", "manage"]).toContain(action.hostAccess);
        expect(action.permission).toBe("run-tests");
      }
    }
  });

  it("emits only events it declares", () => {
    const events = (
      manifest.contributes as unknown as {
        operations: { events: { id: string }[] };
      }
    ).operations.events.map((e) => e.id);
    expect(events).toEqual([
      "storage-health.degraded",
      "storage-health.recovered",
      "storage-health.smart-failing",
      "storage-health.raid-degraded",
    ]);
  });
});
