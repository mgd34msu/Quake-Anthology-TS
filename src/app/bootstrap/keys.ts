import { basename } from "node:path";
import { Q3CdKeyState } from "../../core/q3-cd-key.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { defaultUserContentRoot, userProductDirectory } from "../../content/user-data.ts";
import { Q3ClientAuthorization } from "../../network/q3/client-authorization.ts";
import { ConfigStore } from "../../settings/config.ts";
import type { ApplicationOptions } from "./options.ts";

/** A prepared profile owns its UI view before it becomes the authorization profile. */
export class ApplicationKeyProfile {
  constructor(public cvars: CvarRegistry, readonly gameDirectory: string, readonly demoRestricted: boolean,
    private readonly state: Q3CdKeyState, private readonly base: ConfigStore, private readonly mod: ConfigStore | null) {}
  readUi(unique: number, directory: string, destination: Uint8Array): void { this.state.readUi(unique, directory, destination); }
  async writeUi(unique: number, directory: string, source: Uint8Array): Promise<void> {
    this.state.writeUi(unique, directory, source);
    const useMod = unique === 1 && directory.length !== 0;
    const store = useMod ? this.mod : this.base;
    if (store === null) throw new Error("Selected Q3 UI has no mod key write root");
    await this.state.writeFile(store, useMod ? 16 : 0);
  }
  readAuthorization(destination: Uint8Array): void { this.state.readAuthorization(destination); }
  async save(): Promise<void> {
    await this.state.writeFile(this.base, 0);
    if (this.mod !== null) await this.state.writeFile(this.mod, 16);
  }
}

/** The retained client publishes one descriptor for all of its native connections. */
export class ApplicationKeys {
  private current: ApplicationKeyProfile | null = null;
  readonly authorization: Q3ClientAuthorization;
  constructor(print: (text: string) => void) {
    const owner = this;
    this.authorization = new Q3ClientAuthorization({
      get cvars() { return owner.active.cvars; },
      keys: { readAuthorization: destination => owner.active.readAuthorization(destination) },
      demoRestricted: () => owner.active.demoRestricted,
      print,
    });
  }
  get active(): ApplicationKeyProfile {
    if (this.current === null) throw new Error("Q3 keys have no published source profile");
    return this.current;
  }
  async prepare(options: ApplicationOptions, catalog: InstalledCatalog, cvars: CvarRegistry): Promise<ApplicationKeyProfile | null> {
    const demoRestricted = options.q3Product?.restriction.kind === "demo";
    const product = catalog.product(options.product);
    if (product.expectation.family !== "q3") return null;
    let base = product;
    while (base.expectation.baseProduct !== null) base = catalog.product(base.expectation.baseProduct);
    const stores = (selected: typeof product): { write: ConfigStore; loadText(name: string): Promise<string | null> } => {
      const write = new ConfigStore(selected.userContent?.root
        ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), selected.expectation.contentDirectory));
      const fallback = selected.looseRoot === null || selected.looseRoot === write.root ? null : new ConfigStore(selected.looseRoot);
      return { write, loadText: async name => await write.loadText(name) ?? await fallback?.loadText(name) ?? null };
    };
    const baseStore = stores(base), modStore = product.id === base.id ? null : stores(product);
    let profile: ApplicationKeyProfile | null = null;
    const state = new Q3CdKeyState({ markModifiedFlags: flags => (profile?.cvars ?? cvars).markModifiedFlags(flags) });
    await state.readFile(baseStore);
    if (modStore !== null) await state.appendFile(modStore);
    profile = new ApplicationKeyProfile(cvars, modStore === null ? "" : basename(product.expectation.contentDirectory), demoRestricted,
      state, baseStore.write, modStore?.write ?? null);
    return profile;
  }
  publish(profile: ApplicationKeyProfile | null, cvars: CvarRegistry): void {
    if (profile !== null) profile.cvars = cvars;
    this.current = profile;
  }
  async save(): Promise<void> { await this.current?.save(); }
}
