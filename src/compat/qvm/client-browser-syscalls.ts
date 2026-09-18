/* UI LAN traps from id Software cl_ui.c/cl_main.c. GPL-2.0-or-later. */
import type { Q3BrowserView } from "../../network/q3/browser-view.ts";
import type { QvmMemory } from "./memory.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

function hasServerRecord(source: number, index: number): boolean {
  return index >= 0 && (source === 2 ? index < 4096
    : (source === 0 || source === 1 || source === 3) && index < 128);
}

function serverName(memory: QvmMemory, word: number): string {
  const bytes = memory.pointer(word);
  if (bytes === null) throw new RangeError("Q_strncpyz: NULL src");
  let name = "";
  // LAN_AddServer copies exactly sizeof(hostName)-1 source bytes at most.
  for (let index = 0; index < 31; index++) {
    const byte = bytes[index];
    if (byte === undefined) throw new RangeError("Server name copy exceeds QVM allocation");
    if (byte === 0) break;
    name += String.fromCharCode(byte);
  }
  return name;
}

export function qvmClientBrowserSyscall(call: QvmHostCall, browser: Q3BrowserView): QvmHostResult | null {
  if (call.role !== "ui") return null;
  if (call.kind === "extension" && call.abiProfile === "q3-1.16n-base" && call.code >= 46 && call.code <= 49) {
    const source = call.code <= 47 ? 0 : 2;
    if (call.code === 46 || call.code === 48) return browser.getServerCount(source);
    const index = call.words.getInt32(4, true), pointer = call.words.getInt32(8, true), capacity = call.words.getInt32(12, true);
    if (capacity !== 0) call.guest.view(pointer, 1).setUint8(0, 0);
    browser.getServerAddressString(source, index, capacity, text => { call.guest.writeString(pointer, text, capacity); });
    return 0;
  }
  if (call.kind !== "engine") return null;
  const { words, guest: memory } = call, trap = call.code;
  switch (trap) {
    case 46: return browser.getPingQueueCount();
    case 47: browser.clearPing(words.getInt32(4, true)); return 0;
    case 48: {
      const index = words.getInt32(4, true), destination = words.getInt32(8, true);
      const capacity = words.getInt32(12, true), timePointer = words.getInt32(16, true);
      const ping = browser.getPing(index, capacity, address => {
        if (address === null) memory.view(destination, 1).setUint8(0, 0);
        else memory.writeString(destination, address, capacity);
      });
      memory.view(timePointer, 4).setInt32(0, ping.time, true);
      return 0;
    }
    case 49: {
      const index = words.getInt32(4, true), destination = words.getInt32(8, true), capacity = words.getInt32(12, true);
      const info = browser.sourcePingInfo(index, capacity, value => { memory.writeString(destination, value, capacity); });
      if (info === null && capacity !== 0) memory.view(destination, 1).setUint8(0, 0);
      return 0;
    }
    case 65: return browser.getServerCount(words.getInt32(4, true));
    case 66:
    case 67: {
      const source = words.getInt32(4, true), index = words.getInt32(8, true);
      const destination = words.getInt32(12, true), capacity = words.getInt32(16, true);
      if (trap === 67 && destination === 0) return 0;
      if (trap === 67 || !hasServerRecord(source, index)) memory.view(destination, 1).setUint8(0, 0);
      if (!hasServerRecord(source, index)) return 0;
      const write = (text: string): undefined => { memory.writeString(destination, text, capacity); };
      if (trap === 66) browser.getServerAddressString(source, index, capacity, write);
      else browser.getServerInfo(source, index, capacity, write);
      return 0;
    }
    case 68: {
      const source = words.getInt32(4, true), index = words.getInt32(8, true), visible = words.getInt32(12, true);
      browser.markServerVisibleValue(source, index, visible); return 0;
    }
    case 69: return Number(browser.updateVisiblePings(words.getInt32(4, true)));
    case 70: browser.resetPings(words.getInt32(4, true)); return 0;
    case 71: return browser.loadCachedServers().then(() => 0);
    case 72: return browser.saveServersToCache().then(() => 0);
    case 73: {
      const source = words.getInt32(4, true), name = words.getInt32(8, true), address = words.getInt32(12, true);
      // Source guards capacity before either string and resolves duplicates before reading name.
      return browser.addServer(source, () => serverName(memory, name), () => memory.readString(address));
    }
    case 74: {
      const source = words.getInt32(4, true), address = words.getInt32(8, true);
      return browser.removeServer(source, () => memory.readString(address)).then(() => 0);
    }
    case 82: {
      const address = words.getInt32(4, true), destination = words.getInt32(8, true), capacity = words.getInt32(12, true);
      const text = address === 0 ? null : memory.readString(address);
      return browser.serverStatus(text, destination === 0 ? null : capacity,
        value => { memory.writeString(destination, value, capacity); }).then(value => Number(value !== null));
    }
    case 83: {
      const source = words.getInt32(4, true), index = words.getInt32(8, true);
      return browser.getServerPing(source, index);
    }
    case 84: {
      const source = words.getInt32(4, true), index = words.getInt32(8, true);
      return browser.serverVisibilityValue(source, index);
    }
    case 85: {
      const source = words.getInt32(4, true), key = words.getInt32(8, true), direction = words.getInt32(12, true);
      const first = words.getInt32(16, true), second = words.getInt32(20, true);
      return browser.compareServers(source, key, direction, first, second);
    }
    default: return null;
  }
}
