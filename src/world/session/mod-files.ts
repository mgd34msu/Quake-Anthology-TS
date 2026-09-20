import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createMountId, createMountIdentity, createMountPlanId } from "../../contracts/content.ts";
import type { ContentId, LooseMount } from "../../contracts/content.ts";
import { modSelectionKey, type ModSelection } from "../../contracts/mods.ts";
import { MountedContent } from "../../content/mounts/index.ts";
import { UserFileStore } from "../../platform/files/writable.ts";

/** Component storage follows its selection across destination worlds and executable updates. */
export class ModUserFiles {
  private readonly stores = new Map<string, UserFileStore>();
  constructor(readonly root: string) {}

  for(selection: ModSelection): UserFileStore {
    const key = modSelectionKey(selection), current = this.stores.get(key);
    if (current !== undefined) return current;
    const store = new UserFileStore(resolve(this.root, ".mods", encodeURIComponent(selection.product), encodeURIComponent(selection.id)));
    this.stores.set(key, store);
    return store;
  }
}

export function borrowModFileMounts(selection: ModSelection, content: ContentId,
  installed: MountedContent | undefined, writable: UserFileStore): MountedContent {
  const key = modSelectionKey(selection), identity = createHash("sha256").update(key).digest("hex");
  const mount: LooseMount = { kind: "loose", rootPath: writable.root, identity: createMountIdentity(createMountId("mod-user", identity), content, 0) };
  const plan = createMountPlanId("mod-files", createHash("sha256").update(`${key}\0${installed?.plan.id ?? ""}`).digest("hex"));
  return installed === undefined
    ? new MountedContent({ id: plan, mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] }, [{ kind: "loose", mount }])
    : installed.borrowWithLooseMount(mount, plan);
}
