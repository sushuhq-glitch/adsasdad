import type { SystemAlert } from "../types/index.js";
import { nowIso, uid } from "./money.js";

export class AlertBus {
  private alerts: SystemAlert[] = [];
  private listeners: Array<(a: SystemAlert) => void | Promise<void>> = [];

  onAlert(fn: (a: SystemAlert) => void | Promise<void>): void {
    this.listeners.push(fn);
  }

  list(): SystemAlert[] {
    return this.alerts;
  }

  pendingUpdates(): SystemAlert[] {
    return this.alerts.filter((a) => a.requiresUpdate && !a.acknowledged);
  }

  acknowledge(id: string): boolean {
    const a = this.alerts.find((x) => x.id === id);
    if (!a) return false;
    a.acknowledged = true;
    return true;
  }

  async push(input: Omit<SystemAlert, "id" | "at" | "acknowledged">): Promise<SystemAlert> {
    const alert: SystemAlert = {
      id: uid("alert"),
      at: nowIso(),
      acknowledged: false,
      ...input,
    };
    this.alerts.unshift(alert);
    this.alerts = this.alerts.slice(0, 200);
    for (const l of this.listeners) await l(alert);
    return alert;
  }
}
