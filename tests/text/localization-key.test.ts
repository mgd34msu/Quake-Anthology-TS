import { expect, test } from "bun:test";
import { LOCALIZATION_KEY_VERSION, decodeLocalizationKey, encodeLocalizationKey, plainLocalizationText } from "../../src/text/localization-key.ts";

test("a key and its arguments round trip through the versioned carrier", () => {
  const text = encodeLocalizationKey("$qc_death_ax", ["Ranger", "Shub\u001fNiggurath"]);
  expect(decodeLocalizationKey(text)).toEqual({ key: "$qc_death_ax", args: ["Ranger", "Shub Niggurath"] });
  expect(decodeLocalizationKey(encodeLocalizationKey("$qc_entered", []))).toEqual({ key: "$qc_entered", args: [] });
});

test("ordinary text and unknown versions are not decoded", () => {
  expect(decodeLocalizationKey("plain text\n")).toBeNull();
  const future = encodeLocalizationKey("$k", ["a"]).replace(`QLK${LOCALIZATION_KEY_VERSION}`, "QLK9");
  expect(decodeLocalizationKey(future)).toBeNull();
  expect(plainLocalizationText(future)).toBe("$k a");
  expect(plainLocalizationText("plain")).toBe("plain");
});
