/** SDL_SetHint returns 0 when the environment already supplies the hint at default priority; that value is acceptable when it is the one required. */
export function requireNoSignalHandlers(setResult: number): void {
  if (setResult === 1 || process.env["SDL_NO_SIGNAL_HANDLERS"] === "1") return;
  throw new Error("SDL must leave signal handling to the Unix signal owner");
}
