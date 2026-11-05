import type { ComponentType } from "react";
import { HardDrive } from "lucide-react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { initApi } from "./api";
import { enabled } from "./format";
import { StorageHostsCard } from "./StorageHostsCard";
import { StorageManagerCard } from "./StorageManagerCard";
import { StorageTab } from "./StorageTab";

const TAB_ID = "storage-health";

export function activate(app: TermixApp): void {
  initApi(app.api);
  // Host actions filter synchronously, so the permission is read once here.
  let canUse = true;
  void app.hasPermission("use").then((allowed) => {
    canUse = allowed;
  });

  app.registerTab(TAB_ID, StorageTab, {
    icon: HardDrive,
    titleKey: "tab.title",
    requiresHost: true,
    noHostMessageKey: "tab.noHost",
    persistent: true,
  });

  app.registerHostAction({
    id: TAB_ID,
    titleKey: "tab.title",
    icon: HardDrive,
    kind: "open",
    order: 53,
    tabType: TAB_ID,
    when: (host) => canUse && !!host.enableSsh && enabled(host),
  });

  app.registerDashboardCard({
    id: "storage-hosts",
    titleKey: "card.title",
    defaultPanel: "side",
    defaultHeight: 240,
    frame: "framed",
    component: StorageHostsCard,
  });

  // Fills the storage card in Host Metrics, when that plugin runs.
  app.registerSlotContribution("host-metrics.managers", {
    actionId: "storage_health",
    titleKey: "manager.title",
    kind: "component",
    component: StorageManagerCard as unknown as ComponentType<
      Record<string, unknown>
    >,
  });
}
