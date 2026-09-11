# Native menu art review

Three reusable raster assets were generated with the built-in ChatGPT image-generation tool on 2026-09-11. The tool did not expose a model identifier. No CLI, API fallback, copied retail artwork, or pixel-processing script was used. The selected PNGs are unchanged copies of generated outputs, including their provenance metadata.

The materials draw on Quake's worn stone, Quake II's industrial iron, and Quake III's restrained arena colors. The center stays dark enough for live text. All text, controls, hover behavior, and focus state remain native UI elements.

## Files and drawing metadata

| Asset | PNG dimensions | Alpha | Source region | Source border | Display border |
| --- | --- | --- | --- | --- | --- |
| [Background](../assets/ui/menu-background.png) | 1536 × 1024 | Fully opaque RGB | Full image | None | None |
| [Panel](../assets/ui/menu-panel.png) | 1254 × 1254 | RGBA, transparent center | Full image | 160 pixels on each edge | 32 logical pixels at scale 0.2 |
| [Focus frame](../assets/ui/menu-focus.png) | 2172 × 724 | RGBA, transparent center | x=0..2172, y=68..701 | 96 pixels on each edge | 6 logical pixels at scale 0.0625 |

Region endpoints are exclusive. The focus frame's UV rectangle is `(0, 68/724)` to `(1, 701/724)`, with region dimensions 2172 × 633. The PNG stays intact; cropping occurs through UV coordinates. Panel UVs cover `(0, 0)` to `(1, 1)`.

[art-manifest.ts](../src/ui/common/art-manifest.ts) contains the paths, hashes, dimensions, UVs, source border widths, and display scales. The tooling entry point at `assets/ui/manifest.ts` re-exports that canonical metadata. `menuPanel.region` and `menuFocus.region` describe source pixels. `borderScale` changes destination border thickness without changing the sampled source corner regions. The frame center must use ordinary straight-alpha blending over the UI's own panel or control fill.

The background is a full-screen image rather than a seamless tile. It fits a 3:2 canvas directly; other aspect ratios need the UI owner's choice of crop or stretch. Decorative corner plates remain within the panel's 160-pixel source caps. The focus outline uses much smaller displayed corners so it can surround a 28-pixel control row.

## Inspection and limits

`bun run assets/ui/inspect.ts` decodes the actual files through `src/formats/images/png.ts`, checks their dimensions and SHA-256 hashes, and measures every alpha sample. The command passed for all three files.

The background contains 1,572,864 opaque pixels. The panel contains 1,173,850 fully transparent pixels, 397,241 partial-alpha pixels, and 1,425 opaque pixels. The focus frame contains 1,396,697 fully transparent pixels, 172,488 partial-alpha pixels, and 3,343 opaque pixels. Both frame centers have alpha zero. Their partial alpha is retained, so they blend with the underlying native fill.

Visual inspection accepted the dark center, consistent stone and iron materials, plain straight edge sections, and warm focus accent. An initial background contained recognizable emblems despite the prompt's exclusion; a targeted image-generation edit removed them. Only the corrected background is included in the workspace. The frames contain no text, lettering, or baked controls.

These checks establish usable raster files and source-slice metadata. Native SDL composition, text contrast over every screen, keyboard focus behavior, and CPU/OpenGL consistency require the UI integration tests. This art review does not establish a complete native UI.

## Generation provenance

The generator saved originals under `/home/buzzkill/.codex/generated_images/01a08eef-7a22-7b30-8721-5ccbf7357644/`.

| Selected asset | Original generated filename |
| --- | --- |
| Background | `exec-6b86cd7b-5e52-4b38-be21-0fc6a9ae432a.png` |
| Panel | `exec-3f15a827-e885-4a15-8719-8ad740f6ebff.png` |
| Focus frame | `exec-53d0db4a-fb91-4492-a05f-577ac452ee90.png` |

The original background before the edit is `exec-41bf18b9-3b91-4360-af51-a03c91c0ae67.png`. It remains in the generation directory and is not a project asset.

## Prompt set

### Background generation

```text
Use case: stylized-concept. Asset type: reusable native SDL game menu BACKGROUND TEXTURE, a single raster asset, not a screenshot or UI mockup. Create a polished restrained dark texture for a unified Quake-family game menu. Drawing on actual Quake 1 menu materials (weathered brown stone and faint carved runic shapes), Quake 2 industrial panels (dark oxidized steel, subdued rust and copper), and Quake 3 Arena's sparse charcoal and deep crimson accents. Wide landscape canvas, ideally 1536x1024. Extremely dark low-contrast quiet center covering at least the central 70%, usable behind live text and real controls. Slightly stronger authentic worn stone/steel construction along outer edges; crisp tactile detail without noise behind controls. Orthographic flat surface, full bleed, opaque RGB or RGBA PNG. No lettering, no words, no numbers, no logos, no drawn buttons, no screen layouts, no weapons, no characters, no bright lights. No checkerboards. Cohesive charcoal, weathered umber, oxidized iron, dim copper, a trace of dark crimson. This must be a usable background material asset, not a painted inert interface.
```

### Background correction

The edit references the initial background file listed above.

```text
Use case: precise-object-edit. This is the reusable native game menu background texture. Change only the two large recognizable Quake-shaped carved emblems in the upper-left and upper-right stone side panels: remove both symbols completely and replace each with matching plain weathered stone with natural small cracks. No replacement emblem, rune, lettering or symbol. Preserve all other pixels and composition as closely as possible: same 1536x1024 dimensions, full-bleed dark charcoal/umber weathered stone and iron, dim copper/rust accents, extremely quiet dark center, same brightness and industrial edging. Keep this an opaque background texture, no text, no logos, no painted controls.
```

### Panel generation

```text
Use case: stylized-concept. Asset type: reusable PNG nine-slice FRAME for a native SDL game menu, not a UI screenshot. Create ONE square empty panel border only, ideally 1024x1024, with a genuinely transparent RGBA background AND entirely transparent empty center. Front-facing orthographic flat rectangle. The visible border lies within the outermost 64 pixels, straight along all four canvas edges; all ornaments confined to 64x64 pixel corner squares so middle edges can stretch. Tight crop around the rectangle border; no extra outer margins. Material: dark weathered charcoal iron with restrained oxidized copper bevel, tiny worn industrial fasteners at corners, faint abstract stone scratches, influenced by Quake 1 runic stone, Quake 2 industrial panels and Quake 3's restrained arena menu palette. No literal rune symbols or logos. Sophisticated compact readable interface material with simple straight repeating edges. Interior at least 896x896 completely transparent, no dark fill, no noise, no illustration, no checkerboard painted in the center. No text, no lettering, no numbers, no controls, no scene, no backdrop, no shadows outside the frame. This is a compositable transparent game UI border asset. Actual alpha channel is essential.
```

### Focus frame generation

```text
Use case: stylized-concept. Asset type: a single transparent PNG focus-ring border for a real interactive native SDL game menu. Make ONE very wide shallow rectangular EMPTY selection frame, ideally 1536x384 canvas, or the closest supported wide ratio. ACTUAL transparent RGBA outside and entirely transparent inside. Tight crop with the frame along canvas edges, no surrounding padding. Slender weathered charcoal-iron edge with a subtle warm amber/copper illuminated inner hairline, tiny muted crimson corner accents. Crisp enough to remain visible when reduced to a 512x28-pixel menu control row. All corner ornaments confined to corner squares, straight simple middle edges so nine-slice stretching works. Keep the border visually thin, avoid massive corner plates, thick slabs or broad glows. The look belongs with dark Quake-family worn stone and industrial iron menu materials, yet no literal Quake symbols, letters or logos. No text, no numbers, no faux buttons, no filled panel, no background color, no checkerboard pattern, no characters. This is only the reusable empty focus outline asset, not a screenshot or a full menu. Preserve actual transparent alpha in the center.
```

The generated sizes and border extents differ from the requested ideals. The manifest records measured dimensions and conservative source caps rather than treating prompt dimensions as output facts.
