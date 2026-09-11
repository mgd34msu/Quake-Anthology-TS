/* client.qc classic messages. Copyright (C) 1996 id Software LLC. GPL-2.0-or-later. */
const classicObituaries: ReadonlyMap<string, string> = new Map([
  ["$qc_telefragged", "{0} was telefragged by {1}\n"], ["$qc_satans_power", "Satan's power deflects {0}'s telefrag\n"],
  ["$qc_discharge_water", "{0} discharges into the water.\n"], ["$qc_discharge_slime", "{0} discharges into the water.\n"], ["$qc_discharge_lava", "{0} discharges into the water.\n"],
  ["$qc_suicide_pin", "{0} tries to put the pin back in\n"], ["$qc_suicide_bored", "{0} becomes bored with life\n"], ["$qc_suicide_loaded", "{0} becomes bored with life\n"],
  ["$qc_ff_teammate", "{0} mows down a teammate\n"], ["$qc_ff_glasses", "{0} checks his glasses\n"], ["$qc_ff_otherteam", "{0} gets a frag for the other team\n"], ["$qc_ff_friend", "{0} loses another friend\n"],
  ["$qc_death_ax", "{0} was ax-murdered by {1}\n"], ["$qc_death_sg", "{0} chewed on {1}'s boomstick\n"], ["$qc_death_dbl", "{0} ate 2 loads of {1}'s buckshot\n"],
  ["$qc_death_nail", "{0} was nailed by {1}\n"], ["$qc_death_sng", "{0} was punctured by {1}\n"], ["$qc_death_gl1", "{0} was gibbed by {1}'s grenade\n"], ["$qc_death_gl2", "{0} eats {1}'s pineapple\n"],
  ["$qc_death_rl2", "{0} was gibbed by {1}'s rocket\n"], ["$qc_death_rl3", "{0} rides {1}'s rocket\n"], ["$qc_death_lg1", "{0} accepts {1}'s discharge\n"], ["$qc_death_lg2", "{0} accepts {1}'s shaft\n"],
  ["$qc_death_drown1", "{0} sleeps with the fishes\n"], ["$qc_death_drown2", "{0} sucks it down\n"], ["$qc_death_slime1", "{0} gulped a load of slime\n"], ["$qc_death_slime2", "{0} can't exist on slime alone\n"],
  ["$qc_death_lava1", "{0} burst into flames\n"], ["$qc_death_lava2", "{0} turned into hot slag\n"], ["$qc_death_lava3", "{0} visits the Volcano God\n"], ["$qc_death_squish", "{0} was squished\n"],
  ["$qc_death_fall", "{0} fell to his death\n"], ["$qc_death_died", "{0} died\n"],
]);
export const classicMonsterObituaries: ReadonlyMap<string, string> = new Map([
  ["monster_army", " was shot by a Grunt\n"], ["monster_demon1", " was eviscerated by a Fiend\n"], ["monster_dog", " was mauled by a Rottweiler\n"], ["monster_dragon", " was fried by a Dragon\n"],
  ["monster_enforcer", " was blasted by an Enforcer\n"], ["monster_fish", " was fed to the Rotfish\n"], ["monster_hell_knight", " was slain by a Death Knight\n"], ["monster_knight", " was slashed by a Knight\n"],
  ["monster_ogre", " was destroyed by an Ogre\n"], ["monster_oldone", " became one with Shub-Niggurath\n"], ["monster_shalrath", " was exploded by a Vore\n"], ["monster_shambler", " was smashed by a Shambler\n"],
  ["monster_tarbaby", " was slimed by a Spawn\n"], ["monster_vomit", " was vomited on by a Vomitus\n"], ["monster_wizard", " was scragged by a Scrag\n"], ["monster_zombie", " joins the Zombies\n"],
]);
export function classicObituaryText(key: string, args: readonly string[]): string {
  return (classicObituaries.get(key) ?? key).replace(/\{([0-9]+)\}/g, (_match: string, index: string) => args[Number(index)] ?? "");
}
