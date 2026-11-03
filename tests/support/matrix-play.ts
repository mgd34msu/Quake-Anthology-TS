import type { Application } from "../../src/app/bootstrap/application.ts";
import type { SeatId } from "../../src/contracts/identity.ts";

export interface FireMeasurement {
  readonly ammoBefore: number;
  readonly ammoAfter: number;
  readonly weapon: string | null;
}

// Holds the primary fire button for a number of frames and reports the active
// weapon's ammo count before and after, so a matrix lane proves that firing
// reaches the weapon code rather than merely that the player survived.
export async function holdFire(application: Application, seat: SeatId, ammo: () => number, weapon: () => string | null, frames: number): Promise<FireMeasurement> {
  const ammoBefore = ammo(), held = weapon();
  application.input({ seat, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
  try { for (let frame = 0; frame < frames; frame++) await application.step(25); }
  finally { application.input({ seat, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() }); }
  await application.step(25);
  return { ammoBefore, ammoAfter: ammo(), weapon: held };
}

// Holds forward movement and returns the horizontal distance covered.
export async function holdForward(application: Application, seat: SeatId, position: () => { readonly x: number; readonly y: number }, frames: number, forwardKey: number): Promise<number> {
  const start = position();
  application.input({ seat, kind: "key", code: forwardKey, down: true, repeat: false, timeMilliseconds: performance.now() });
  try { for (let frame = 0; frame < frames; frame++) await application.step(25); }
  finally { application.input({ seat, kind: "key", code: forwardKey, down: false, repeat: false, timeMilliseconds: performance.now() }); }
  const end = position();
  return Math.hypot(end.x - start.x, end.y - start.y);
}
