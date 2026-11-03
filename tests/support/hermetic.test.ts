import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { developerHome, hermeticHome } from "./hermetic";
import { defaultUserContentRoot } from "../../src/content/user-data";

test("tests never resolve the developer's profile", () => {
  expect(homedir()).toBe(hermeticHome);
  expect(process.env["HOME"]).toBe(hermeticHome);
  expect(hermeticHome).not.toBe(developerHome);
  expect(defaultUserContentRoot().startsWith(hermeticHome)).toBe(true);
  expect(defaultUserContentRoot().startsWith(developerHome + "/.local")).toBe(false);
});
