import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import type { Rect, SceneCamera } from "../../contracts/render.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";
import type { CommandDialect } from "../../contracts/common.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { NumericProfile } from "../../contracts/numeric.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import { anglesToAxis, donorAngleVectors, mutableVec3 } from "../../core/math.ts";
import { nativeAtoi, createNumericOperations } from "../../core/numeric.ts";

export function registerQ1ViewCommands(commands: CommandBuffer): () => void {
  if (commands.dialect !== "q1-netquake" && commands.dialect !== "q1-quakeworld") return () => {};
  const registered: string[] = [];
  for (const [name, step] of [["sizeup", 10], ["sizedown", -10]] satisfies readonly (readonly [string, number])[]) {
    if (commands.exists(name)) continue;
    if (commands.register(name, command => {
      const size = commands.findCvar("viewsize", command.source);
      if (size !== undefined) command.insert(`viewsize ${size.numericValue + step}\n`);
    })) registered.push(name);
  }
  if (commands.dialect === "q1-netquake") {
    if (!commands.exists("name") && commands.findCvar("name") === undefined && commands.register("name", command => {
      if (command.args.length === 0) { command.executeNow("_cl_name"); return; }
      const name = (command.args.length === 1 ? command.args[0] ?? "" : command.argsText).slice(0, 15).replace(/["\n\r]/g, "");
      command.executeNow(`_cl_name "${name}"`); return undefined;
    })) registered.push("name");
    if (!commands.exists("color") && commands.findCvar("color") === undefined && commands.register("color", command => {
      if (command.args.length === 0) { command.executeNow("_cl_color"); return; }
      const top = Math.min(13, nativeAtoi(command.args[0] ?? "") & 15), bottom = Math.min(13, nativeAtoi(command.args[1] ?? command.args[0] ?? "") & 15);
      command.executeNow(`_cl_color ${top * 16 + bottom}`); return undefined;
    })) registered.push("color");
  }
  if (commands.dialect === "q1-quakeworld" && !commands.exists("color") && commands.register("color", command => {
    if (command.args.length === 0) { command.executeNow("topcolor"); command.executeNow("bottomcolor"); return; }
    const top = Math.min(13, nativeAtoi(command.args[0] ?? "") & 15), bottom = Math.min(13, nativeAtoi(command.args[1] ?? command.args[0] ?? "") & 15);
    command.executeNow(`topcolor ${top}`); command.executeNow(`bottomcolor ${bottom}`); return undefined;
  })) registered.push("color");
  return () => { for (const name of registered) commands.unregister(name); };
}

/** Native Q1 view declarations belong to the client before quake.rc executes. */
export function registerQ1ClientSettings(cvars: CvarRegistry, profile: CommandDialect | "all" = cvars.dialect): void {
  if (profile !== "all" && profile !== "q1-netquake" && profile !== "q1-quakeworld") return;
  cvars.register("viewsize", "100", CvarFlag.Archive);
  if (profile === "all" || profile === "q1-quakeworld") cvars.register("cl_sbar", "0", CvarFlag.Archive);
  cvars.bindValue("viewsize", { validate: value => value.trim() !== "" && Number.isFinite(Number(value)) ? null : "Expected a finite number", changed: () => undefined });
  cvars.document("viewsize", { summary: "Quake view size. 30 through 100 sizes the scene; 110 removes the inventory margin, 120 hides the status display.", usage: "viewsize <30..120>", examples: ["viewsize 100", "viewsize 120"] });
  if (profile === "all" || profile === "q1-netquake") for (const [name, value, summary] of [
    ["chase_active", "0", "Enable the local chase camera without changing player aim."],
    ["chase_back", "100", "Chase distance behind the player, in world units."],
    ["chase_up", "16", "Chase height above the eye, in world units."],
    ["chase_right", "0", "Q1 lateral chase offset: positive moves opposite the view's right vector."],
  ] satisfies readonly (readonly [string, string, string])[]) {
    cvars.register(name, value);
    cvars.bindValue(name, { validate: input => input.trim() !== "" && Number.isFinite(Number(input)) ? null : "Expected a finite number", changed: () => undefined });
    cvars.document(name, { summary, usage: `${name} <number>`, examples: [`${name} ${value}`] });
  }
}

export interface Q1ChaseSettings { readonly back: number; readonly up: number; readonly right: number; }
export interface Q1ViewSettings { readonly size: number; readonly overlayStatus: boolean; readonly chase: Q1ChaseSettings | null; }

export function readQ1ViewSettings(cvars: CvarRegistry | null, profile: CommandDialect | undefined = cvars?.dialect): Q1ViewSettings | null {
  if (profile !== "q1-netquake" && profile !== "q1-quakeworld") return null;
  const current = cvars?.find("viewsize");
  if (cvars === null || current === undefined) return null;
  const size = Math.max(30, Math.min(120, current.numericValue));
  if (size !== current.numericValue) cvars.set("viewsize", String(size));
  return { size, overlayStatus: profile === "q1-quakeworld" && cvars.variableValue("cl_sbar") === 0,
    chase: profile === "q1-netquake" && cvars.variableValue("chase_active") !== 0
      ? { back: cvars.variableValue("chase_back"), up: cvars.variableValue("chase_up"), right: cvars.variableValue("chase_right") } : null };
}

/** Q1 offsets, shared obstruction queries, and a drawing-only aim correction. */
export function q1ChaseCamera(camera: SceneCamera, angles: Vec3, settings: Q1ChaseSettings,
  scene: Pick<SceneQueries, "trace">, numeric: NumericProfile, actor: ActorId): SceneCamera {
  const math = createNumericOperations(numeric), forward = mutableVec3(), right = mutableVec3();
  donorAngleVectors(angles, forward, right, null);
  const offset = (eye: number, ahead: number, side: number): number => math.store(math.subtract(
    math.subtract(eye, math.multiply(ahead, settings.back)), math.multiply(side, settings.right)));
  const desired = { x: offset(camera.origin.x, forward.x, right.x), y: offset(camera.origin.y, forward.y, right.y),
    z: math.store(math.add(camera.origin.z, settings.up)) };
  const common = { start: camera.origin, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric, passActor: actor } satisfies Omit<Parameters<SceneQueries["trace"]>[0], "end" | "shape">;
  const rear = scene.trace({ ...common, end: desired, shape: { kind: "box", bounds: { min: { x: -4, y: -4, z: -4 }, max: { x: 4, y: 4, z: 4 } } } });
  const origin = rear.startSolid || rear.allSolid ? camera.origin : rear.end;
  const far = { x: math.store(math.add(camera.origin.x, math.multiply(forward.x, 4096))),
    y: math.store(math.add(camera.origin.y, math.multiply(forward.y, 4096))), z: math.store(math.add(camera.origin.z, math.multiply(forward.z, 4096))) };
  const aim = scene.trace({ ...common, end: far, shape: { kind: "point" } });
  const target = aim.fraction === 1 || aim.startSolid || aim.allSolid ? far : aim.end;
  const delta = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z }, horizontal = Math.hypot(delta.x, delta.y);
  const viewAngles = { x: math.store(-Math.atan2(delta.z, horizontal) * 180 / Math.PI),
    y: horizontal === 0 ? angles.y : math.store(Math.atan2(delta.y, delta.x) * 180 / Math.PI), z: angles.z };
  return { ...camera, origin, axis: anglesToAxis(viewAngles) };
}

/** SCR_CalcRefdef's rectangle; split-screen uses each seat's bounds. */
export function q1ViewRectangle(area: Rect, viewsize: number, intermission: boolean, overlayStatus = false): Rect {
  const size = intermission ? 120 : Math.max(30, Math.min(120, viewsize));
  const lines = size >= 120 ? 0 : size >= 110 ? 24 : 48;
  const available = Math.max(1, area.height - (overlayStatus && size >= 100 ? 0 : lines));
  const fraction = Math.min(size, 100) / 100;
  const width = Math.min(area.width, Math.max(96, Math.trunc(area.width * fraction)));
  const height = Math.max(1, Math.min(available, Math.trunc(area.height * fraction)));
  return { x: area.x + Math.trunc((area.width - width) / 2), y: area.y + (size >= 100 ? 0 : Math.trunc((available - height) / 2)), width, height };
}

export function q1ViewCamera(camera: SceneCamera, area: Rect, settings: Q1ViewSettings, intermission: boolean): SceneCamera {
  const viewport = q1ViewRectangle(area, settings.size, intermission, settings.overlayStatus);
  const ratio = viewport.width / viewport.height / (camera.viewport.width / camera.viewport.height), p = camera.projection;
  return { ...camera, viewport, projection: [p[0], p[1] * ratio, p[2], p[3], p[4], p[5] * ratio, p[6], p[7],
    p[8], p[9] * ratio, p[10], p[11], p[12], p[13] * ratio, p[14], p[15]] };
}
