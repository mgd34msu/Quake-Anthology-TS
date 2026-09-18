import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { LocalizationCatalog } from "../../src/text/localization.ts";
import { expect, test } from "bun:test";
import { loadServerLocalizationResources } from "../../src/text/localization-resources.ts";

test("server chat localization shares source parser and overlays without assigning a seat", async () => {
  const files = new Map<string, string>([
    ["localization/loc_english.txt", 'm_bot_chat_connected_0="Hello"\nm_bot_chat_connected_1="Ready\\nNow"\nplain="Fallback"'],
    ["localization/loc_french.txt", 'm_bot_chat_connected_0="Bonjour"'],
    ["localization/loc_french_mod.txt", 'm_bot_chat_connected_0="Salut"'],
  ]);
  const table = await loadServerLocalizationResources("french", async path => {
    const text = files.get(path); return text === undefined ? null : new TextEncoder().encode(text);
  });
  expect("seat" in table).toBe(false);
  expect(table.lookup("m_bot_chat_connected_0")).toBe("Salut");
  expect(table.lookup("$m_bot_chat_connected_1")).toBe("Ready\nNow");
  expect(table.lookup("m_bot_chat_connected_2")).toBeNull();
  expect(table.lookup("$plain")).toBe("Fallback");
  expect(table.lookup("unknown")).toBeNull();
});

test("missing server localization stays absent without fabricating chat text", async () => {
  const table = await loadServerLocalizationResources("english", async () => null);
  expect(table.size()).toBe(0); expect(table.lookup("$m_bot_chat_connected_0")).toBeNull();
});

test("seat-owned localization retains its public identity and formatting contract", () => {
  const seat = createIdentityOwner("localization-compatibility").seat(1);
  const catalog = new LocalizationCatalog(seat, "q2-rerelease");
  catalog.reload(new TextEncoder().encode('line="Hello {0}"'));
  expect(catalog.seat).toBe(seat); expect(catalog.profile).toBe("q2-rerelease");
  expect(catalog.localize("$line", ["Marine"])).toBe("Hello Marine");
});
