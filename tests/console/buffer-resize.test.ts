import { expect, test } from "bun:test";
import { ConsoleBuffer } from "../../src/console/buffer.ts";

const cells = (buffer: ConsoleBuffer) => buffer.visible(1000).flatMap(row => row.cells);

test("console resizing retains soft-wrapped text, colors and hard line breaks", () => {
  const buffer = new ConsoleBuffer("q3", 40);
  buffer.print("^1abcdefghijklmnopqrstuvwx\n^2second line\n", 1);
  const original = cells(buffer);
  buffer.resize(8);
  expect(cells(buffer)).toEqual(original);
  expect(buffer.visible(100).every(row => row.cells.length <= 8)).toBe(true);
  buffer.resize(40);
  expect(buffer.dump()).toBe("abcdefghijklmnopqrstuvwx\nsecond line\n\n");
  buffer.print("tail", 2);
  expect(buffer.dump()).toEndWith("second line\ntail\n");
});

test("console resizing retains partial-line insertion and alternate glyphs", () => {
  const buffer = new ConsoleBuffer("q1-netquake", 40);
  buffer.print("\x01abcdefghijkl", 1);
  buffer.resize(8);
  buffer.print("mn", 2);
  expect(buffer.dump()).toBe("abcdefgh\nijklmn\n");
  expect(cells(buffer).slice(0, 12).every(cell => cell.alternate)).toBe(true);
  buffer.resize(40);
  expect(buffer.dump()).toBe("abcdefghijklmn\n");
});

test("console resizing keeps scrollback anchored to the same output", () => {
  const buffer = new ConsoleBuffer("q3", 40);
  buffer.print("first\nsecond\nthird\nfourth\n", 1);
  buffer.scroll(2);
  const before = buffer.visible(1)[0]?.cells;
  buffer.resize(8);
  expect(buffer.visible(1)[0]?.cells).toEqual(before);
  buffer.print("new\n", 2);
  expect(buffer.visible(1)[0]?.cells).toEqual(before);
});

test("resize preserves an overwrite cursor before the end of a wrapped line", () => {
  const buffer = new ConsoleBuffer("q3", 40);
  buffer.print("abcdefghijkl\rXY", 1);
  buffer.resize(8);
  buffer.print("Z", 2);
  expect(cells(buffer).map(cell => cell.character).join("")).toBe("XYZdefghijkl");
  buffer.resize(40);
  buffer.print("!", 3);
  expect(buffer.dump()).toBe("XYZ!efghijkl\n");
});
