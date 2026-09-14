import { SaveReader } from "../../../../persistence/value.ts";
import type { GameEntity, GameClient, ClientPersistant, PlayerTeamState, ClientSession } from "./state.ts";
import type { PlayerState } from "../shared/player-state.ts";
import type { EntityStateFields } from "../shared/entity-state.ts";
import type { GameLevel } from "./level.ts";

export type EntityValues = Pick<GameEntity, "spawnflags" | "neverFree" | "flags" | "model" | "model2" | "freetime" | "eventTime" | "freeAfterEvent" | "unlinkAfterEvent" | "physicsObject" | "physicsBounce" | "clipmask" | "moverState" | "soundPos1" | "sound1to2" | "sound2to1" | "soundPos2" | "soundLoop" | "pos1" | "pos2" | "message" | "timestamp" | "angle" | "target" | "targetname" | "team" | "targetShaderName" | "targetShaderNewName" | "speed" | "movedir" | "painDebounceTime" | "flySoundDebounceTime" | "lastMoveTime" | "damage" | "splashDamage" | "splashRadius" | "methodOfDeath" | "splashMethodOfDeath" | "count" | "kamikazeTime" | "kamikazeShockTime" | "watertype" | "waterlevel" | "noiseIndex" | "wait" | "random">;
export function captureEntityValues(source: GameEntity): EntityValues {
  return {
    spawnflags: source.spawnflags,
    neverFree: source.neverFree,
    flags: source.flags,
    model: source.model,
    model2: source.model2,
    freetime: source.freetime,
    eventTime: source.eventTime,
    freeAfterEvent: source.freeAfterEvent,
    unlinkAfterEvent: source.unlinkAfterEvent,
    physicsObject: source.physicsObject,
    physicsBounce: source.physicsBounce,
    clipmask: source.clipmask,
    moverState: source.moverState,
    soundPos1: source.soundPos1,
    sound1to2: source.sound1to2,
    sound2to1: source.sound2to1,
    soundPos2: source.soundPos2,
    soundLoop: source.soundLoop,
    pos1: { ...source.pos1 },
    pos2: { ...source.pos2 },
    message: source.message,
    timestamp: source.timestamp,
    angle: source.angle,
    target: source.target,
    targetname: source.targetname,
    team: source.team,
    targetShaderName: source.targetShaderName,
    targetShaderNewName: source.targetShaderNewName,
    speed: source.speed,
    movedir: { ...source.movedir },
    painDebounceTime: source.painDebounceTime,
    flySoundDebounceTime: source.flySoundDebounceTime,
    lastMoveTime: source.lastMoveTime,
    damage: source.damage,
    splashDamage: source.splashDamage,
    splashRadius: source.splashRadius,
    methodOfDeath: source.methodOfDeath,
    splashMethodOfDeath: source.splashMethodOfDeath,
    count: source.count,
    kamikazeTime: source.kamikazeTime,
    kamikazeShockTime: source.kamikazeShockTime,
    watertype: source.watertype,
    waterlevel: source.waterlevel,
    noiseIndex: source.noiseIndex,
    wait: source.wait,
    random: source.random,
  };
}
export function restoreEntityValues(target: GameEntity, state: EntityValues): void {
  target.spawnflags = state.spawnflags;
  target.neverFree = state.neverFree;
  target.flags = state.flags;
  target.model = state.model;
  target.model2 = state.model2;
  target.freetime = state.freetime;
  target.eventTime = state.eventTime;
  target.freeAfterEvent = state.freeAfterEvent;
  target.unlinkAfterEvent = state.unlinkAfterEvent;
  target.physicsObject = state.physicsObject;
  target.physicsBounce = state.physicsBounce;
  target.clipmask = state.clipmask;
  target.moverState = state.moverState;
  target.soundPos1 = state.soundPos1;
  target.sound1to2 = state.sound1to2;
  target.sound2to1 = state.sound2to1;
  target.soundPos2 = state.soundPos2;
  target.soundLoop = state.soundLoop;
  target.pos1 = { ...state.pos1 };
  target.pos2 = { ...state.pos2 };
  target.message = state.message;
  target.timestamp = state.timestamp;
  target.angle = state.angle;
  target.target = state.target;
  target.targetname = state.targetname;
  target.team = state.team;
  target.targetShaderName = state.targetShaderName;
  target.targetShaderNewName = state.targetShaderNewName;
  target.speed = state.speed;
  target.movedir = { ...state.movedir };
  target.painDebounceTime = state.painDebounceTime;
  target.flySoundDebounceTime = state.flySoundDebounceTime;
  target.lastMoveTime = state.lastMoveTime;
  target.damage = state.damage;
  target.splashDamage = state.splashDamage;
  target.splashRadius = state.splashRadius;
  target.methodOfDeath = state.methodOfDeath;
  target.splashMethodOfDeath = state.splashMethodOfDeath;
  target.count = state.count;
  target.kamikazeTime = state.kamikazeTime;
  target.kamikazeShockTime = state.kamikazeShockTime;
  target.watertype = state.watertype;
  target.waterlevel = state.waterlevel;
  target.noiseIndex = state.noiseIndex;
  target.wait = state.wait;
  target.random = state.random;
}

export type ClientValues = Pick<GameClient, "readyToExit" | "noclip" | "lastCmdTime" | "buttons" | "oldButtons" | "latchedButtons" | "oldOrigin" | "damageArmor" | "damageBlood" | "damageKnockback" | "damageFrom" | "damageFromWorld" | "accurateCount" | "accuracyShots" | "accuracyHits" | "lastKilledClient" | "lastHurtClient" | "lastHurtMod" | "respawnTime" | "inactivityTime" | "inactivityWarning" | "rewardTime" | "airOutTime" | "lastKillTime" | "fireHeld" | "switchTeamTime" | "timeResidual" | "portalID" | "invulnerabilityTime">;
export function captureClientValues(source: GameClient): ClientValues {
  return {
    readyToExit: source.readyToExit,
    noclip: source.noclip,
    lastCmdTime: source.lastCmdTime,
    buttons: source.buttons,
    oldButtons: source.oldButtons,
    latchedButtons: source.latchedButtons,
    oldOrigin: { ...source.oldOrigin },
    damageArmor: source.damageArmor,
    damageBlood: source.damageBlood,
    damageKnockback: source.damageKnockback,
    damageFrom: { ...source.damageFrom },
    damageFromWorld: source.damageFromWorld,
    accurateCount: source.accurateCount,
    accuracyShots: source.accuracyShots,
    accuracyHits: source.accuracyHits,
    lastKilledClient: source.lastKilledClient,
    lastHurtClient: source.lastHurtClient,
    lastHurtMod: source.lastHurtMod,
    respawnTime: source.respawnTime,
    inactivityTime: source.inactivityTime,
    inactivityWarning: source.inactivityWarning,
    rewardTime: source.rewardTime,
    airOutTime: source.airOutTime,
    lastKillTime: source.lastKillTime,
    fireHeld: source.fireHeld,
    switchTeamTime: source.switchTeamTime,
    timeResidual: source.timeResidual,
    portalID: source.portalID,
    invulnerabilityTime: source.invulnerabilityTime,
  };
}
export function restoreClientValues(target: GameClient, state: ClientValues): void {
  target.readyToExit = state.readyToExit;
  target.noclip = state.noclip;
  target.lastCmdTime = state.lastCmdTime;
  target.buttons = state.buttons;
  target.oldButtons = state.oldButtons;
  target.latchedButtons = state.latchedButtons;
  target.oldOrigin = { ...state.oldOrigin };
  target.damageArmor = state.damageArmor;
  target.damageBlood = state.damageBlood;
  target.damageKnockback = state.damageKnockback;
  target.damageFrom = { ...state.damageFrom };
  target.damageFromWorld = state.damageFromWorld;
  target.accurateCount = state.accurateCount;
  target.accuracyShots = state.accuracyShots;
  target.accuracyHits = state.accuracyHits;
  target.lastKilledClient = state.lastKilledClient;
  target.lastHurtClient = state.lastHurtClient;
  target.lastHurtMod = state.lastHurtMod;
  target.respawnTime = state.respawnTime;
  target.inactivityTime = state.inactivityTime;
  target.inactivityWarning = state.inactivityWarning;
  target.rewardTime = state.rewardTime;
  target.airOutTime = state.airOutTime;
  target.lastKillTime = state.lastKillTime;
  target.fireHeld = state.fireHeld;
  target.switchTeamTime = state.switchTeamTime;
  target.timeResidual = state.timeResidual;
  target.portalID = state.portalID;
  target.invulnerabilityTime = state.invulnerabilityTime;
}

export type PlayerValues = Pick<PlayerState, "commandTime" | "pmType" | "bobCycle" | "pmFlags" | "pmTime" | "weaponTime" | "gravity" | "speed" | "deltaAngles" | "groundEntityNum" | "legsTimer" | "legsAnim" | "torsoTimer" | "torsoAnim" | "movementDir" | "grapplePoint" | "eFlags" | "eventSequence" | "externalEvent" | "externalEventParm" | "externalEventTime" | "clientNum" | "weapon" | "weaponState" | "viewangles" | "viewheight" | "damageEvent" | "damageYaw" | "damagePitch" | "damageCount" | "generic1" | "loopSound" | "jumppadEnt" | "ping" | "pmoveFramecount" | "jumppadFrame" | "entityEventSequence">;
export function capturePlayerValues(source: PlayerState): PlayerValues {
  return {
    commandTime: source.commandTime,
    pmType: source.pmType,
    bobCycle: source.bobCycle,
    pmFlags: source.pmFlags,
    pmTime: source.pmTime,
    weaponTime: source.weaponTime,
    gravity: source.gravity,
    speed: source.speed,
    deltaAngles: { ...source.deltaAngles },
    groundEntityNum: source.groundEntityNum,
    legsTimer: source.legsTimer,
    legsAnim: source.legsAnim,
    torsoTimer: source.torsoTimer,
    torsoAnim: source.torsoAnim,
    movementDir: source.movementDir,
    grapplePoint: { ...source.grapplePoint },
    eFlags: source.eFlags,
    eventSequence: source.eventSequence,
    externalEvent: source.externalEvent,
    externalEventParm: source.externalEventParm,
    externalEventTime: source.externalEventTime,
    clientNum: source.clientNum,
    weapon: source.weapon,
    weaponState: source.weaponState,
    viewangles: { ...source.viewangles },
    viewheight: source.viewheight,
    damageEvent: source.damageEvent,
    damageYaw: source.damageYaw,
    damagePitch: source.damagePitch,
    damageCount: source.damageCount,
    generic1: source.generic1,
    loopSound: source.loopSound,
    jumppadEnt: source.jumppadEnt,
    ping: source.ping,
    pmoveFramecount: source.pmoveFramecount,
    jumppadFrame: source.jumppadFrame,
    entityEventSequence: source.entityEventSequence,
  };
}
export function restorePlayerValues(target: PlayerState, state: PlayerValues): void {
  target.commandTime = state.commandTime;
  target.pmType = state.pmType;
  target.bobCycle = state.bobCycle;
  target.pmFlags = state.pmFlags;
  target.pmTime = state.pmTime;
  target.weaponTime = state.weaponTime;
  target.gravity = state.gravity;
  target.speed = state.speed;
  target.deltaAngles = { ...state.deltaAngles };
  target.groundEntityNum = state.groundEntityNum;
  target.legsTimer = state.legsTimer;
  target.legsAnim = state.legsAnim;
  target.torsoTimer = state.torsoTimer;
  target.torsoAnim = state.torsoAnim;
  target.movementDir = state.movementDir;
  target.grapplePoint = { ...state.grapplePoint };
  target.eFlags = state.eFlags;
  target.eventSequence = state.eventSequence;
  target.externalEvent = state.externalEvent;
  target.externalEventParm = state.externalEventParm;
  target.externalEventTime = state.externalEventTime;
  target.clientNum = state.clientNum;
  target.weapon = state.weapon;
  target.weaponState = state.weaponState;
  target.viewangles = { ...state.viewangles };
  target.viewheight = state.viewheight;
  target.damageEvent = state.damageEvent;
  target.damageYaw = state.damageYaw;
  target.damagePitch = state.damagePitch;
  target.damageCount = state.damageCount;
  target.generic1 = state.generic1;
  target.loopSound = state.loopSound;
  target.jumppadEnt = state.jumppadEnt;
  target.ping = state.ping;
  target.pmoveFramecount = state.pmoveFramecount;
  target.jumppadFrame = state.jumppadFrame;
  target.entityEventSequence = state.entityEventSequence;
}

export type PersistantValues = Pick<ClientPersistant, "connected" | "localClient" | "initialSpawn" | "predictItemPickup" | "pmoveFixed" | "netname" | "maxHealth" | "enterTime" | "voteCount" | "teamVoteCount" | "teamInfo">;
export function capturePersistantValues(source: ClientPersistant): PersistantValues {
  return {
    connected: source.connected,
    localClient: source.localClient,
    initialSpawn: source.initialSpawn,
    predictItemPickup: source.predictItemPickup,
    pmoveFixed: source.pmoveFixed,
    netname: source.netname,
    maxHealth: source.maxHealth,
    enterTime: source.enterTime,
    voteCount: source.voteCount,
    teamVoteCount: source.teamVoteCount,
    teamInfo: source.teamInfo,
  };
}
export function restorePersistantValues(target: ClientPersistant, state: PersistantValues): void {
  target.connected = state.connected;
  target.localClient = state.localClient;
  target.initialSpawn = state.initialSpawn;
  target.predictItemPickup = state.predictItemPickup;
  target.pmoveFixed = state.pmoveFixed;
  target.netname = state.netname;
  target.maxHealth = state.maxHealth;
  target.enterTime = state.enterTime;
  target.voteCount = state.voteCount;
  target.teamVoteCount = state.teamVoteCount;
  target.teamInfo = state.teamInfo;
}

export type TeamValues = Pick<PlayerTeamState, "state" | "location" | "captures" | "baseDefense" | "carrierDefense" | "flagRecovery" | "fragCarrier" | "assists" | "lastHurtCarrier" | "lastReturnedFlag" | "flagSince" | "lastFraggedCarrier">;
export function captureTeamValues(source: PlayerTeamState): TeamValues {
  return {
    state: source.state,
    location: source.location,
    captures: source.captures,
    baseDefense: source.baseDefense,
    carrierDefense: source.carrierDefense,
    flagRecovery: source.flagRecovery,
    fragCarrier: source.fragCarrier,
    assists: source.assists,
    lastHurtCarrier: source.lastHurtCarrier,
    lastReturnedFlag: source.lastReturnedFlag,
    flagSince: source.flagSince,
    lastFraggedCarrier: source.lastFraggedCarrier,
  };
}
export function restoreTeamValues(target: PlayerTeamState, state: TeamValues): void {
  target.state = state.state;
  target.location = state.location;
  target.captures = state.captures;
  target.baseDefense = state.baseDefense;
  target.carrierDefense = state.carrierDefense;
  target.flagRecovery = state.flagRecovery;
  target.fragCarrier = state.fragCarrier;
  target.assists = state.assists;
  target.lastHurtCarrier = state.lastHurtCarrier;
  target.lastReturnedFlag = state.lastReturnedFlag;
  target.flagSince = state.flagSince;
  target.lastFraggedCarrier = state.lastFraggedCarrier;
}

export type SessionValues = Pick<ClientSession, "sessionTeam" | "spectatorTime" | "spectatorState" | "spectatorClient" | "wins" | "losses" | "teamLeader">;
export function captureSessionValues(source: ClientSession): SessionValues {
  return {
    sessionTeam: source.sessionTeam,
    spectatorTime: source.spectatorTime,
    spectatorState: source.spectatorState,
    spectatorClient: source.spectatorClient,
    wins: source.wins,
    losses: source.losses,
    teamLeader: source.teamLeader,
  };
}
export function restoreSessionValues(target: ClientSession, state: SessionValues): void {
  target.sessionTeam = state.sessionTeam;
  target.spectatorTime = state.spectatorTime;
  target.spectatorState = state.spectatorState;
  target.spectatorClient = state.spectatorClient;
  target.wins = state.wins;
  target.losses = state.losses;
  target.teamLeader = state.teamLeader;
}

export type NetworkValues = Pick<EntityStateFields, "number" | "eType" | "eFlags" | "time" | "time2" | "origin" | "origin2" | "angles" | "angles2" | "otherEntityNum" | "otherEntityNum2" | "groundEntityNum" | "constantLight" | "loopSound" | "modelindex" | "modelindex2" | "clientNum" | "frame" | "solid" | "event" | "eventParm" | "powerups" | "weapon" | "legsAnim" | "torsoAnim" | "generic1">;
export function captureNetworkValues(source: EntityStateFields): NetworkValues {
  return {
    number: source.number,
    eType: source.eType,
    eFlags: source.eFlags,
    time: source.time,
    time2: source.time2,
    origin: { ...source.origin },
    origin2: { ...source.origin2 },
    angles: { ...source.angles },
    angles2: { ...source.angles2 },
    otherEntityNum: source.otherEntityNum,
    otherEntityNum2: source.otherEntityNum2,
    groundEntityNum: source.groundEntityNum,
    constantLight: source.constantLight,
    loopSound: source.loopSound,
    modelindex: source.modelindex,
    modelindex2: source.modelindex2,
    clientNum: source.clientNum,
    frame: source.frame,
    solid: source.solid,
    event: source.event,
    eventParm: source.eventParm,
    powerups: source.powerups,
    weapon: source.weapon,
    legsAnim: source.legsAnim,
    torsoAnim: source.torsoAnim,
    generic1: source.generic1,
  };
}
export function restoreNetworkValues(target: EntityStateFields, state: NetworkValues): void {
  target.number = state.number;
  target.eType = state.eType;
  target.eFlags = state.eFlags;
  target.time = state.time;
  target.time2 = state.time2;
  target.origin = { ...state.origin };
  target.origin2 = { ...state.origin2 };
  target.angles = { ...state.angles };
  target.angles2 = { ...state.angles2 };
  target.otherEntityNum = state.otherEntityNum;
  target.otherEntityNum2 = state.otherEntityNum2;
  target.groundEntityNum = state.groundEntityNum;
  target.constantLight = state.constantLight;
  target.loopSound = state.loopSound;
  target.modelindex = state.modelindex;
  target.modelindex2 = state.modelindex2;
  target.clientNum = state.clientNum;
  target.frame = state.frame;
  target.solid = state.solid;
  target.event = state.event;
  target.eventParm = state.eventParm;
  target.powerups = state.powerups;
  target.weapon = state.weapon;
  target.legsAnim = state.legsAnim;
  target.torsoAnim = state.torsoAnim;
  target.generic1 = state.generic1;
}

export type LevelValues = Pick<GameLevel, "time" | "startTime" | "warmupTime" | "warmupModificationCount" | "restarted" | "numConnectedClients" | "numNonSpectatorClients" | "numPlayingClients" | "numVotingClients" | "follow1" | "follow2" | "intermissionTime" | "intermissionQueued" | "intermissionOrigin" | "intermissionAngle" | "changemap" | "readyToExit" | "exitTime" | "frameNum" | "previousTime" | "newSession" | "frySound">;
export function captureLevelValues(source: GameLevel): LevelValues {
  return {
    time: source.time,
    startTime: source.startTime,
    warmupTime: source.warmupTime,
    warmupModificationCount: source.warmupModificationCount,
    restarted: source.restarted,
    numConnectedClients: source.numConnectedClients,
    numNonSpectatorClients: source.numNonSpectatorClients,
    numPlayingClients: source.numPlayingClients,
    numVotingClients: source.numVotingClients,
    follow1: source.follow1,
    follow2: source.follow2,
    intermissionTime: source.intermissionTime,
    intermissionQueued: source.intermissionQueued,
    intermissionOrigin: { ...source.intermissionOrigin },
    intermissionAngle: { ...source.intermissionAngle },
    changemap: source.changemap,
    readyToExit: source.readyToExit,
    exitTime: source.exitTime,
    frameNum: source.frameNum,
    previousTime: source.previousTime,
    newSession: source.newSession,
    frySound: source.frySound,
  };
}
export function restoreLevelValues(target: GameLevel, state: LevelValues): void {
  target.time = state.time;
  target.startTime = state.startTime;
  target.warmupTime = state.warmupTime;
  target.warmupModificationCount = state.warmupModificationCount;
  target.restarted = state.restarted;
  target.numConnectedClients = state.numConnectedClients;
  target.numNonSpectatorClients = state.numNonSpectatorClients;
  target.numPlayingClients = state.numPlayingClients;
  target.numVotingClients = state.numVotingClients;
  target.follow1 = state.follow1;
  target.follow2 = state.follow2;
  target.intermissionTime = state.intermissionTime;
  target.intermissionQueued = state.intermissionQueued;
  target.intermissionOrigin = { ...state.intermissionOrigin };
  target.intermissionAngle = { ...state.intermissionAngle };
  target.changemap = state.changemap;
  target.readyToExit = state.readyToExit;
  target.exitTime = state.exitTime;
  target.frameNum = state.frameNum;
  target.previousTime = state.previousTime;
  target.newSession = state.newSession;
  target.frySound = state.frySound;
}

export function readEntityValues(reader: SaveReader): EntityValues {
  return {
    spawnflags: reader.field("spawnflags").number(),
    neverFree: reader.field("neverFree").boolean(),
    flags: reader.field("flags").number(),
    model: reader.field("model").nullable(value => value.string()),
    model2: reader.field("model2").nullable(value => value.string()),
    freetime: reader.field("freetime").number(),
    eventTime: reader.field("eventTime").number(),
    freeAfterEvent: reader.field("freeAfterEvent").boolean(),
    unlinkAfterEvent: reader.field("unlinkAfterEvent").boolean(),
    physicsObject: reader.field("physicsObject").boolean(),
    physicsBounce: reader.field("physicsBounce").number(),
    clipmask: reader.field("clipmask").number(),
    moverState: reader.field("moverState").number(),
    soundPos1: reader.field("soundPos1").number(),
    sound1to2: reader.field("sound1to2").number(),
    sound2to1: reader.field("sound2to1").number(),
    soundPos2: reader.field("soundPos2").number(),
    soundLoop: reader.field("soundLoop").number(),
    pos1: readVector(reader.field("pos1")),
    pos2: readVector(reader.field("pos2")),
    message: reader.field("message").nullable(value => value.string()),
    timestamp: reader.field("timestamp").number(),
    angle: reader.field("angle").number(),
    target: reader.field("target").nullable(value => value.string()),
    targetname: reader.field("targetname").nullable(value => value.string()),
    team: reader.field("team").nullable(value => value.string()),
    targetShaderName: reader.field("targetShaderName").nullable(value => value.string()),
    targetShaderNewName: reader.field("targetShaderNewName").nullable(value => value.string()),
    speed: reader.field("speed").number(),
    movedir: readVector(reader.field("movedir")),
    painDebounceTime: reader.field("painDebounceTime").number(),
    flySoundDebounceTime: reader.field("flySoundDebounceTime").number(),
    lastMoveTime: reader.field("lastMoveTime").number(),
    damage: reader.field("damage").number(),
    splashDamage: reader.field("splashDamage").number(),
    splashRadius: reader.field("splashRadius").number(),
    methodOfDeath: reader.field("methodOfDeath").number(),
    splashMethodOfDeath: reader.field("splashMethodOfDeath").number(),
    count: reader.field("count").number(),
    kamikazeTime: reader.field("kamikazeTime").number(),
    kamikazeShockTime: reader.field("kamikazeShockTime").number(),
    watertype: reader.field("watertype").number(),
    waterlevel: reader.field("waterlevel").number(),
    noiseIndex: reader.field("noiseIndex").number(),
    wait: reader.field("wait").number(),
    random: reader.field("random").number(),
  };
}

export function readClientValues(reader: SaveReader): ClientValues {
  return {
    readyToExit: reader.field("readyToExit").boolean(),
    noclip: reader.field("noclip").boolean(),
    lastCmdTime: reader.field("lastCmdTime").number(),
    buttons: reader.field("buttons").number(),
    oldButtons: reader.field("oldButtons").number(),
    latchedButtons: reader.field("latchedButtons").number(),
    oldOrigin: readVector(reader.field("oldOrigin")),
    damageArmor: reader.field("damageArmor").number(),
    damageBlood: reader.field("damageBlood").number(),
    damageKnockback: reader.field("damageKnockback").number(),
    damageFrom: readVector(reader.field("damageFrom")),
    damageFromWorld: reader.field("damageFromWorld").boolean(),
    accurateCount: reader.field("accurateCount").number(),
    accuracyShots: reader.field("accuracyShots").number(),
    accuracyHits: reader.field("accuracyHits").number(),
    lastKilledClient: reader.field("lastKilledClient").number(),
    lastHurtClient: reader.field("lastHurtClient").number(),
    lastHurtMod: reader.field("lastHurtMod").number(),
    respawnTime: reader.field("respawnTime").number(),
    inactivityTime: reader.field("inactivityTime").number(),
    inactivityWarning: reader.field("inactivityWarning").boolean(),
    rewardTime: reader.field("rewardTime").number(),
    airOutTime: reader.field("airOutTime").number(),
    lastKillTime: reader.field("lastKillTime").number(),
    fireHeld: reader.field("fireHeld").boolean(),
    switchTeamTime: reader.field("switchTeamTime").number(),
    timeResidual: reader.field("timeResidual").number(),
    portalID: reader.field("portalID").number(),
    invulnerabilityTime: reader.field("invulnerabilityTime").number(),
  };
}

export function readPlayerValues(reader: SaveReader): PlayerValues {
  return {
    commandTime: reader.field("commandTime").number(),
    pmType: reader.field("pmType").number(),
    bobCycle: reader.field("bobCycle").number(),
    pmFlags: reader.field("pmFlags").number(),
    pmTime: reader.field("pmTime").number(),
    weaponTime: reader.field("weaponTime").number(),
    gravity: reader.field("gravity").number(),
    speed: reader.field("speed").number(),
    deltaAngles: readVector(reader.field("deltaAngles")),
    groundEntityNum: reader.field("groundEntityNum").number(),
    legsTimer: reader.field("legsTimer").number(),
    legsAnim: reader.field("legsAnim").number(),
    torsoTimer: reader.field("torsoTimer").number(),
    torsoAnim: reader.field("torsoAnim").number(),
    movementDir: reader.field("movementDir").number(),
    grapplePoint: readVector(reader.field("grapplePoint")),
    eFlags: reader.field("eFlags").number(),
    eventSequence: reader.field("eventSequence").number(),
    externalEvent: reader.field("externalEvent").number(),
    externalEventParm: reader.field("externalEventParm").number(),
    externalEventTime: reader.field("externalEventTime").number(),
    clientNum: reader.field("clientNum").number(),
    weapon: reader.field("weapon").number(),
    weaponState: reader.field("weaponState").number(),
    viewangles: readVector(reader.field("viewangles")),
    viewheight: reader.field("viewheight").number(),
    damageEvent: reader.field("damageEvent").number(),
    damageYaw: reader.field("damageYaw").number(),
    damagePitch: reader.field("damagePitch").number(),
    damageCount: reader.field("damageCount").number(),
    generic1: reader.field("generic1").number(),
    loopSound: reader.field("loopSound").number(),
    jumppadEnt: reader.field("jumppadEnt").number(),
    ping: reader.field("ping").number(),
    pmoveFramecount: reader.field("pmoveFramecount").number(),
    jumppadFrame: reader.field("jumppadFrame").number(),
    entityEventSequence: reader.field("entityEventSequence").number(),
  };
}

export function readPersistantValues(reader: SaveReader): PersistantValues {
  return {
    connected: reader.field("connected").number(),
    localClient: reader.field("localClient").boolean(),
    initialSpawn: reader.field("initialSpawn").boolean(),
    predictItemPickup: reader.field("predictItemPickup").boolean(),
    pmoveFixed: reader.field("pmoveFixed").boolean(),
    netname: reader.field("netname").string(),
    maxHealth: reader.field("maxHealth").number(),
    enterTime: reader.field("enterTime").number(),
    voteCount: reader.field("voteCount").number(),
    teamVoteCount: reader.field("teamVoteCount").number(),
    teamInfo: reader.field("teamInfo").boolean(),
  };
}

export function readTeamValues(reader: SaveReader): TeamValues {
  return {
    state: reader.field("state").number(),
    location: reader.field("location").number(),
    captures: reader.field("captures").number(),
    baseDefense: reader.field("baseDefense").number(),
    carrierDefense: reader.field("carrierDefense").number(),
    flagRecovery: reader.field("flagRecovery").number(),
    fragCarrier: reader.field("fragCarrier").number(),
    assists: reader.field("assists").number(),
    lastHurtCarrier: reader.field("lastHurtCarrier").number(),
    lastReturnedFlag: reader.field("lastReturnedFlag").number(),
    flagSince: reader.field("flagSince").number(),
    lastFraggedCarrier: reader.field("lastFraggedCarrier").number(),
  };
}

export function readSessionValues(reader: SaveReader): SessionValues {
  return {
    sessionTeam: reader.field("sessionTeam").number(),
    spectatorTime: reader.field("spectatorTime").number(),
    spectatorState: reader.field("spectatorState").number(),
    spectatorClient: reader.field("spectatorClient").number(),
    wins: reader.field("wins").number(),
    losses: reader.field("losses").number(),
    teamLeader: reader.field("teamLeader").number(),
  };
}

export function readNetworkValues(reader: SaveReader): NetworkValues {
  return {
    number: reader.field("number").number(),
    eType: reader.field("eType").number(),
    eFlags: reader.field("eFlags").number(),
    time: reader.field("time").number(),
    time2: reader.field("time2").number(),
    origin: readVector(reader.field("origin")),
    origin2: readVector(reader.field("origin2")),
    angles: readVector(reader.field("angles")),
    angles2: readVector(reader.field("angles2")),
    otherEntityNum: reader.field("otherEntityNum").number(),
    otherEntityNum2: reader.field("otherEntityNum2").number(),
    groundEntityNum: reader.field("groundEntityNum").number(),
    constantLight: reader.field("constantLight").number(),
    loopSound: reader.field("loopSound").number(),
    modelindex: reader.field("modelindex").number(),
    modelindex2: reader.field("modelindex2").number(),
    clientNum: reader.field("clientNum").number(),
    frame: reader.field("frame").number(),
    solid: reader.field("solid").number(),
    event: reader.field("event").number(),
    eventParm: reader.field("eventParm").number(),
    powerups: reader.field("powerups").number(),
    weapon: reader.field("weapon").number(),
    legsAnim: reader.field("legsAnim").number(),
    torsoAnim: reader.field("torsoAnim").number(),
    generic1: reader.field("generic1").number(),
  };
}

export function readLevelValues(reader: SaveReader): LevelValues {
  return {
    time: reader.field("time").number(),
    startTime: reader.field("startTime").number(),
    warmupTime: reader.field("warmupTime").number(),
    warmupModificationCount: reader.field("warmupModificationCount").number(),
    restarted: reader.field("restarted").boolean(),
    numConnectedClients: reader.field("numConnectedClients").number(),
    numNonSpectatorClients: reader.field("numNonSpectatorClients").number(),
    numPlayingClients: reader.field("numPlayingClients").number(),
    numVotingClients: reader.field("numVotingClients").number(),
    follow1: reader.field("follow1").number(),
    follow2: reader.field("follow2").number(),
    intermissionTime: reader.field("intermissionTime").number(),
    intermissionQueued: reader.field("intermissionQueued").number(),
    intermissionOrigin: readVector(reader.field("intermissionOrigin")),
    intermissionAngle: readVector(reader.field("intermissionAngle")),
    changemap: reader.field("changemap").nullable(value => value.string()),
    readyToExit: reader.field("readyToExit").boolean(),
    exitTime: reader.field("exitTime").number(),
    frameNum: reader.field("frameNum").number(),
    previousTime: reader.field("previousTime").number(),
    newSession: reader.field("newSession").boolean(),
    frySound: reader.field("frySound").number(),
  };
}

export function readVector(reader: SaveReader) { return { x: reader.field("x").number(), y: reader.field("y").number(), z: reader.field("z").number() }; }