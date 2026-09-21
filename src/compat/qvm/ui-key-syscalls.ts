/* UI CD-key traps from id Software client/cl_ui.c. GPL-2.0-or-later. */
import { validateQ3CdKey } from '../../core/q3-cd-key.ts';
import type { Q3CdKeyState } from '../../core/q3-cd-key.ts';
import { QvmUiExport, QvmUiImport } from './abi.ts';
import type { QvmHostCall, QvmHostResult } from './syscalls.ts';

export interface QvmUiKeyServices {
  readonly keys: Pick<Q3CdKeyState, 'readUi'> & { writeUi(unique: number, directory: string, source: Uint8Array): void | Promise<void> };
  gameDirectory(): string;
  assertCurrent(): void;
}
export function qvmUiKeySyscall(call: QvmHostCall, services: QvmUiKeyServices): QvmHostResult | null {
  if (call.kind !== 'engine' || call.role !== 'ui') return null;
  services.assertCurrent();
  switch (call.code) {
    case QvmUiImport.UI_GET_CDKEY:
    case QvmUiImport.UI_SET_CDKEY: {
      const pointer = call.words.getInt32(4, true), read = call.code === QvmUiImport.UI_GET_CDKEY;
      return call.invokeAsync([QvmUiExport.UI_HASUNIQUECDKEY, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0, () => services.assertCurrent()).then(async unique => {
        services.assertCurrent();
        if (read) {
          const directory = services.gameDirectory(), destination = call.guest.span(pointer, 17);
          const offset = destination.byteOffset - call.guest.bytes.byteOffset;
          services.keys.readUi(unique, directory, destination, {
            copy: bytes => call.guest.writeBytes(offset, bytes),
            setByte: (index, value) => call.guest.dataView(offset + index, 1).setUint8(0, value),
          });
        }
        else await services.keys.writeUi(unique, services.gameDirectory(), call.guest.span(pointer, 16));
        services.assertCurrent();
        return 0;
      });
    }
    case QvmUiImport.UI_VERIFY_CDKEY: {
      const key = call.guest.readString(call.words.getInt32(4, true));
      if (key.length !== 16) return 0;
      const checksum = call.words.getInt32(8, true);
      return Number(validateQ3CdKey(key, call.guest.pointer(checksum) === null ? null : call.guest.readString(checksum)));
    }
    default: return null;
  }
}
