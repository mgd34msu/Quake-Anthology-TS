import type { Q2ProtocolIdentity } from "../../contracts/protocol.ts";
import type { ResourceId } from "../../contracts/content.ts";
import { Tokenizer } from "../../core/common-parse.ts";
import { gameAtoi } from "../../core/game-numeric.ts";
import { q2ApplicationLayout } from "../../app/bootstrap/network/q2-layout.ts";

/** Public playerstate and received svc/configstrings only; playerNumber is zero based. */
export interface NativeQ2HudFrame {
  readonly protocol: Q2ProtocolIdentity;
  readonly stats: readonly number[];
  readonly configstrings: ReadonlyMap<number, string>;
  readonly layout: string;
  readonly inventory: readonly number[];
  readonly playerNumber: number;
  readonly serverFrame: number;
  readonly timeMilliseconds: number;
}
export type NativeQ2HudOperation =
  | { readonly kind: "picture"; readonly x: number; readonly y: number; readonly name: string }
  | { readonly kind: "arsenal-picture"; readonly x: number; readonly y: number; readonly resource: ResourceId; readonly aspect: number }
  | { readonly kind: "text"; readonly x: number; readonly y: number; readonly text: string; readonly alternate: boolean };

export interface NativeQ2HudArsenal {
  readonly ammo: number | null;
  readonly ammoIcon: { readonly resource: ResourceId; readonly aspect: number } | null;
}

/** Q2 client/cl_scrn.c SCR_ExecuteLayoutString and SCR_DrawField. */
export function q2LayoutOperations(source: string, frame: NativeQ2HudFrame, width: number, height: number, arsenal?: NativeQ2HudArsenal): readonly NativeQ2HudOperation[] {
  const out: NativeQ2HudOperation[] = [], parser = new Tokenizer(source, "Q2 HUD layout"), config = q2ApplicationLayout(frame.protocol);
  let x = 0, y = 0;
  const next = (): string => parser.next()?.value ?? "";
  const integer = (): number => gameAtoi(next());
  const stat = (index: number): number => {
    if (index < 0 || index >= frame.stats.length) throw new RangeError(`Q2 HUD stat ${index} is outside playerstate`);
    if (arsenal !== undefined && index === 2) return arsenal.ammo === null ? 0 : 1;
    if (arsenal !== undefined && index === 3) return arsenal.ammo ?? -1;
    return frame.stats[index] ?? 0;
  };
  const picture = (name: string): void => { if (name !== "") out.push({ kind: "picture", x, y, name }); };
  const text = (value: string, alternate = false, atX = x, atY = y): void => { out.push({ kind: "text", x: atX, y: atY, text: value, alternate }); };
  const number = (value: number, digits: number, alternate: boolean): void => {
    const count = Math.min(5, digits); if (count < 1) return;
    const valueText = String(Math.trunc(value)), length = Math.min(valueText.length, count);
    let px = x + 2 + 16 * (count - length);
    for (const digit of valueText.slice(0, length)) {
      out.push({ kind: "picture", x: px, y, name: `${alternate ? "anum" : "num"}_${digit === "-" ? "minus" : digit}` }); px += 16;
    }
  };
  const client = (index: number): { readonly name: string; readonly icon: string } => {
    const max = Number(frame.configstrings.get(config.maxClients) ?? "256");
    if (index < 0 || index >= Math.max(1, max)) throw new RangeError(`Q2 HUD client ${index} is outside clientinfo`);
    const info = frame.configstrings.get(config.playerSkins + index) ?? "", slash = info.indexOf("\\");
    const skin = slash < 0 ? "male/grunt" : info.slice(slash + 1);
    return { name: slash < 0 ? info : info.slice(0, slash), icon: `/players/${skin || "male/grunt"}_i.pcx` };
  };
  for (let token = parser.next(); token !== undefined; token = parser.next()) {
    switch (token.value) {
      case "xl": x = integer(); break;
      case "xr": x = width + integer(); break;
      case "xv": x = Math.trunc(width / 2) - 160 + integer(); break;
      case "yt": y = integer(); break;
      case "yb": y = height + integer(); break;
      case "yv": y = Math.trunc(height / 2) - 120 + integer(); break;
      case "pic": {
        const index = integer();
        if (index === 2 && arsenal !== undefined) {
          if (arsenal.ammo !== null && arsenal.ammoIcon !== null) out.push({ kind: "arsenal-picture", x, y, ...arsenal.ammoIcon });
          break;
        }
        const image = stat(index);
        if (image < 0 || image >= config.maxImages) throw new RangeError(`Q2 HUD image ${image} is outside configstrings`);
        picture(frame.configstrings.get(config.images + image) ?? ""); break;
      }
      case "picn": picture(next()); break;
      case "num": { const digits = integer(); number(stat(integer()), digits, false); break; }
      case "hnum": { const value = stat(1); if ((stat(15) & 1) !== 0) picture("field_3"); number(value, 3, value <= 0 || value <= 25 && ((frame.serverFrame >> 2) & 1) !== 0); break; }
      case "anum": { const value = stat(3); if (value < 0) break; if ((stat(15) & 4) !== 0) picture("field_3"); number(value, 3, value <= 5 && ((frame.serverFrame >> 2) & 1) !== 0); break; }
      case "rnum": { const value = stat(5); if (value < 1) break; if ((stat(15) & 2) !== 0) picture("field_3"); number(value, 3, false); break; }
      case "stat_string": { const index = stat(integer()); if (index < 0 || index >= config.maxConfigStrings) throw new RangeError("Q2 HUD stat_string is outside configstrings"); text(frame.configstrings.get(index) ?? ""); break; }
      case "string": case "string2": text(next(), token.value === "string2"); break;
      case "cstring": case "cstring2": {
        let py = y;
        for (const line of next().split("\n")) { text(line, token.value === "cstring2", x + Math.trunc((320 - line.length * 8) / 2), py); py += 8; }
        break;
      }
      case "client": {
        x = Math.trunc(width / 2) - 160 + integer(); y = Math.trunc(height / 2) - 120 + integer();
        const row = client(integer()), score = integer(), ping = integer(), time = integer();
        text(row.name, true, x + 32); text("Score: ", false, x + 32, y + 8); text(String(score), true, x + 88, y + 8);
        text(`Ping:  ${ping}`, false, x + 32, y + 16); text(`Time:  ${time}`, false, x + 32, y + 24); picture(row.icon); break;
      }
      case "ctf": {
        x = Math.trunc(width / 2) - 160 + integer(); y = Math.trunc(height / 2) - 120 + integer();
        const index = integer(), row = client(index), score = integer(), ping = Math.min(999, integer());
        text(`${String(score).padStart(3)} ${String(ping).padStart(3)} ${row.name.slice(0, 12).padEnd(12)}`, index === frame.playerNumber); break;
      }
      case "if": {
        if (stat(integer()) !== 0) break;
        for (let skipped = parser.next(); skipped !== undefined && skipped.value !== "endif"; skipped = parser.next()) {}
        break;
      }
    }
  }
  return out;
}

/** Q2 client/cl_inv.c: fixed authored background, selected-item scroll and source bindings. */
export function q2NativeHudOperations(frame: NativeQ2HudFrame, width: number, height: number,
  binding: (command: string) => string = () => "", mode: "layout-overlay" | "replace-status" = "replace-status", arsenal?: NativeQ2HudArsenal): readonly NativeQ2HudOperation[] {
  const out = mode === "layout-overlay" ? [] : [...q2LayoutOperations(frame.configstrings.get(5) ?? "", frame, width, height, arsenal)];
  const layouts = frame.stats[13] ?? 0;
  if ((layouts & 1) !== 0) out.push(...q2LayoutOperations(frame.layout, frame, width, height, arsenal));
  if (mode === "layout-overlay") return out;
  if ((layouts & 2) === 0) return out;
  const config = q2ApplicationLayout(frame.protocol), selected = frame.stats[12] ?? 0;
  const items = frame.inventory.flatMap((count, index) => count === 0 ? [] : [index]);
  const selectedRow = selected >= 0 && selected < frame.inventory.length ? frame.inventory.slice(0, selected).filter(count => count !== 0).length : 0;
  const top = Math.max(0, Math.min(items.length - 17, selectedRow - 8));
  const x = Math.floor((width - 256) / 2), y = Math.floor((height - 240) / 2);
  out.push({ kind: "picture", x, y: y + 8, name: "inventory" },
    { kind: "text", x: x + 24, y: y + 24, text: "hotkey ### item", alternate: false },
    { kind: "text", x: x + 24, y: y + 32, text: "------ --- ----", alternate: false });
  for (const [row, item] of items.slice(top, top + 17).entries()) {
    const name = frame.configstrings.get(config.items + item) ?? "", py = y + 40 + row * 8;
    out.push({ kind: "text", x: x + 24, y: py, text: `${binding(`use ${name}`).padStart(6)} ${String(frame.inventory[item] ?? 0).padStart(3)} ${name}`, alternate: item !== selected });
    if (item === selected && (Math.trunc(frame.timeMilliseconds / 100) & 1) !== 0) out.push({ kind: "text", x: x + 16, y: py, text: "\x0f", alternate: false });
  }
  return out;
}
