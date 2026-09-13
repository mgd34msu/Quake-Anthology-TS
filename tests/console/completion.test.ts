import { expect, test } from "bun:test";
import { ConsoleField } from "../../src/console/field.ts";
import { KeyCode } from "../../src/input/key-codes.ts";

const names = ["vid_restart", "vid_ref", "VID_REF", "volume"];

test("console completion cycles sorted names in both directions with case-insensitive deduplication", () => {
  const field = new ConsoleField();
  field.setText("ViD_");
  field.complete(names); expect(field.text).toBe("/vid_ref"); expect(field.selectedCompletion).toBe("vid_ref");
  field.complete(names); expect(field.text).toBe("/vid_restart");
  field.complete(names); expect(field.text).toBe("/vid_ref");
  field.complete(names, true); expect(field.text).toBe("/vid_restart");
  field.setText("vid_"); field.complete(names, true); expect(field.text).toBe("/vid_restart");
});

test("completion supplies one slash, preserves arguments, and ignores argument cursors", () => {
  for (const marker of ["", "/", "\\"]) {
    const field = new ConsoleField();
    field.setText(`${marker}vid_  \"argument text\"`);
    field.complete(names); expect(field.selectedCompletion).toBeNull();
    field.cursor = marker.length + 4;
    field.complete(names); expect(field.text).toBe(`/vid_ref  \"argument text\"`);
    expect(field.cursor).toBe(8);
    field.complete(names); expect(field.text).toBe(`/vid_restart  \"argument text\"`);
  }
});

test("ordinary edits, history replacement, and cursor movement discard stale cycles", () => {
  const field = new ConsoleField();
  field.setText("vid_"); field.complete(names);
  field.insert("x"); expect(field.selectedCompletion).toBeNull();
  field.complete(names); expect(field.text).toBe("/vid_refx");
  field.setText("vol"); field.complete(names); expect(field.text).toBe("/volume");
  field.key(KeyCode.Home, false, false, () => null); expect(field.selectedCompletion).toBeNull();
  field.key(KeyCode.End, false, false, () => null);
  field.complete(names); expect(field.text).toBe("/volume");
  field.clear(); expect(field.selectedCompletion).toBeNull();
});

test("empty input completes names and completion never truncates an argument tail", () => {
  const field = new ConsoleField();
  field.complete(names); expect(field.text).toBe("/vid_ref");
  const short = new ConsoleField(9);
  short.setText("v keep"); short.cursor = 1;
  short.complete(["volume"]); expect(short.text).toBe("v keep");
});
