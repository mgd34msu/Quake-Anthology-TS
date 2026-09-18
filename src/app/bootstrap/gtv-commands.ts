import { Q2CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";

export interface GtvConnectRequest { readonly address: string; readonly username: string; readonly password: string; readonly label: string | null; }
export function registerGtvCvars(cvars: CvarRegistry): void {
  if (cvars.dialect !== "q2-classic" && cvars.dialect !== "q2-rerelease") return;
  cvars.register("mvd_username", "unnamed", 0);
  cvars.register("mvd_password", "", Q2CvarFlag.Private);
}
export function parseGtvConnect(args: readonly string[], defaults: { readonly username: string; readonly password: string }): GtvConnectRequest | null {
  let username = defaults.username, password = defaults.password, label: string | null = null, index = 0;
  for (; index < args.length; index++) {
    const option = args[index];
    if (option === "--") { index++; break; }
    if (option === undefined || !option.startsWith("-")) break;
    if (option === "-h" || option === "--help") return null;
    if (option !== "-u" && option !== "--user" && option !== "-p" && option !== "--pass" && option !== "-n" && option !== "--name") throw new Error(`Unknown mvdconnect option: ${option}`);
    const value = args[++index];
    if (value === undefined) throw new Error(`Missing value for ${option}`);
    if (value.includes("\0") || [...value].some(character => character.charCodeAt(0) > 255)) throw new Error("GTV options require non-NUL single-byte text");
    if (option === "-u" || option === "--user") username = value;
    else if (option === "-p" || option === "--pass") password = value;
    else label = value;
  }
  const address = args[index];
  if (address === undefined || address === "" || index + 1 !== args.length) throw new Error("Usage: mvdconnect [-u user] [-p password] [-n name] <address[:port]>");
  return { address, username, password, label };
}
export function matchesGtvDisconnect(args: readonly string[], current: { readonly id: number; readonly label: string } | null): boolean {
  if (args.length > 1) throw new Error("Usage: mvdisconnect [-a|--all] [conn_id]");
  const selected = args[0];
  if (selected === "-h" || selected === "--help") return false;
  if (current === null) throw new Error("No GTV connections.");
  if (selected === undefined || selected === "-a" || selected === "--all" || selected === String(current.id) || selected === current.label) return true;
  throw new Error(`No such connection ID: ${selected}`);
}
