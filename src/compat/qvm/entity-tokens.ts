import { CommonParseCursor, CommonParseState } from "../../core/common-parse.ts";
import { SaveReader } from "../../persistence/value.ts";
import { QvmGameImport } from "./abi.ts";
import type { QvmHostCall } from "./syscalls.ts";

export interface QvmEntityTokenServices {
  entityToken(): { readonly token: string; readonly ended: boolean };
}

/** Each source instance consumes its own declared input with the engine's COM_Parse semantics. */
export class QvmEntityTokens implements QvmEntityTokenServices {
  private readonly cursor: CommonParseCursor;
  private readonly parser = new CommonParseState();
  constructor(source: string) { this.cursor = new CommonParseCursor(source); }

  entityToken(): { readonly token: string; readonly ended: boolean } {
    return { token: this.parser.parse(this.cursor), ended: this.cursor.offset === null };
  }

  captureSaveState() {
    return { source: this.cursor.source, cursor: this.cursor.offset, parser: this.parser.captureSaveState() };
  }

  restoreSaveState(value: unknown): void {
    if (value === undefined && this.cursor.source.length === 0) {
      this.cursor.offset = 0;
      this.parser.restoreSaveState(new CommonParseState().captureSaveState());
      return;
    }
    const reader = new SaveReader(value, "qvm.entityTokens");
    reader.field("source").literal(this.cursor.source);
    const cursor = reader.field("cursor").nullable(value => value.integer(0));
    this.parser.restoreSaveState(reader.field("parser").value);
    this.cursor.offset = cursor;
  }
}

/** Q3 server/sv_game.c: consume a token before copying and retain a final nonempty token at EOF. */
export function qvmEntityTokenSyscall(call: QvmHostCall, services: QvmEntityTokenServices): number | null {
  if (call.kind !== "engine" || call.role !== "qagame" || call.code !== QvmGameImport.G_GET_ENTITY_TOKEN) return null;
  const result = services.entityToken();
  call.guest.writeString(call.words.getInt32(4, true), result.token, call.words.getInt32(8, true));
  return Number(!result.ended || result.token.length !== 0);
}
