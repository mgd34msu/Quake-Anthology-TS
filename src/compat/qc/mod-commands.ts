import type { ModConsoleCommand, ModConsoleValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import { nativeAtof } from "../../core/numeric.ts";

export function qcConsoleCall(command: ModConsoleCommand, argv: readonly string[], argsText: string): ModSourceCall {
  const resolve = (value: ModConsoleValue): Exclude<ModSourceCall["arguments"][number], { readonly kind: "input" }> => {
    switch (value.kind) {
      case "argument": {
        if (!Number.isSafeInteger(value.index) || value.index < 0) throw new Error("Mod console argument index must be nonnegative");
        const text = argv[value.index] ?? "";
        return value.type === "string" ? { kind: "string", value: text } : { kind: "float", value: nativeAtof(text) };
      }
      case "arguments-text": return { kind: "string", value: argsText };
      case "argument-count": return { kind: "float", value: argv.length };
      default: return value;
    }
  };
  return { function: command.function, arguments: command.arguments.map(resolve), globals: command.globals.map(global => ({ name: global.name, value: resolve(global.value) })) };
}
