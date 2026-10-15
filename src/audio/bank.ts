import type { ContentId, ResourceId } from "../contracts/content.ts";
import type { MountedContent } from "../content/mounts/index.ts";
import type { SoundAsset, SoundFamily } from "./types.ts";
import { decodeSoundBytes, openPcmBytes } from "./streams.ts";
import type { PcmStream } from "./streams.ts";
import { decodeQ3Wav, decodeQuakeWav } from "./wav.ts";
/** Registrations retain both the selected resource and its source decode policy. */
export class SoundBank {
    private readonly assets = new Map<SoundFamily, Map<ResourceId, SoundAsset>>();
    private readonly touched = new Set<SoundAsset>();
    constructor(readonly content: MountedContent) { }
    beginRegistration(): void { this.touched.clear(); }
    private familyAssets(family: SoundFamily): Map<ResourceId, SoundAsset> {
        let assets = this.assets.get(family);
        if (assets === undefined) { assets = new Map<ResourceId, SoundAsset>(); this.assets.set(family, assets); }
        return assets;
    }
    async register(name: string, family: SoundFamily = "q3"): Promise<SoundAsset | null> {
        const path = name.startsWith("#") ? name.slice(1) : name.startsWith("sound/") ? name : `sound/${name}`;
        const opened = await this.content.open(path);
        if (opened === null)
            return null;
        const assets = this.familyAssets(family);
        const prior = assets.get(opened.reference.id);
        if (prior !== undefined) {
            this.touched.add(prior);
            return prior;
        }
        const pcm = opened.bytes[0] === 82 ? (family === "q3" ? decodeQ3Wav : decodeQuakeWav)(opened.bytes, path) : decodeSoundBytes(opened.bytes, path);
        const asset = { resource: opened.reference.id, reference: opened.reference, name: path, pcm };
        assets.set(opened.reference.id, asset);
        this.touched.add(asset);
        return asset;
    }
    async registerSexedSound(base: string, model: string): Promise<SoundAsset | null> {
        if (!base.startsWith("*"))
            return this.register(base, "q2");
        const selected = model.split("/")[0] || "male", name = base.slice(1);
        return await this.register(`#players/${selected}/${name}`, "q2") ?? this.register(`player/male/${name}`, "q2");
    }
    get(resource: ResourceId, family: SoundFamily = "q3"): SoundAsset | undefined { return this.assets.get(family)?.get(resource); }
    endRegistration(): void { for (const assets of this.assets.values()) for (const [resource, asset] of assets)
        if (!this.touched.has(asset))
            assets.delete(resource); }
    async openMusic(path: string, source: ContentId | null = null): Promise<PcmStream | null> {
        const opened = await this.content.open(path);
        return opened === null || (source !== null && opened.reference.provenance.mount.identity.content !== source)
            ? null : openPcmBytes(opened.bytes, path);
    }
    clear(): void { this.assets.clear(); this.touched.clear(); }
}
