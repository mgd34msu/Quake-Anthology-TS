import { QvmCgameImport, QvmUiImport } from "../../../compat/qvm/abi.ts";
import type { QvmHostCall, QvmHostResult } from "../../../compat/qvm/syscalls.ts";
import { q3Hardware, q3HardwareNumber } from "../../../render/q3-hardware.ts";
import type { NativeRenderer } from "../renderer.ts";
import type { ApplicationQ3Assets } from "./assets.ts";
import type { ApplicationQ3Services } from "./services.ts";

export interface QvmDisplayOptions {
  readonly renderer: Pick<NativeRenderer, "backend" | "driver" | "glConfig">;
  readonly media: ApplicationQ3Assets;
  readonly services: ApplicationQ3Services;
  viewport(): { readonly width: number; readonly height: number };
  assertCurrent(): void;
}

/** Actual renderer and source font records shared by primary and component clients. */
export function qvmDisplaySyscall(call: QvmHostCall, o: QvmDisplayOptions): QvmHostResult | null {
  o.assertCurrent();
  if (call.kind !== "engine" || call.role !== "ui" && call.role !== "cgame") return null;
  const { guest, words, code } = call, ui = call.role === "ui";
  if (code === (ui ? QvmUiImport.UI_GETGLCONFIG : QvmCgameImport.CG_GETGLCONFIG)) {
    const legacy = (call.abiProfile ?? "q3-modern") !== "q3-modern", bytes = legacy ? 4164 : 11332, shift = legacy ? 7168 : 0;
    const pointer = words.getInt32(4, true), record = guest.view(pointer, bytes), renderer = o.renderer.backend, viewport = o.viewport();
    guest.span(pointer, bytes).fill(0);
    const gl = o.renderer.glConfig, driver = o.renderer.driver;
    guest.writeString(pointer, driver?.renderer ?? 'Quake Anthology software renderer', 1024);
    guest.writeString(pointer + 1024, driver?.vendor ?? 'Quake Anthology', 1024);
    guest.writeString(pointer + 2048, driver?.version ?? 'software', 1024);
    record.setInt32(11264 - shift, gl?.maxTextureSize ?? 0, true); record.setInt32(11268 - shift, gl?.textureUnits ?? 0, true);
    record.setInt32(11272 - shift, gl?.colorBits ?? 24, true); record.setInt32(11276 - shift, gl?.depthBits ?? 64, true); record.setInt32(11280 - shift, renderer.stencilBits, true);
    record.setInt32(11288 - shift, q3HardwareNumber(q3Hardware(driver?.renderer ?? "")), true);
    record.setInt32(11304 - shift, viewport.width, true); record.setInt32(11308 - shift, viewport.height, true);
    record.setFloat32(11312 - shift, viewport.width / viewport.height, true); record.setInt32(11324 - shift, Number(gl?.stereoEnabled ?? false), true);
    return 0;
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
