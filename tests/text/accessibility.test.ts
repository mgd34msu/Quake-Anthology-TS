import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { classicCharset, resolveTextGlyph, type TextFontSelection } from "../../src/text/atlas.ts";
import { layoutText } from "../../src/text/layout.ts";
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { loadLocalizationResources } from "../../src/text/localization-resources.ts";
import { SeatMediaCaptions, subtitlePaths, type CaptionPlaybackState } from "../../src/text/media-captions.ts";
import { captionCommands } from "../../src/ui/common/captions.ts";

const owner = createIdentityOwner("localized-captions");
test("prompt language overlays retain actual English fallback and resolve authored escapes", async () => {
  const files = new Map<string, string>([
    ["localization/loc_english.txt", 'title = "Choose"\nfallback = "Back"'],
    ["localization/loc_french.txt", 'title = "Choisir"'],
    ["localization/loc_french_mod.txt", 'title = "Équipe\\nChoisir"'],
  ]);
  const catalog = await loadLocalizationResources(owner.seat(0), "french", async path => {
    const value = files.get(path); return value === undefined ? null : new TextEncoder().encode(value);
  });
  expect(catalog.localize("$title")).toBe("Équipe\nChoisir");
  expect(catalog.localize("$fallback")).toBe("Back");
});

test("localized subtitle cues follow source seek/loop time and retire on skip", async () => {
  const paths: string[] = [];
  const captions = new SeatMediaCaptions(owner.seat(0), async path => {
    paths.push(path); return path.endsWith("_fr.srt") ? new TextEncoder().encode("1\n00:00:01,000 --> 00:00:03,000\nÉquipe\nPrête\n") : null;
  });
  await captions.prepare("video/eou1_.ogv", "french");
  expect(paths.filter(path => path.startsWith("video/"))).toEqual(["video/eou1__fr.srt"]);
  const preferences = { subtitles: true, soundCaptions: true, speakers: true };
  const frame = { source: "video/eou1_.ogv", sourceTimeMilliseconds: 1500, status: "playing" } satisfies CaptionPlaybackState;
  expect(captions.active(frame, preferences)[0]?.localizedText).toBe("Équipe\nPrête");
  expect(captions.active({ ...frame, sourceTimeMilliseconds: 0 }, preferences)).toEqual([]);
  expect(captions.active({ ...frame, status: "held" }, preferences).length).toBe(1);
  expect(captions.active({ ...frame, status: "ended" }, preferences)).toEqual([]);
  expect(captions.active(frame, { ...preferences, subtitles: false })).toEqual([]);
  expect(subtitlePaths("video/end.roq", "english")).toEqual(["video/end.srt", "video/end.vtt"]);
  const commands = captionCommands(captions.active(frame, preferences), { x: 20, y: 20, width: 160, height: 80 }, "resource:test:font", 2, (text, scale) => [...text].length * 8 * scale);
  const text = commands.flatMap(command => command.kind === "text" ? [command] : []);
  expect(text.map(command => command.text)).toEqual(["Équipe", "Prête"]);
  for (const command of text) { expect(command.origin.y).toBeGreaterThanOrEqual(20); expect(command.origin.y + 16).toBeLessThanOrEqual(100); }
});

test("actual supplied French Q2 subtitles parse with original cue timing", async () => {
  const file = Bun.file("/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/video/eou1__fr.srt");
  if (!await file.exists()) return;
  const captions = new SeatMediaCaptions(owner.seat(1), async path => path === "video/eou1__fr.srt" ? new Uint8Array(await file.arrayBuffer()) : null);
  await captions.prepare("video/eou1_.ogv", "french");
  const preferences = { subtitles: true, soundCaptions: true, speakers: true };
  expect(captions.active({ source: "video/eou1_.ogv", sourceTimeMilliseconds: 1184, status: "playing" }, preferences)).toEqual([]);
  expect(captions.active({ source: "video/eou1_.ogv", sourceTimeMilliseconds: 1185, status: "playing" }, preferences)[0]?.localizedText).toBe("Initialisation du scan");
  expect(captions.active({ source: "video/eou1_.ogv", sourceTimeMilliseconds: 3106, status: "playing" }, preferences)).toEqual([]);
});

test("Unicode glyph fallback uses its actual atlas and normalizes line height", () => {
  const images = new SceneImageRegistry({ identity: Symbol("fallback"), session: owner.session, generation: 0 });
  const image = images.register("classic", { kind: "rgba8", levels: [{ width: 128, height: 128, pixels: new Uint8Array(128 * 128 * 4) }], borderColor: { x: 0, y: 0, z: 0, w: 0 } }, { wrap: "clamp", filter: "nearest" });
  const classic = classicCharset(image), source = classic.glyphs.get(65);
  if (source === undefined) throw new Error("Missing fixture glyph");
  const primary = { ...classic, glyphs: new Map([[65, source]]) };
  const fallback = { ...classic, name: "authored Cyrillic", lineHeight: 16, glyphs: new Map([[0x416, { ...source, width: 16, height: 16, advance: 16 }]]) };
  const font = { kind: "atlas", font: primary, classic, fallbacks: [fallback] } satisfies TextFontSelection;
  expect(resolveTextGlyph(font, 0x416).atlas).toBe(fallback);
  const layout = layoutText({ text: "AЖ", font, scale: 1, color: { x: 1, y: 1, z: 1, w: 1 } });
  expect(layout.width).toBe(16); expect(layout.lines[0]?.glyphs[1]?.rect.height).toBe(8);
});

test("authored WebVTT speaker identity is shown without literal markup", async () => {
  const captions = new SeatMediaCaptions(owner.seat(0), async path => path === "sound/voice.vtt" ? new TextEncoder().encode("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<v Marine>Follow me</v>\n") : null, null, "caption");
  await captions.prepare("sound/voice.wav", "english");
  const active = captions.active({ source: "sound/voice.wav", sourceTimeMilliseconds: 100, status: "playing" }, { subtitles: false, soundCaptions: true, speakers: true });
  expect(active[0]?.localizedText).toBe("Follow me"); expect(active[0]?.localizedSpeaker).toBe("Marine");
});
