/* Q3 cl_parse.c systeminfo and cl_main.c pure references. GPL-2.0-or-later. */
import type { PureMountPolicy } from "../../../content/mounts/index.ts";
import { nativeAtoi } from "../../../core/numeric.ts";
import { q3InfoValue } from "../../../network/q3/admission.ts";
import { PakReferenceFlag, ServerPakSet } from "../../../network/q3/pak-references.ts";
import { loadApplicationContent } from "../content.ts";
import type { ApplicationContentSource, LoadedApplicationContent } from "../content.ts";
import type { ApplicationOptions } from "../options.ts";
import { Q3ApplicationPackages } from "./q3-downloads.ts";
import { remoteContentSelection } from "../../../content/catalog/index.ts";

interface PureSystemInfo {
  readonly pure: boolean;
  readonly game: string;
  readonly checksums: readonly number[];
  readonly checksumFeed: number;
}

function systemInfo(info: string, checksumFeed: number): PureSystemInfo {
  if (!Number.isInteger(checksumFeed) || checksumFeed < -0x80000000 || checksumFeed > 0xffffffff)
    throw new RangeError("Q3 checksum feed must be a 32-bit integer");
  const loaded = new ServerPakSet();
  loaded.setChecksums(q3InfoValue(info, "sv_paks"));
  return { pure: nativeAtoi(q3InfoValue(info, "sv_pure")) !== 0,
    game: remoteContentSelection("q3-baseq3", q3InfoValue(info, "fs_game")).directory, checksums: loaded.checksums, checksumFeed: checksumFeed >>> 0 };
}

/** Each filesystem restart owns fresh mounts and references, including same-map feed changes. */
export class Q3ClientContent {
  private closed = false;

  private constructor(readonly content: LoadedApplicationContent, readonly packages: Q3ApplicationPackages,
    readonly policy: PureMountPolicy | undefined, private readonly settings: PureSystemInfo) {}

  get pure(): boolean { return this.settings.pure; }

  static async open(options: ApplicationOptions, info: string, checksumFeed: number,
    catalogContent: Pick<LoadedApplicationContent, "catalog" | "mounts">, presentationSource?: ApplicationContentSource): Promise<Q3ClientContent> {
    const settings = systemInfo(info, checksumFeed);
    const product = catalogContent.catalog.require(options.product);
    if (product.expectation.family !== "q3") throw new Error("Q3 client content requires a Q3 product");
    const game = product.expectation.contentDirectory.split("/").at(-1)?.toLowerCase();
    if (settings.game !== game)
      throw new Error("Server game directory differs from the selected Q3 content");
    const catalog = await Q3ApplicationPackages.open(catalogContent, checksumFeed);
    const policy = settings.checksums.length === 0 ? undefined : catalog.references.pureMountPolicy(settings.checksums);
    const content = await loadApplicationContent(options, undefined, policy, presentationSource === undefined ? undefined : catalogContent.catalog, presentationSource);
    try {
      const packages = await Q3ApplicationPackages.open(content, checksumFeed);
      return new Q3ClientContent(content, packages, policy, settings);
    } catch (error) {
      await content.close();
      throw error;
    }
  }

  matches(info: string, checksumFeed: number): boolean {
    if (this.closed) return false;
    const next = systemInfo(info, checksumFeed), previous = this.settings;
    return next.pure === previous.pure && next.game === previous.game && next.checksumFeed === previous.checksumFeed
      && next.checksums.length === previous.checksums.length
      && next.checksums.every((value, index) => (value >>> 0) === ((previous.checksums[index] ?? 0) >>> 0));
  }

  /** Call after the actual cgame/UI media initialization, before entering the server. */
  referencedPureCommand(serverId: number): string {
    if (this.closed) throw new Error("Q3 client content is closed");
    this.packages.collect(this.content);
    if (this.pure) {
      const references = this.packages.references.references.snapshot();
      for (const [flag, name] of [[PakReferenceFlag.Cgame, "cgame"], [PakReferenceFlag.Ui, "UI"]] satisfies readonly (readonly [PakReferenceFlag, string])[]) {
        if (!references.some(reference => (reference.flags & flag) !== 0))
          throw new Error(`Pure Q3 admission requires an actually loaded ${name} module`);
      }
    }
    return this.packages.references.referencedPureCommand(serverId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.content.close();
  }
}
