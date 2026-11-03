import { expect, test } from "bun:test";
import { archiveDataText } from "../../src/app/bootstrap/cvar-archives.ts";

test("saved settings keep only variable and binding lines", () => {
  const text = [
    "// Generated", 'seta cl_maxpackets "30"', 'bind w "+forward"', 'bind a "+left; +attack"', 'sensitivity "3"', 'quit "1"',
    "exec evil.cfg", 'seta x "1"; exec evil.cfg', 'seta y "unterminated', 'alias z "quit"', "unbindall",
  ].join("\r\n");
  expect(archiveDataText(text, name => name === "quit")).toBe(['seta cl_maxpackets "30"', 'bind w "+forward"', 'bind a "+left; +attack"', 'sensitivity "3"', "unbindall"].join("\n") + "\n");
  expect(archiveDataText("", () => false)).toBe("");
});
