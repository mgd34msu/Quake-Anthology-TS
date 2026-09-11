export type Vector3 = readonly [number, number, number];

export interface ClipInput {
  readonly velocity: Vector3;
  readonly normal: Vector3;
  readonly overbounce: number;
}

export function clipVelocity(input: ClipInput): { backoff: number; velocity: Vector3 } {
  const x = Math.fround(input.velocity[0]);
  const y = Math.fround(input.velocity[1]);
  const z = Math.fround(input.velocity[2]);
  const nx = Math.fround(input.normal[0]);
  const ny = Math.fround(input.normal[1]);
  const nz = Math.fround(input.normal[2]);
  const overbounce = Math.fround(input.overbounce);
  const dot = Math.fround(Math.fround(Math.fround(x * nx) + Math.fround(y * ny)) + Math.fround(z * nz));
  const backoff = Math.fround(dot < 0 ? dot * overbounce : dot / overbounce);
  return {
    backoff,
    velocity: [
      Math.fround(x - Math.fround(nx * backoff)),
      Math.fround(y - Math.fround(ny * backoff)),
      Math.fround(z - Math.fround(nz * backoff)),
    ],
  };
}

export function singleClock(commandTime: number, serverTime: number): { commandTime: number; msec: number; frametime: number } {
  let msec = serverTime - commandTime;
  if (msec < 1) msec = 1;
  else if (msec > 200) msec = 200;
  return { commandTime: serverTime, msec, frametime: Math.fround(msec * 0.001) };
}

export interface MoveInput {
  readonly commandTime: number;
  readonly serverTime: number;
  readonly framecount: number;
  readonly subdivision: { readonly kind: "variable" } | { readonly kind: "fixed"; readonly msec: number };
  readonly jumpHeld: boolean;
  readonly upmove: number;
}

export function subdivideMove(input: MoveInput): {
  commandTime: number; framecount: number; upmove: number; steps: { commandTime: number; msec: number; upmove: number }[];
} {
  if (input.subdivision.kind === "fixed" && (!Number.isInteger(input.subdivision.msec) || input.subdivision.msec < 1)) {
    throw new Error("Fixed subdivision must be a positive integer");
  }
  let commandTime = input.commandTime;
  let framecount = input.framecount;
  let upmove = input.upmove;
  const steps: { commandTime: number; msec: number; upmove: number }[] = [];
  if (input.serverTime < commandTime) return { commandTime, framecount, upmove, steps };
  if (input.serverTime > commandTime + 1000) commandTime = input.serverTime - 1000;
  framecount = (framecount + 1) & 63;
  while (commandTime !== input.serverTime) {
    let msec = input.serverTime - commandTime;
    const maximum = input.subdivision.kind === "fixed" ? input.subdivision.msec : 66;
    if (msec > maximum) msec = maximum;
    const single = singleClock(commandTime, commandTime + msec);
    commandTime = single.commandTime;
    steps.push({ commandTime, msec: single.msec, upmove });
    if (input.jumpHeld) upmove = 20;
  }
  return { commandTime, framecount, upmove, steps };
}

export interface TimerInput {
  readonly msec: number;
  readonly pmTime: number;
  readonly flags: number;
  readonly legsTimer: number;
  readonly torsoTimer: number;
}

export function dropTimers(input: TimerInput): Omit<TimerInput, "msec"> {
  let { pmTime, flags, legsTimer, torsoTimer } = input;
  if (pmTime !== 0) {
    if (input.msec >= pmTime) {
      flags &= ~(256 | 32 | 64);
      pmTime = 0;
    } else pmTime -= input.msec;
  }
  if (legsTimer > 0) legsTimer = Math.max(0, legsTimer - input.msec);
  if (torsoTimer > 0) torsoTimer = Math.max(0, torsoTimer - input.msec);
  return { pmTime, flags, legsTimer, torsoTimer };
}

export type Weapon = "machinegun" | "rocket" | "lightning";
export type WeaponState = "ready" | "raising" | "dropping" | "firing";

export interface WeaponInput {
  readonly weapon: Weapon;
  readonly weaponState: WeaponState;
  readonly weaponTime: number;
  readonly torsoAnim: number;
  readonly ammo: Readonly<Record<Weapon, number>>;
  readonly eventSequence: number;
  readonly steps: readonly { readonly msec: number; readonly weapon: Weapon; readonly attack: boolean; readonly haste: boolean }[];
}

export interface WeaponObservation {
  readonly weapon: Weapon;
  readonly weaponState: WeaponState;
  readonly weaponTime: number;
  readonly torsoAnim: number;
  readonly ammo: Readonly<Record<Weapon, number>>;
  readonly eventSequence: number;
}

export function weaponSequence(input: WeaponInput): {
  states: WeaponObservation[];
  events: { event: number; parm: number; index: number; state: WeaponObservation }[];
  ring: [number, number];
  trace: string[];
} {
  let { weapon, weaponState, weaponTime, torsoAnim, eventSequence } = input;
  const ammo = { ...input.ammo };
  const states: WeaponObservation[] = [];
  const events: { event: number; parm: number; index: number; state: WeaponObservation }[] = [];
  const ring: [number, number] = [0, 0];
  const trace: string[] = [];
  function observe(): WeaponObservation {
    return { weapon, weaponState, weaponTime, torsoAnim, ammo: { ...ammo }, eventSequence };
  }
  function event(value: number): void {
    const index = eventSequence & 1;
    ring[index] = value;
    events.push({ event: value, parm: 0, index, state: observe() });
    trace.push(`event:${value}:sequence:${eventSequence}`);
    eventSequence++;
  }
  function animate(animation: number): void {
    torsoAnim = ((torsoAnim & 128) ^ 128) | animation;
    trace.push(`animation:${torsoAnim}`);
  }
  for (const [index, step] of input.steps.entries()) {
    trace.push(`step:${index}`);
    if (weaponTime > 0) weaponTime -= step.msec;
    if (weaponTime <= 0 || weaponState !== "firing") {
      if (weapon !== step.weapon && weaponState !== "dropping") {
        event(22);
        weaponState = "dropping";
        weaponTime += 200;
        animate(9);
      }
    }
    if (weaponTime > 0) {
      states.push(observe());
      continue;
    }
    if (weaponState === "dropping") {
      weapon = step.weapon;
      weaponState = "raising";
      weaponTime += 250;
      animate(10);
    } else if (weaponState === "raising") {
      weaponState = "ready";
      animate(11);
    } else if (!step.attack) {
      weaponTime = 0;
      weaponState = "ready";
    } else {
      animate(7);
      weaponState = "firing";
      if (ammo[weapon] === 0) {
        event(21);
        weaponTime += 500;
      } else {
        if (ammo[weapon] !== -1) {
          ammo[weapon]--;
          trace.push(`ammo:${weapon}:${ammo[weapon]}`);
        }
        event(23);
        let addTime = weapon === "rocket" ? 800 : weapon === "machinegun" ? 100 : 50;
        if (step.haste) addTime = Math.trunc(addTime / 1.3);
        weaponTime += addTime;
      }
    }
    states.push(observe());
  }
  return { states, events, ring, trace };
}

export interface ConnectInput {
  readonly banned: boolean;
  readonly ip: string;
  readonly configuredPassword: string;
  readonly providedPassword: string;
  readonly existingBotFlag: boolean;
  readonly priorVm: "ui" | null;
}

export function clientConnect(input: ConnectInput): {
  returnValue: number; denial: string | null; serverState: "free" | "connected"; currentVm: "ui" | "game"; trace: string[];
} {
  const trace = ["VM_Call:game:enter", "vmMain:GAME_CLIENT_CONNECT", "trap_GetUserinfo", "G_FilterPacket"];
  let denial: string | null = null;
  if (input.banned) denial = "You are banned from this server.";
  else if (!input.existingBotFlag && input.ip !== "localhost") {
    trace.push("password:check");
    if (input.configuredPassword !== "" && input.configuredPassword.toLowerCase() !== "none"
      && input.configuredPassword !== input.providedPassword) denial = "Invalid password";
  }
  if (denial === null) {
    trace.push("client:zero", "connected:CON_CONNECTING", "G_InitSessionData", "G_ReadSessionData",
      "G_LogPrintf", "ClientUserinfoChanged", "trap_SendServerCommand:connected", "CalculateRanks");
  }
  const returnValue = denial === null ? 0 : 32;
  trace.push(`ClientConnect:return:${returnValue}`, `vmMain:return:${returnValue}`, `VM_Call:return:${returnValue}`);
  const currentVm = input.priorVm ?? "game";
  if (denial !== null) {
    trace.push("VM_ExplicitArgPtr:game:32", `NET_OutOfBandPrint:print\n${denial}\n`, "server:return");
  } else trace.push("SV_UserinfoChanged", "NET_OutOfBandPrint:connectResponse", "server:CS_CONNECTED");
  return { returnValue, denial, serverState: denial === null ? "connected" : "free", currentVm, trace };
}

export function nestedVm(priorVm: "ui" | null): { result: number; currentVm: string | null; trace: string[] } {
  let currentVm: string | null = priorVm;
  const trace: string[] = [];
  function call(vm: string, entry: () => number): number {
    const oldVm = currentVm;
    currentVm = vm;
    trace.push(`enter:${vm}:current:${currentVm}`);
    const result = entry();
    if (oldVm !== null) currentVm = oldVm;
    trace.push(`return:${vm}:${result}:current:${currentVm}`);
    return result;
  }
  const result = call("game", () => {
    trace.push(`host:before:current:${currentVm}`);
    const nested = call("cgame", () => 7);
    trace.push(`host:after:${nested}:current:${currentVm}`);
    return nested + 1;
  });
  return { result, currentVm, trace };
}
