import { join, relative, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

type Area = "content-assets" | "rendering" | "audio-music" | "input-seats" | "console-config" | "networking" | "downloads" | "server-browser-admin" | "mods-vms" | "movement-bodies" | "ai-navigation" | "combat-rosters-equipment" | "maps-campaigns" | "modes-objectives" | "saves-recovery" | "menus-hud" | "localization-accessibility" | "progression-services" | "demos-recording" | "cinematics-media" | "tools-diagnostics";
const areas: readonly Area[] = ["content-assets", "rendering", "audio-music", "input-seats", "console-config", "networking", "downloads", "server-browser-admin", "mods-vms", "movement-bodies", "ai-navigation", "combat-rosters-equipment", "maps-campaigns", "modes-objectives", "saves-recovery", "menus-hud", "localization-accessibility", "progression-services", "demos-recording", "cinematics-media", "tools-diagnostics"];
type Family = "q1" | "q2" | "q3";
interface Rule { readonly area: Area; readonly secondaryDependencies?: readonly Area[]; readonly note?: string; }
const categories: Readonly<Record<string, Area>> = {
  "q1.content": "content-assets", "q1.execution": "mods-vms", "q1.hipnotic": "combat-rosters-equipment", "q1.horde": "modes-objectives", "q1.ctf": "modes-objectives", "q1.multiplayer": "server-browser-admin", "q1.seats": "input-seats", "q1.bots": "ai-navigation", "q1.input": "input-seats", "q1.ui": "menus-hud", "q1.text": "localization-accessibility", "q1.accessibility": "localization-accessibility", "q1.render": "rendering", "q1.video": "rendering", "q1.saves": "saves-recovery", "q1.demos": "demos-recording", "q1.config": "console-config", "q1.network": "networking", "q1.events": "progression-services", "q1.services": "progression-services", "q1.physics": "movement-bodies", "q1.tools": "tools-diagnostics", "q1.mg3": "combat-rosters-equipment",
  "q2.content": "content-assets", "q2.game": "mods-vms", "q2.inventory": "combat-rosters-equipment", "q2.powerup": "combat-rosters-equipment", "q2.combat": "combat-rosters-equipment", "q2.world": "rendering", "q2.xatrix": "combat-rosters-equipment", "q2.rogue": "combat-rosters-equipment", "q2.rerelease": "combat-rosters-equipment", "q2.mode": "modes-objectives", "q2.seats": "input-seats", "q2.bots": "ai-navigation", "q2.navigation": "ai-navigation", "q2.hud": "menus-hud", "q2.accessibility": "localization-accessibility", "q2.input": "input-seats", "q2.audio": "audio-music", "q2.music": "audio-music", "q2.media": "cinematics-media", "q2.save": "saves-recovery", "q2.campaign": "maps-campaigns", "q2.service": "progression-services", "q2.demo": "demos-recording", "q2.network": "networking", "q2.browser": "server-browser-admin", "q2.admin": "server-browser-admin", "q2.config": "console-config",
  "q3.progression": "progression-services", "q3.modes": "modes-objectives", "q3.bots": "ai-navigation", "q3.admin": "server-browser-admin", "q3.network": "networking", "q3.discovery": "server-browser-admin", "q3.services": "progression-services", "q3.content": "content-assets", "q3.execution": "mods-vms", "q3.ui": "menus-hud", "q3.presentation": "rendering", "q3.formats": "content-assets", "q3.input": "input-seats", "q3.audio": "audio-music", "q3.media": "cinematics-media", "q3.recording": "demos-recording", "q3.configuration": "console-config", "q3.diagnostics": "tools-diagnostics", "q3.persistence": "saves-recovery", "q3.cameras": "rendering", "q3.source-applications": "tools-diagnostics",
};
const overrides: Readonly<Record<string, Rule>> = {
  "q1.content.launch-selection": { area: "mods-vms", secondaryDependencies: ["content-assets", "menus-hud"], note: "Provider/gamecode selection spans discovery and launch UI; assigned once to execution selection." },
  "q1.execution.entity-properties": { area: "maps-campaigns", secondaryDependencies: ["mods-vms", "combat-rosters-equipment"], note: "Foreign entity fields and target graphs span adapters and roster admission; assigned to authored map behavior." },
  "q1.ctf.grapple-observer-vote": { area: "modes-objectives", secondaryDependencies: ["combat-rosters-equipment", "server-browser-admin"], note: "One retained row combines grapple, observer and voting requirements; it is not split or duplicated." },
  "q1.multiplayer.chat": { area: "networking", secondaryDependencies: ["menus-hud"], note: "Message routing and presentation coexist; assigned to communication behavior." },
  "q1.multiplayer.setup": { area: "server-browser-admin", secondaryDependencies: ["menus-hud", "modes-objectives"], note: "Match configuration includes a public setup workflow; assigned to hosting administration." },
  "q1.seats.presentation-ownership": { area: "input-seats", secondaryDependencies: ["rendering", "audio-music", "demos-recording", "menus-hud"], note: "The row explicitly crosses presentation services; its single organizing behavior is seat ownership." },
  "q1.seats.qw-native-extension": { area: "input-seats", secondaryDependencies: ["networking"], note: "Local seat ownership crosses native wire limits; assigned once to seats." },
  "q1.bots.ctf-coop-horde": { area: "ai-navigation", secondaryDependencies: ["modes-objectives"], note: "Bot participation requires mode-specific objective policies; its primary behavior is AI." },
  "q1.network.discovery": { area: "server-browser-admin" },
  "q1.network.downloads": { area: "downloads" },
  "q1.network.admission-admin": { area: "server-browser-admin", secondaryDependencies: ["networking"], note: "Admission wire behavior and operator policy share one row; assigned to administration." },
  "q1.events.prompts": { area: "menus-hud", secondaryDependencies: ["localization-accessibility"], note: "Choice prompts include localized text; assigned to the interactive prompt workflow." },
  "q1.events.level-completed-lobby": { area: "progression-services", secondaryDependencies: ["maps-campaigns"], note: "Level completion and lobby return share one row; assigned to external/session lifecycle." },
  "q1.services.addon-discovery": { area: "content-assets", secondaryDependencies: ["progression-services", "menus-hud"], note: "Local/online add-on discovery includes service/UI joins; assigned to content discovery." },
  "q2.content.native-starts": { area: "maps-campaigns" },
  "q2.content.start-map-discovery": { area: "maps-campaigns", secondaryDependencies: ["content-assets"], note: "Map metadata discovery serves campaign-start resolution." },
  "q2.content.server-map-lists": { area: "server-browser-admin", secondaryDependencies: ["maps-campaigns", "modes-objectives"], note: "Map eligibility and selection are assigned to server setup." },
  "q2.content.rotation-editor": { area: "server-browser-admin", secondaryDependencies: ["maps-campaigns", "menus-hud"], note: "Persisted rotation editing is assigned to server administration." },
  "q2.rerelease.squad-respawn-lives": { area: "modes-objectives" },
  "q2.rerelease.q64-movement": { area: "movement-bodies" },
  "q2.media.cin-soundtrack": { area: "audio-music", secondaryDependencies: ["cinematics-media"], note: "CIN synchronization remains a cross-media dependency; this row is assigned to its soundtrack behavior." },
  "q2.media.timed-subtitles": { area: "localization-accessibility", secondaryDependencies: ["cinematics-media"], note: "Cinematic scheduling is required, but the visible behavior is subtitles/captions." },
  "q2.network.connectionless-rcon": { area: "server-browser-admin", secondaryDependencies: ["networking"], note: "Connectionless packet support serves status/ping/challenge/rcon administration." },
  "q2.config.audio-video-input-menus": { area: "menus-hud", secondaryDependencies: ["console-config", "audio-music", "rendering", "input-seats"], note: "One row covers settings across several services; assigned to the public menu workflow." },
  "q2.config.renderer-restart": { area: "rendering" },
  "q3.progression.catalog": { area: "content-assets", secondaryDependencies: ["progression-services"], note: "Arena/bot catalog discovery supports progression but is a content inventory behavior." },
  "q3.progression.podium-postgame": { area: "menus-hud", secondaryDependencies: ["progression-services", "modes-objectives"], note: "Postgame display/navigation crosses match progression; assigned to its public presentation workflow." },
  "q3.network.ipx-transport": { area: "networking", note: "Historical IPX remains a transport obligation within networking." },
  "q3.content.pure-policy": { area: "networking", secondaryDependencies: ["content-assets", "mods-vms"], note: "Pure-policy enforcement belongs to network admission, using package and mod/filesystem identity." },
  "q3.content.mod-selection": { area: "mods-vms" },
  "q3.ui.base-host-browser-ingame": { area: "menus-hud", secondaryDependencies: ["server-browser-admin"], note: "Host/browser behavior is represented here by its UI row; no backend row is duplicated." },
  "q3.ui.base-demos-cinematics-configs": { area: "menus-hud", secondaryDependencies: ["demos-recording", "cinematics-media", "console-config"], note: "Retained row explicitly requires menus over multiple services." },
  "q3.ui.team-arena-skirmish": { area: "menus-hud", secondaryDependencies: ["modes-objectives", "progression-services"], note: "Skirmish launch/next-match flow is a UI entry point with mode dependencies." },
  "q3.presentation.fonts-and-glyphs": { area: "localization-accessibility", secondaryDependencies: ["rendering"], note: "Glyph rendering and legibility share this font requirement." },
  "q3.presentation.accessibility-scales": { area: "localization-accessibility" },
  "q3.audio.a3d-geometry-contract": { area: "audio-music", note: "The A3D geometry contract remains an audio obligation." },
  "q3.media.subtitles-captions": { area: "localization-accessibility", secondaryDependencies: ["cinematics-media"], note: "Timed media dependency retained; assigned to caption behavior." },
  "q3.recording.screenshots-levelshots": { area: "tools-diagnostics", secondaryDependencies: ["rendering"], note: "Screenshot and levelshot capture belongs to tools, with rendered output and frame timing dependencies." },
  "q3.cameras.spline-runtime": { area: "tools-diagnostics", secondaryDependencies: ["rendering"], note: "Spline evaluation and timed camera tooling depend on rendered camera presentation." },
  "q3.input.midi-controller": { area: "input-seats", note: "MIDI device configuration and note input belong to input alongside other controllers." },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUnknownArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error("Expected object");
  return value;
}
function text(value: unknown): string { if (typeof value !== "string") throw new Error("Expected string"); return value; }
function strings(value: unknown): string[] { if (!isUnknownArray(value)) throw new Error("Expected string list"); return value.map(text); }
interface OpenRow { readonly id: string; readonly title: string; readonly originalRemainingWorkReason: string; readonly sourceFamily: Family; readonly status: "not-done"; readonly basis: string; readonly sourcePaths: readonly string[]; readonly functionalArea: Area; readonly classification: Rule; }
const args = process.argv.slice(2);
if (args.length > 2) throw new Error("Usage: bun docs/functional-targets/group-remaining.ts [input-ledger.json] [output-directory]");
const inputPath = resolve(args[0] ?? "docs/completion-status.json"), root = resolve(args[1] ?? "docs/functional-targets");
await mkdir(root, { recursive: true });
const bytes = await Bun.file(inputPath).bytes(), parsed: unknown = JSON.parse(new TextDecoder().decode(bytes)), ledger = object(parsed), rawRows = ledger["rows"];
if (!isUnknownArray(rawRows)) throw new Error("Missing ledger rows");
const rows: OpenRow[] = [];
for (const raw of rawRows) {
  const value = object(raw); if (value["status"] !== "not-done") continue;
  const id = text(value["id"]), [sourceFamily, category] = id.split(".");
  if (sourceFamily !== "q1" && sourceFamily !== "q2" && sourceFamily !== "q3") throw new Error(`Unknown family: ${id}`);
  const area = categories[`${sourceFamily}.${category}`], override = overrides[id];
  if (area === undefined && override === undefined) throw new Error(`Unclassified row: ${id}`);
  const classification: Rule | undefined = override ?? (area === undefined ? undefined : { area });
  if (classification === undefined) throw new Error(`Missing classification: ${id}`);
  rows.push({ id, title: text(value["title"]), originalRemainingWorkReason: text(value["reason"]), sourceFamily, status: "not-done", basis: text(value["basis"]), sourcePaths: strings(value["paths"]), functionalArea: classification.area, classification });
}
rows.sort((a, b) => a.id.localeCompare(b.id));
if (rows.length !== 184 || new Set(rows.map(row => row.id)).size !== 184) throw new Error("Expected exactly 184 unique open requirements");
for (const id of Object.keys(overrides)) if (!rows.some(row => row.id === id)) throw new Error(`Stale override: ${id}`);
const groups = areas.map(area => { const assigned = rows.filter(row => row.functionalArea === area); return { area, total: assigned.length, q1: assigned.filter(row => row.sourceFamily === "q1").length, q2: assigned.filter(row => row.sourceFamily === "q2").length, q3: assigned.filter(row => row.sourceFamily === "q3").length, rows: assigned }; });
const totals = { total: rows.length, q1: rows.filter(row => row.sourceFamily === "q1").length, q2: rows.filter(row => row.sourceFamily === "q2").length, q3: rows.filter(row => row.sourceFamily === "q3").length };
if (totals.q1 !== 56 || totals.q2 !== 75 || totals.q3 !== 53 || groups.reduce((sum, group) => sum + group.total, 0) !== 184) throw new Error("Grouping totals do not reconcile");
const dependencies = rows.filter(row => row.classification.secondaryDependencies !== undefined).map(row => ({ id: row.id, assigned: row.functionalArea, secondaryDependencies: row.classification.secondaryDependencies, note: row.classification.note }));
const report = { retainedLedgerCutoff: text(ledger["sourceCutoff"]), input: { path: relative(process.cwd(), inputPath), sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }, interpretation: "Mechanical grouping of retained open implementation verdicts. No verdict changes or later-acceptance reconciliation. Primary functional placements do not assign common-engine versus source-extension architecture. Secondary dependencies are reported separately and never counted as additional rows. Input provenance is identified by path, assessment cutoff and SHA-256; no repository revision is inferred from an arbitrary input file.", totals, groups, dependencies };
await Bun.write(join(root, "remaining-source-rows.json"), JSON.stringify(report, null, 2) + "\n");
const cell = (value: string): string => value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
let markdown = `# Retained remaining requirements by function\n\nRetained assessment cutoff: \`${report.retainedLedgerCutoff}\`. Input: \`${report.input.path}\`, SHA-256 \`${report.input.sha256}\`. ${report.interpretation}\n\nEvery original ID, title, reason and source family is preserved below. The JSON additionally preserves basis and source paths.\n\n| Function | Q1 | Q2 | Q3 | Total |\n|---|---:|---:|---:|---:|\n`;
markdown += groups.map(group => `| ${group.area} | ${group.q1} | ${group.q2} | ${group.q3} | ${group.total} |`).join("\n") + `\n| **Total** | **${totals.q1}** | **${totals.q2}** | **${totals.q3}** | **${totals.total}** |\n`;
markdown += "\n## Secondary dependencies\n\nEach listed requirement still occurs only once in the inventory. These are explicit secondary dependencies after the primary classification decision, not additional work items.\n\n| ID | Assigned function | Secondary dependencies | Classification note |\n|---|---|---|---|\n";
markdown += dependencies.map(value => `| \`${value.id}\` | ${value.assigned} | ${value.secondaryDependencies?.join(", ")} | ${cell(value.note ?? "")} |`).join("\n") + "\n";
for (const group of groups) {
  markdown += `\n## ${group.area} — ${group.total} retained open rows\n\n| ID | Family | Original title | Original remaining-work reason |\n|---|---|---|---|\n`;
  markdown += group.rows.map(row => `| \`${row.id}\` | ${row.sourceFamily.toUpperCase()} | ${cell(row.title)} | ${cell(row.originalRemainingWorkReason)} |`).join("\n") + "\n";
  if (group.total === 0) markdown += "No open row in this retained ledger is assigned here; this does not establish completeness outside the ledger.\n";
}
markdown += "\nReproduce with `bun docs/functional-targets/group-remaining.ts [input-ledger.json] [output-directory]`. Defaults are `docs/completion-status.json` and `docs/functional-targets`. The script contains the category mapping, explicit per-row overrides, dependency notes and uniqueness/count checks.\n";
await Bun.write(join(root, "remaining-source-rows.md"), markdown);
console.log(JSON.stringify({ totals, groups: groups.map(({ rows: _rows, ...counts }) => counts), crossFunctional: dependencies.length }, null, 2));
