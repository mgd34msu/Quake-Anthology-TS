import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { llmSettingsDirectory } from "../../src/main.ts";

test("LLM settings live in the shared user settings directory, not beside the executable", () => {
  expect(llmSettingsDirectory()).toBe(join(homedir(), ".local", "share", "quake-typescript", "settings"));
  expect(llmSettingsDirectory()).not.toBe(process.cwd());
});
