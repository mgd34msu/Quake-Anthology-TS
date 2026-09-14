import { freemem } from 'node:os';
import type { InputBindingTarget, InputAction, PhysicalInput } from '../../../contracts/ui.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import type { LightingSample } from '../../../materials/q3-lighting.ts';
import { QvmCgameImport, QvmUiImport } from '../../../compat/qvm/abi.ts';
import type { QvmHostCall, QvmHostResult } from '../../../compat/qvm/syscalls.ts';
import { GlRenderer } from '../../../render/gl/renderer.ts';
import { keynumToString } from '../../../input/keys.ts';
import { KeyCode } from '../../../input/key-codes.ts';
import { readSdlClipboard } from '../../../platform/sdl.ts';
import type { NativeRenderer } from '../renderer.ts';
import type { LocalInput } from '../input.ts';
import type { ApplicationQ3Assets } from './assets.ts';
import type { ApplicationQ3Services } from './services.ts';

export interface QvmApplicationScalarOptions {
  readonly renderer: Pick<NativeRenderer, "backend">;
  viewport(): { readonly width: number; readonly height: number };
  readonly local: LocalInput;
  readonly media: ApplicationQ3Assets;
  readonly services: ApplicationQ3Services;
  readonly now: () => number;
  readonly keyCatcher: { get(): number; set(value: number): void };
  clientState(): { readonly phase: number; readonly connectPacketCount: number; readonly clientNumber: number; readonly serverName: string; readonly message: string };
  lightForPoint(point: Vec3): LightingSample;
  assertCurrent(): void;
}
const actionCommands: Readonly<Record<InputAction, string>> = {
  attack: "+attack", jump: "+moveup", forward: "+forward", back: "+back", "move-left": "+moveleft", "move-right": "+moveright",
  "move-up": "+moveup", "move-down": "+movedown", use: "+use", crouch: "+movedown", walk: "+speed", scores: "+scores",
  "next-weapon": "weapnext", "previous-weapon": "weapprev", menu: "togglemenu",
};
function bindingCommand(target: InputBindingTarget): string { return target.kind === "command" ? target.text : actionCommands[target.action]; }
function physical(key: number): PhysicalInput {
  return key >= KeyCode.Mouse1 && key <= KeyCode.Mouse5 ? { kind: 'mouse-button', button: key - KeyCode.Mouse1 + 1 } : { kind: 'key', code: key };
}
function vector(view: DataView, offset = 0): Vec3 { return { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) }; }
function writeVector(view: DataView, value: Vec3): void { view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true); }

export class QvmApplicationScalars {
  constructor(readonly options: QvmApplicationScalarOptions) {}
  dispatch(call: QvmHostCall, updateScreen: () => Promise<void>): QvmHostResult | null {
    this.options.assertCurrent();
    if (call.kind !== 'engine' || call.role !== 'ui' && call.role !== 'cgame') return null;
    const o = this.options, { guest, words } = call, ui = call.role === 'ui', code = call.code;
    if (code === (ui ? QvmUiImport.UI_GETGLCONFIG : QvmCgameImport.CG_GETGLCONFIG)) {
      const pointer = words.getInt32(4, true), record = guest.view(pointer, 11332), renderer = o.renderer.backend, viewport = o.viewport();
      guest.span(pointer, 11332).fill(0);
      const gl = renderer instanceof GlRenderer ? renderer : null;
      guest.writeString(pointer, gl?.driver.renderer ?? 'Quake Anthology software renderer', 1024);
      guest.writeString(pointer + 1024, gl?.driver.vendor ?? 'Quake Anthology', 1024);
      guest.writeString(pointer + 2048, gl?.driver.version ?? 'software', 1024);
      record.setInt32(11264, gl?.maxTextureSize ?? 0, true); record.setInt32(11268, gl?.textureUnits ?? 0, true);
      record.setInt32(11272, gl?.colorBits ?? 24, true); record.setInt32(11276, gl?.depthBits ?? 64, true); record.setInt32(11280, renderer.stencilBits, true);
      record.setInt32(11304, viewport.width, true); record.setInt32(11308, viewport.height, true);
      record.setFloat32(11312, viewport.width / viewport.height, true); record.setInt32(11324, Number(gl?.stereoEnabled ?? false), true);
      return 0;
    }
    if (ui && code === QvmUiImport.UI_GETCLIENTSTATE) {
      const pointer = words.getInt32(4, true), record = guest.view(pointer, 3084), state = o.clientState();
      guest.span(pointer, 3084).fill(0); record.setInt32(0, state.phase, true); record.setInt32(4, state.connectPacketCount, true); record.setInt32(8, state.clientNumber, true);
      guest.writeString(pointer + 12, state.serverName, 1024); guest.writeString(pointer + 2060, state.message, 1024); return 0;
    }
    if (code === (ui ? QvmUiImport.UI_MEMORY_REMAINING : QvmCgameImport.CG_MEMORY_REMAINING)) return Math.min(0x7fffffff, freemem());
    if (code === (ui ? QvmUiImport.UI_UPDATESCREEN : QvmCgameImport.CG_UPDATESCREEN)) return updateScreen().then(() => { o.assertCurrent(); return 0; });
    if (code === (ui ? QvmUiImport.UI_KEY_ISDOWN : QvmCgameImport.CG_KEY_ISDOWN)) return Number(o.local.input.isDown(physical(words.getInt32(4, true))));
    if (code === (ui ? QvmUiImport.UI_KEY_GETCATCHER : QvmCgameImport.CG_KEY_GETCATCHER)) return o.keyCatcher.get();
    if (code === (ui ? QvmUiImport.UI_KEY_SETCATCHER : QvmCgameImport.CG_KEY_SETCATCHER)) { o.keyCatcher.set(words.getInt32(4, true)); return 0; }
    if (ui) {
      switch (code) {
        case QvmUiImport.UI_KEY_KEYNUMTOSTRINGBUF: guest.writeString(words.getInt32(8, true), keynumToString(words.getInt32(4, true)), words.getInt32(12, true)); return 0;
        case QvmUiImport.UI_KEY_GETBINDINGBUF: {
          const binding = o.local.input.binding(physical(words.getInt32(4, true)));
          guest.writeString(words.getInt32(8, true), binding === null ? '' : bindingCommand(binding), words.getInt32(12, true)); return 0;
        }
        case QvmUiImport.UI_KEY_SETBINDING: o.local.input.bind({ input: physical(words.getInt32(4, true)), target: { kind: 'command', text: guest.readString(words.getInt32(8, true)) } }); return 0;
        case QvmUiImport.UI_KEY_GETOVERSTRIKEMODE: return Number(o.local.console.field.overstrike);
        case QvmUiImport.UI_KEY_SETOVERSTRIKEMODE: o.local.console.field.overstrike = words.getInt32(4, true) !== 0; return 0;
        case QvmUiImport.UI_KEY_CLEARSTATES: o.local.input.release(o.now()); return 0;
        case QvmUiImport.UI_GETCLIPBOARDDATA: {
          const bytes = readSdlClipboard(); guest.writeString(words.getInt32(4, true), bytes === null ? '' : new TextDecoder().decode(bytes), words.getInt32(8, true)); return 0;
        }
      }
    } else if (code === QvmCgameImport.CG_KEY_GETKEY) {
      const name = guest.readString(words.getInt32(4, true));
      const binding = o.local.input.bindings.find(binding => bindingCommand(binding.target).toLowerCase() === name.toLowerCase());
      return binding?.input.kind === 'key' ? binding.input.code : binding?.input.kind === 'mouse-button' ? KeyCode.Mouse1 + binding.input.button - 1 : -1;
    }
    if (code === (ui ? QvmUiImport.UI_REAL_TIME : QvmCgameImport.CG_REAL_TIME)) {
      const time = new Date(), pointer = words.getInt32(4, true);
      if (pointer !== 0) {
        const view = guest.view(pointer, 36), january = new Date(time.getFullYear(), 0, 1), july = new Date(time.getFullYear(), 6, 1);
        const fields = [time.getSeconds(), time.getMinutes(), time.getHours(), time.getDate(), time.getMonth(), time.getFullYear() - 1900, time.getDay(),
          Math.floor((Date.UTC(time.getFullYear(), time.getMonth(), time.getDate()) - Date.UTC(time.getFullYear(), 0, 1)) / 86400000), Number(time.getTimezoneOffset() < Math.max(january.getTimezoneOffset(), july.getTimezoneOffset()))];
        fields.forEach((value, index) => view.setInt32(index * 4, value, true));
      }
      return Math.trunc(time.getTime() / 1000) | 0;
    }
    if (!ui && code === QvmCgameImport.CG_R_LIGHTFORPOINT) {
      const light = o.lightForPoint(vector(guest.view(words.getInt32(4, true), 12)));
      writeVector(guest.view(words.getInt32(8, true), 12), light.ambientLight); writeVector(guest.view(words.getInt32(12, true), 12), light.directedLight); writeVector(guest.view(words.getInt32(16, true), 12), light.lightDir); return 1;
    }
    if (code === (ui ? QvmUiImport.UI_R_REGISTERFONT : QvmCgameImport.CG_R_REGISTERFONT)) {
      const name = words.getInt32(4, true), size = words.getInt32(8, true), pointer = words.getInt32(12, true);
      return o.media.fonts.registerFont(name === 0 ? null : guest.readString(name), size, o.media.print, () => { o.assertCurrent(); return guest.span(pointer, 20548); }).then(async font => {
        o.assertCurrent();
        if (font === null) return 0;
        for (let index = 0; index < 255; index++) {
          const path = guest.readString(pointer + index * 80 + 48), shader = await o.services.resources.registerShaderNoMip(path);
          o.assertCurrent(); guest.view(pointer + index * 80 + 44, 4).setInt32(0, o.services.resources.shaderHandle(shader), true);
        }
        return 0;
      });
    }
    return null;
  }
}
