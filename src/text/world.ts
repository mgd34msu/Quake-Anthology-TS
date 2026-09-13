import type { ContentId } from "../contracts/content.ts";
import type { Vec3, Vec4 } from "../contracts/math.ts";

export interface WorldTextInput {
  readonly text: string;
  readonly origin: Vec3;
  readonly color: Vec4;
  readonly cellSize: number;
  /** Cull when cell size is below signed camera-forward depth times this factor. */
  readonly distanceCullFactor?: number;
  readonly orientation: { readonly kind: "billboard" } | { readonly kind: "fixed"; readonly angles: Vec3 };
  readonly depthTest: boolean;
  readonly font: "classic" | "selected";
}
export interface WorldText extends WorldTextInput { readonly content: ContentId; }
interface TimedText {
  readonly text: WorldText;
  readonly lifetime: { readonly kind: "seconds"; readonly expires: number } | { readonly kind: "frame"; readonly firstFrame: number | null };
}

/** One server world owns these entries; presentation seats only read snapshots. */
export class WorldTextStore {
  private entries: TimedText[] = [];
  submit(text: WorldText, nowSeconds: number, lifetimeSeconds: number): void {
    if (![nowSeconds, lifetimeSeconds, text.cellSize, text.origin.x, text.origin.y, text.origin.z,
      text.color.x, text.color.y, text.color.z, text.color.w,
      ...(text.distanceCullFactor === undefined ? [] : [text.distanceCullFactor]),
      ...(text.orientation.kind === "fixed" ? [text.orientation.angles.x, text.orientation.angles.y, text.orientation.angles.z] : [])].every(Number.isFinite)
      || lifetimeSeconds < 0 || text.cellSize <= 0) throw new RangeError("Invalid world text geometry or lifetime");
    this.prune(nowSeconds);
    const orientation = text.orientation.kind === "billboard" ? Object.freeze({ kind: "billboard" } satisfies WorldTextInput["orientation"])
      : Object.freeze({ kind: "fixed", angles: Object.freeze({ ...text.orientation.angles }) } satisfies WorldTextInput["orientation"]);
    this.entries.push({ text: Object.freeze({ ...text, origin: Object.freeze({ ...text.origin }), color: Object.freeze({ ...text.color }), orientation }),
      lifetime: lifetimeSeconds === 0 ? { kind: "frame", firstFrame: null } : { kind: "seconds", expires: nowSeconds + lifetimeSeconds } });
  }
  snapshot(nowSeconds: number, frame: number): readonly WorldText[] {
    this.prune(nowSeconds);
    this.entries = this.entries.filter(entry => entry.lifetime.kind === "seconds" || entry.lifetime.firstFrame === null || entry.lifetime.firstFrame === frame)
      .map(entry => entry.lifetime.kind === "frame" && entry.lifetime.firstFrame === null
        ? { ...entry, lifetime: { kind: "frame", firstFrame: frame } } : entry);
    return Object.freeze(this.entries.map(entry => entry.text));
  }
  private prune(nowSeconds: number): void {
    this.entries = this.entries.filter(entry => entry.lifetime.kind === "frame" || entry.lifetime.expires > nowSeconds);
  }
  clear(): void { this.entries = []; }
}
