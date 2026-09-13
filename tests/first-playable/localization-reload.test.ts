import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { createMountIdentity } from "../../src/contracts/content.ts";
import type { ContentMount } from "../../src/contracts/content.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { ApplicationRereleasePresentation } from "../../src/app/bootstrap/rerelease-presentation.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import type { SettingBinding } from "../../src/ui/settings/index.ts";

async function select(binding: SettingBinding | undefined, language: string): Promise<void> {
  if (binding?.kind !== "choice") throw new Error("Missing language choice");
  binding.write(language);
  const deadline = performance.now() + 5000;
  while (!binding.enabled() && performance.now() < deadline) await Bun.sleep(1);
  expect(binding.enabled()).toBe(true);
  expect(binding.read()).toBe(language);
}

test("mounted language binding reloads tables per seat and preserves selection across content replacement", async () => {
  const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("language-reload");
  const assets = new ApplicationAssets(content, { identity: Symbol("language-reload"), session: identity.session, generation: 0 });
  const root = await mkdtemp(join(tmpdir(), "quake-language-"));
  const first = { seat: identity.seat(0), actor: identity.actor(0, 0) }, second = { seat: identity.seat(1), actor: identity.actor(1, 0) };
  const contentId = content.recipe.map.entities.content;
  const errors: unknown[] = [];
  const prints = async (presentation: ApplicationRereleasePresentation, key: string): Promise<readonly string[]> => {
    presentation.receive([{ kind: "q2-rerelease", content: contentId, sequence: 1, seconds: 0,
      event: { kind: "localized-print", actor: null, level: "chat", text: key, args: [] } }]);
    await presentation.prepare();
    return presentation.drainPrints().map(event => {
      if (event.kind !== "q2-player" || event.event.kind !== "print") throw new Error("Missing localized print");
      return event.event.text;
    });
  };
  try {
    const retail = new ApplicationRereleasePresentation(assets, [first, second]);
    const binding = await retail.languageBinding(first.seat, contentId, error => errors.push(error));
    if (binding?.kind !== "choice") throw new Error("Missing mounted languages");
    expect(binding.choices().some(choice => choice.id === "french")).toBe(true);
    const english = await prints(retail, "$m_single_player");
    await select(binding, "french");
    const french = await prints(retail, "$m_single_player");
    expect(french[0]).not.toBe(english[0]); expect(french[1]).toBe(english[1]);
    const rebuilt = new ApplicationRereleasePresentation(assets, [{ ...first, language: retail.selectedLanguage(first.seat) }, second]);
    expect(await prints(rebuilt, "$m_single_player")).toEqual(french);

    await mkdir(join(root, "localization"));
    await writeFile(join(root, "localization/loc_english.txt"), 'message="English"\nstory="Visible"');
    await writeFile(join(root, "localization/loc_english_mod.txt"), 'message="English mod"');
    await writeFile(join(root, "localization/loc_french.txt"), 'message="French"\nstory=""');
    await writeFile(join(root, "localization/loc_french_mod.txt"), 'message="French mod"');
    const mount: ContentMount = { kind: "loose", identity: createMountIdentity("mount:test:language", contentId, 0), rootPath: root };
    using mounts = await openMountPlan({ id: "mount-plan:test:language", mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] });
    const provider = await assets.provider(contentId), mountedAssets = { provider: async () => ({ ...provider, mounts }) };
    const mounted = new ApplicationRereleasePresentation(mountedAssets, [first, second]);
    const mountedBinding = await mounted.languageBinding(first.seat, contentId, error => errors.push(error));
    expect(await prints(mounted, "$message")).toEqual(["English mod", "English mod"]);
    mounted.receive([{ kind: "q2-rerelease", content: contentId, sequence: 2, seconds: 0, event: { kind: "story", text: "$story" } }]);
    await mounted.prepare(); expect(mounted.storyActive(first.actor)).toBe(true);
    await select(mountedBinding, "french");
    expect(await prints(mounted, "$message")).toEqual(["French mod", "English mod"]);
    expect(mounted.storyActive(first.actor)).toBe(false); expect(mounted.storyActive(second.actor)).toBe(true);
    await writeFile(join(root, "localization/loc_french_mod.txt"), 'message="Changed mod"');
    await select(mountedBinding, "french");
    expect(await prints(mounted, "$message")).toEqual(["Changed mod", "English mod"]);
    await rm(join(root, "localization/loc_french.txt"));
    await select(mountedBinding, "french");
    expect(await prints(mounted, "$message")).toEqual(["English mod", "English mod"]);
    expect(mounted.storyActive(first.actor)).toBe(true);
    const replacement = new ApplicationRereleasePresentation(mountedAssets, [{ ...first, language: mounted.selectedLanguage(first.seat) }, second]);
    expect(await prints(replacement, "$message")).toEqual(["English mod", "English mod"]);
    expect(errors).toEqual([]);
  } finally { assets.close(); await content.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
