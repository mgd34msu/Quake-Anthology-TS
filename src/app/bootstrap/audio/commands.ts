export const applicationAudioCommands: readonly string[] = ["cd", "soundinfo", "soundlist", "play", "stopsound", "s_info", "s_list", "s_stop"];
export const cdCommandDocumentation = {
  summary: "Control the selected soundtrack: play or loop a numbered track, stop, pause, resume, enable, reset, remap or inspect it.",
  usage: "cd <play|loop> <track> | cd <stop|pause|resume|on|off|reset|info> | cd remap [tracks...]",
  examples: ["cd loop 2", "cd pause", "cd resume", "cd stop", "cd remap 1 3", "cd info"],
  allowedValues: ["play", "loop", "stop", "pause", "resume", "on", "off", "reset", "remap", "info"],
};
