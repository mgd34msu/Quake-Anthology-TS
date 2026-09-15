import type { CvarRegistry } from "./index.ts";

interface CvarMirrorSubscription { readonly clients: Set<SharedCvarMirror>; readonly release: () => void; }
const subscriptions = new WeakMap<CvarRegistry, Map<string, CvarMirrorSubscription>>();

/** Selected engine controls share values while each client retains its own unrelated settings. */
export class SharedCvarMirror {
  private readonly releases: (() => void)[] = [];
  private refreshing = false;
  constructor(private readonly owner: CvarRegistry, private readonly mirror: CvarRegistry,
    private readonly names: readonly string[], assertCurrent: () => void) {
    if (owner === mirror || owner.context.session !== mirror.context.session || owner.dialect !== mirror.dialect)
      throw new Error("Shared cvar mirror requires distinct registries in the same session and dialect");
    for (const name of names) {
      const value = owner.find(name);
      if (value === undefined) throw new Error(`Shared engine cvar ${name} is not declared`);
      mirror.register(name, value.resetValue, value.flags);
    }
    this.refresh();
    try {
      for (const name of names) {
        this.releases.push(mirror.bindValue(name, { validate: () => null, changed: value => {
          if (!this.refreshing) { assertCurrent(); owner.set(name, value, true); }
        } }));
        let shared = subscriptions.get(owner);
        if (shared === undefined) { shared = new Map<string, CvarMirrorSubscription>(); subscriptions.set(owner, shared); }
        let subscription = shared.get(name);
        if (subscription === undefined) {
          const clients = new Set<SharedCvarMirror>();
          const release = owner.bindValue(name, { validate: () => null, changed: () => {
            for (const client of clients) client.refresh();
          } });
          subscription = { clients, release }; shared.set(name, subscription);
        }
        subscription.clients.add(this);
      }
    } catch (error) { this.close(); throw error; }
  }
  refresh(): void {
    this.refreshing = true;
    try {
      for (const name of this.names) this.mirror.set(name, this.owner.variableString(name), true);
    } finally { this.refreshing = false; }
  }
  close(): void {
    for (const release of this.releases.splice(0)) release();
    const shared = subscriptions.get(this.owner);
    if (shared === undefined) return;
    for (const name of this.names) {
      const subscription = shared.get(name);
      if (subscription === undefined) continue;
      subscription.clients.delete(this);
      if (subscription.clients.size === 0) { subscription.release(); shared.delete(name); }
    }
    if (shared.size === 0) subscriptions.delete(this.owner);
  }
}
