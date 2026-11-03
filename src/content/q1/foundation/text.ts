// SPDX-License-Identifier: GPL-2.0-or-later
/* Classic triggers.qc, doors.qc and Rogue native messages. GPL-2.0-or-later. */
import { classicObituaryText } from "../base/messages.ts";
import { q1FinaleText } from "../base/finales.ts";
import { missionFinaleText } from "../missionpacks/world/finale-text.ts";

export const classicQ1Messages: ReadonlyMap<string, string> = new Map([
  ["$qc_found_secret", "You found a secret area!"],
  ["$qc_more_go", "There are more to go..."],
  ["$qc_three_more", "Only 3 more to go..."],
  ["$qc_two_more", "Only 2 more to go..."],
  ["$qc_one_more", "Only 1 more to go..."],
  ["$qc_sequence_completed", "Sequence completed!"],
  ...["gold", "silver"].flatMap(color =>
    ["key", "runekey", "keycard"].map(kind => [`$qc_need_${color}_${kind}`, `You need the ${color} ${kind}`] satisfies [string, string]),
  ),
  ["$qc_already_have_rune", "You already have a rune\n"],
  ["$qc_rune_resistance", "Earth Magic\n\nRESISTANCE"],
  ["$qc_rune_strength", "Black Magic\n\nSTRENGTH"],
  ["$qc_rune_haste", "Hell Magic\n\nHASTE"],
  ["$qc_rune_regeneration", "Edler Magic\n\nRegeneration"],
  ["$qc_color_games", "You were told you can't change teams.\nGo play color games somewhere else.\n"],
  ["$qc_cannot_change_teams", "You cannot change teams.\n"],
  ["$qc_suicided_too_much", "You have suicided too much already.\n"],
  ["$qc_out_lava_nails", "Out of Lava Nails\n"],
  ["$qc_ctf_disabled", "Capture the Flag is not enabled.\n"],
  ["$qc_flag_missing", "The flag is missing!\n"],
  ["$qc_flag_at_base", "The flag is at base!\n"],
  ["$qc_flag_lying_about", "The flag is lying about!\n"],
  ["$qc_you_have_flag", "You have the flag!\n"],
  ["$qc_flag_screwed_up", "The flag is screwed up!\n"],
  ["$qc_you_have_enemy_flag", "You have the enemy flag.\n"],
  ["$qc_flag_returned", "The flag has been returned!\n"],
  ["$qc_your_flag_returned_base", "Your flag has been returned to base!\n"],
  ["$qc_enemy_flag_returned_base", "Enemy flag has been returned to base!\n"],
  ["$qc_your_team_captured", "Your team captured the flag!\n"],
  ["$qc_your_flag_captured", "Your flag was captured!\n"],
  ["$qc_flag_taken", "The flag has been taken!\n"],
  ["$qc_your_flag_taken", "Your flag has been taken!\n"],
  ["$qc_enemy_killed_bonus", "Enemy flag carrier killed: {0} bonus frags\n"],
  ["$qc_enemy_killed_no_bonus", "Enemy flag carrier killed, no bonus\n"],
  ["$qc_has_token", "{0} has the tag token!\n"],
  ["$qc_lost_token", "{0} lost the tag token!\n"],
  ["$qc_got_token", "{0} got the tag token!\n"],
  ["$qc_got_quad", "You got the Quad Damage\n"],
  ["$qc_item_health", "You receive {0} health\n"],
  ["$qc_item_armor", "You got armor\n"],
  ["$qc_got_item", "You got {0}\n"],
  ["$qc_double_shotgun", "the Double-barrelled Shotgun"],
  ["$qc_nailgun", "the nailgun"],
  ["$qc_super_nailgun", "the Super Nailgun"],
  ["$qc_grenade_launcher", "the Grenade Launcher"],
  ["$qc_rocket_launcher", "the Rocket Launcher"],
  ["$qc_thunderbolt", "the Thunderbolt"],
  ["$qc_shells", "the shells"],
  ["$qc_nails", "the nails"],
  ["$qc_rockets", "the rockets"],
  ["$qc_cells", "the cells"],
  ...["silver", "gold"].flatMap(color =>
    ["key", "runekey", "keycard"].map(kind => [`$qc_${color}_${kind}`, `the ${color} ${kind}`] satisfies [string, string]),
  ),
  ["$qc_ring_fade", "Ring of Shadows magic is fading\n"],
  ["$qc_protection_fade", "Protection is almost burned out\n"],
  ["$qc_quad_fade", "Quad Damage is wearing off\n"],
  ["$qc_biosuit_fade", "Air supply in Biosuit expiring\n"],
  ["$qc_pentagram_of_protection", "the Pentagram of Protection"],
  ["$qc_ring_of_shadows", "the Ring of Shadows"],
  ["$qc_biosuit", "the Biosuit"],
  ["$qc_quad_damage", "the Quad Damage"],
]);

export function classicQ1Text(text: string, args: readonly (string | number)[] = []): string {
  const format = classicQ1Messages.get(text) ?? q1FinaleText("classic", missionFinaleText("classic", classicObituaryText(text, args.map(String))));
  return format.replace(/\{([0-9]+)\}/g, (match: string, index: string) => {
    const argument = args[Number(index)];
    return argument === undefined ? match : (classicQ1Messages.get(String(argument)) ?? String(argument));
  });
}

/** ED_NewString is applied once when entity provider strings enter the runtime. */
export function q1EntityString(value: string): string {
  return value.replace(/\\(.)/gs, (_match, escaped: string) => (escaped === "n" ? "\n" : "\\"));
}
