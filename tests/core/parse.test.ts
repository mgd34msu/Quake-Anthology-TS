import { expect, test } from "bun:test";
import { CommonError } from "../../src/core/common-error.ts";
import {
  CommonParseCursor, CommonParseState, Tokenizer, compressCommonText,
  parseQ1Token, parseQ2Token,
} from "../../src/core/common-parse.ts";

test("Q3 COM_Parse preserves line boundaries, shared tokens, and matrix writes", () => {
  const state = new CommonParseState();
  const cursor = new CommonParseCursor('alpha\nbeta /* comment */ "a\\b"');
  expect(state.parse(cursor)).toBe("alpha");
  expect(state.line).toBe(1);
  expect(state.parse(cursor, false)).toBe("");
  expect(state.line).toBe(2);
  expect(state.parse(cursor)).toBe("beta");
  expect(state.parse(cursor)).toBe("a\\b");
  state.beginSession("fixture", () => undefined);
  expect(state.token).toBe("a\\b");
  const matrix = new Float32Array(2);
  state.parse1DMatrix(new CommonParseCursor("( 0x1.8p+2 -3.5 )"), 2, matrix);
  expect(Array.from(matrix)).toEqual([6, -3.5]);
  expect(() => state.matchToken(new CommonParseCursor("wrong"), "expected")).toThrow(CommonError);
  expect(new CommonError("drop", "fixture").code).toBe("drop");
});

test("general Q3 tokenizer and compressor retain literal quoted text", () => {
  const tokenizer = new Tokenizer('/* header */ map\r\n"textures\\wall"', "fixture");
  expect(tokenizer.next()?.value).toBe("map");
  expect(tokenizer.next(false)).toBeUndefined();
  expect(tokenizer.next()).toEqual({ value: "textures\\wall", line: 2, column: 1, quoted: true });
  expect(compressCommonText('a  /* comment */ b\n\t"// literal"')).toBe('a b\n"// literal"');
});

test("Q1 punctuation and Q2 token limits retain their donor dialects", () => {
  const netquake = { data: 'key:value "a\\b"', index: 0 };
  expect([parseQ1Token(netquake), parseQ1Token(netquake), parseQ1Token(netquake), parseQ1Token(netquake)])
    .toEqual(["key", ":", "value", "a\\b"]);
  expect(parseQ1Token(netquake)).toBeNull();
  expect(parseQ1Token({ data: "key:value", index: 0 }, "quakeworld")).toBe("key:value");
  const quake2 = { data: `// header\n${"x".repeat(128)} "a\\b"`, index: 0 };
  expect(parseQ2Token(quake2)).toBe("");
  expect(parseQ2Token(quake2)).toBe("a\\b");
  expect(parseQ2Token({ data: "x".repeat(128), index: 0 }, 512)).toBe("x".repeat(128));
});
