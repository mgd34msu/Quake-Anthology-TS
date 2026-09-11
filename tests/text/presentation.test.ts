import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { openArchive } from "../../src/content/archive/index.ts";
import type { ArchiveHandle } from "../../src/content/archive/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { RenderCommand, RenderImage, RendererImage, RendererResourceOwner } from "../../src/contracts/render.ts";
import { TextFontRegistry, classicCharset } from "../../src/text/atlas.ts";
import { CaptionTimeline, parseSubtitleText } from "../../src/text/captions.ts";
import { Draw2D, TextCommandSink } from "../../src/text/draw2d.ts";
import { layoutText, drawTextLayout } from "../../src/text/layout.ts";
import { LocalizationCatalog, Loc_LanguageFromLocale } from "../../src/text/localization.ts";
import { parseFontData, proportionalStringWidth } from "../../src/text/q3-font.ts";

const corpus = new URL("../../../qfiles/", import.meta.url).pathname;
async function member(archive: ArchiveHandle, path: string): Promise<Uint8Array> {
  const entry = archive.findEntries(path)[0];
  if (entry === undefined) throw new Error(`Missing fixture ${path}`);
  return archive.readEntry(entry);
}
const encode = (text: string) => new TextEncoder().encode(text);

test.skipIf(!existsSync(`${corpus}q1/rerelease/id1/pak0.pak`))("real rerelease localization loads Unicode and overlays with independent seats", async () => {
  const owner = createIdentityOwner("text-localization"), q1 = new LocalizationCatalog(owner.seat(0));
  const q2 = new LocalizationCatalog(owner.seat(1), "q2-rerelease");
  const first = await openArchive(`${corpus}q1/rerelease/id1/pak0.pak`), second = await openArchive(`${corpus}q2/rerelease/Q2Game.kpf`);
  try {
    expect(q1.reload(await member(first, "localization/loc_russian.txt"))).toBeGreaterThan(1500);
    expect(q1.localize("$m_single_player")).toBe("Один игрок");
    expect(q2.reload(await member(second, "localization/loc_english.txt"))).toBeGreaterThan(1500);
    q1.merge(encode('mod_name="Игрок"\nmod_message="{0}: {1}"'));
    expect(q1.localize("$mod_message", ["$mod_name", "Тест"])).toBe("Игрок: Тест");
    expect(q2.localize("$mod_name")).toBe("mod_name");
    q1.reload(encode('key="first"\nkey="last"'));
    q2.reload(encode('key="first"\nkey="last"'));
    expect(q1.localize("$key")).toBe("first");
    expect(q2.localize("$key")).toBe("last");
    expect(Loc_LanguageFromLocale("ru_RU.UTF-8")).toBe("russian");
    expect(q1.localize("éé", [], true, 4)).toBe("é");
    expect(q1.localizeBytes("éé", [], true, 4)).toEqual(new Uint8Array([0xc3, 0xa9, 0xc3]));
  } finally { first.close(); second.close(); }
});

test.skipIf(!existsSync(`${corpus}q1/rerelease/QuakeEX.kpf`))("real kfonts produce positioned image commands and wrap Unicode", async () => {
  const archive = await openArchive(`${corpus}q1/rerelease/QuakeEX.kpf`), identity = createIdentityOwner("text-atlas");
  const owner: RendererResourceOwner = { identity: Symbol("text-atlas"), session: identity.session, generation: 0 };
  const images = new Map<RendererImage, RenderImage>();
  let nextImage = 0;
  const registry = new TextFontRegistry({
    async read(path) { const entry = archive.findEntries(path)[0]; return entry === undefined ? null : archive.readEntry(entry); },
    async registerImage(name, content) {
      const level = content.levels[0];
      const image: RendererImage = { owner, ordinal: nextImage++, source: { kind: "generated", name }, width: level.width, height: level.height };
      images.set(image, content); return image;
    },
    releaseImage(image) { images.delete(image); },
  });
  try {
    const font = await registry.loadKfont("fonts/qfont.kfont");
    if (font === null) throw new Error("Missing real qfont");
    expect(font.glyphs.has(0x410)).toBe(true);
    const consoleFont = await registry.loadKfont("fonts/confont.kfont");
    if (consoleFont === null) throw new Error("Missing TGA confont");
    expect(consoleFont.glyphs.size).toBe(256);
    const charset = classicCharset(consoleFont.picture.image, "classic", "tinted");
    const layout = layoutText({ text: "^1Один игрок\nA", colorCodes: "q3", scale: 1,
      font: { kind: "atlas", font, classic: charset }, color: { x: 1, y: 1, z: 1, w: 1 }, maxWidth: 36 });
    expect(layout.lines.length).toBeGreaterThan(1);
    const glyph = layout.lines[0]?.glyphs[0];
    expect(glyph?.glyph.codepoint).toBe(0x41e);
    expect(glyph?.color).toEqual({ x: 1, y: 0, z: 0, w: 1 });
    const commands: RenderCommand[] = [];
    const sink = new TextCommandSink(identity.seat(1), { x: 640, y: 0, width: 640, height: 480 },
      command => { commands.push(command); }, () => { throw new Error("Unexpected material glyph"); });
    drawTextLayout(new Draw2D(sink, "pixels"), layout, { x: 10, y: 20 });
    const picture = commands.find(command => command.kind === "stretch-pic");
    expect(picture?.kind === "stretch-pic" ? picture.rect.x : null).toBe(650);
    expect(images.size).toBe(2);
  } finally { registry.close(); archive.close(); }
  expect(images.size).toBe(0);
});

test("captions follow a paused or sought logical clock and keep seat language", () => {
  const identity = createIdentityOwner("captions"), first = new LocalizationCatalog(identity.seat(0)), second = new LocalizationCatalog(identity.seat(1));
  first.reload(encode('line="Follow me"')); second.reload(encode('line="Suivez-moi"'));
  const a = new CaptionTimeline(first.seat, first), b = new CaptionTimeline(second.seat, second);
  const cues = parseSubtitleText("1\n00:00:01,000 --> 00:00:02,000\n$line\n\n2\n00:00:01,500 --> 00:00:03,000\nDoors opening", "clip");
  a.replace(cues); b.replace(cues);
  expect(a.activeAt(999)).toHaveLength(0);
  expect(a.activeAt(1000)[0]?.localizedText).toBe("Follow me");
  expect(b.activeAt(1000)[0]?.localizedText).toBe("Suivez-moi");
  expect(a.activeAt(1500)).toHaveLength(2);
  expect(a.activeAt(2000)).toHaveLength(1);
  expect(a.activeAt(1000)).toHaveLength(1);
});

test.skipIf(!existsSync(`${corpus}q3a/missionpack/pak0.pk3`))("real Q3 font DAT retains all glyph records and proportional metrics", async () => {
  const archive = await openArchive(`${corpus}q3a/missionpack/pak0.pk3`);
  try {
    const entry = archive.entries.find(item => /^fonts\/fontImage_\d+\.dat$/.test(item.path));
    if (entry === undefined) throw new Error("Missing Q3 font DAT");
    const font = parseFontData(await archive.readEntry(entry), entry.path);
    expect(font.glyphs).toHaveLength(256);
    expect(font.glyphs[65]?.xSkip).toBeGreaterThan(0);
    expect(font.glyphScale).toBeGreaterThan(0);
    expect(proportionalStringWidth("QUAKE")).toBeGreaterThan(proportionalStringWidth("I"));
  } finally { archive.close(); }
});
