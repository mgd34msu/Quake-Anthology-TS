import type { ContentId, ResourceId } from "../contracts/content.ts";
import type { MountedContent } from "../content/mounts/index.ts";
import type { SoundAsset, SoundFamily } from "./types.ts";
import { decodeSoundBytes, openPcmBytes } from "./streams.ts";
import type { PcmStream } from "./streams.ts";
import { decodeQuakeWav } from "./wav.ts";
/** Registrations retain both the selected resource and its source decode policy. */
export class SoundBank {
    private readonly assets = new Map<string, SoundAsset>();
    private readonly touched = new Set<string>();
    constructor(readonly content: MountedContent) { }
    beginRegistration(): void { this.touched.clear(); }
    async register(name: string, family: SoundFamily = "q3"): Promise<SoundAsset | null> {
        const path = name.startsWith("#") ? name.slice(1) : name.startsWith("sound/") ? name : `sound/${name}`;
        const opened = await this.content.open(path);
        if (opened === null)
            return null;
        const key = `${family}:${opened.reference.id}`;
        this.touched.add(key);
        const prior = this.assets.get(key);
        if (prior !== undefined)
            return prior;
        const pcm = family !== "q3" && opened.bytes[0] === 82 ? decodeQuakeWav(opened.bytes, path) : decodeSoundBytes(opened.bytes, path);
        const asset = { resource: opened.reference.id, reference: opened.reference, name: path, pcm };
        this.assets.set(key, asset);
        return asset;
    }
    async registerSexedSound(base: string, model: string): Promise<SoundAsset | null> {
        if (!base.startsWith("*"))
            return this.register(base, "q2");
        const selected = model.split("/")[0] || "male", name = base.slice(1);
        return await this.register(`#players/${selected}/${name}`, "q2") ?? this.register(`player/male/${name}`, "q2");
    }
    get(resource: ResourceId, family: SoundFamily = "q3"): SoundAsset | undefined { return this.assets.get(`${family}:${resource}`); }
    endRegistration(): void { for (const key of this.assets.keys())
        if (!this.touched.has(key))
            this.assets.delete(key); }
    async openMusic(path: string, source: ContentId | null = null): Promise<PcmStream | null> {
        const opened = await this.content.open(path);
        return opened === null || (source !== null && opened.reference.provenance.mount.identity.content !== source)
            ? null : openPcmBytes(opened.bytes, path);
    }
    clear(): void { this.assets.clear(); this.touched.clear(); }
}
