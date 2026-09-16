export const applicationAudioCommands: readonly string[] = ["cd", "soundinfo", "soundlist", "play", "stopsound", "s_info", "s_list", "s_stop"];
export const cdCommandDocumentation = {
  summary: "Pause, resume or inspect the current soundtrack without changing its track or volume.",
  usage: "cd <pause|resume|info>",
  examples: ["cd pause", "cd resume", "cd info"],
  allowedValues: ["pause", "resume", "info"],
};
