import { qvmLegacyBotLibrarySyscall } from './legacy-bot-syscalls.ts';
import { QvmGameImport } from './abi.ts';
import type { QvmHostCall, QvmHostResult } from './syscalls.ts';
import { float32ToBits } from '../../core/numeric.ts';
import type { BotLibrary } from '../../bots/behavior/q3/library.ts';
import { readQvmBotGoal, writeQvmBotGoal, QVM_BOT_GOAL_BYTES } from './bot-navigation-records.ts';
import { touchingGoal } from '../../bots/behavior/library/goals.ts';
import { QVM_SCRIPT_TOKEN_BYTES, writeQvmScriptToken } from './script-record.ts';
import { QVM_USER_COMMAND_BYTES } from './client-state-record.ts';
import { stringContains, unifyWhiteSpacesInPlace, type ChatVariableSources, type ChatMatchBuffer, type ChatMatchVariable } from '../../bots/behavior/library/chat.ts';
import type { WireUserCommand } from '../../network/q3/message.ts';
export interface QvmBotLibraryServices {
    readonly library: BotLibrary;
    setup(): number | Promise<number>;
    shutdown(): number;
    loadMap(name: string): number | Promise<number>;
    updateEntity(number: number, call: QvmHostCall, pointer: number): number;
    snapshotEntity(client: number, sequence: number): number;
    consoleMessage(client: number): string | null;
    userCommand(client: number, command: WireUserCommand): void | Promise<void>;
    allocateClient(): number;
    freeClient(client: number): void | Promise<void>;
}
export function qvmBotLibrarySyscall(call: QvmHostCall, services: QvmBotLibraryServices): QvmHostResult | null {
    const legacy = qvmLegacyBotLibrarySyscall(call, services);
    if (legacy !== null) return legacy;
    if (call.kind !== 'engine' || call.role !== 'qagame') return null;
    const { guest, words } = call, library = services.library;
    const int = (index: number): number => words.getInt32(index * 4, true);
    const float = (index: number): number => words.getFloat32(index * 4, true);
    const text = (index: number): string => guest.readString(int(index));
    const vector = (index: number) => { const view = guest.view(int(index), 12); return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) }; };
    const nullableText = (index: number): string | null => int(index) === 0 ? null : text(index);
    const variables = (start: number): ChatVariableSources => [nullableText(start), nullableText(start + 1), nullableText(start + 2), nullableText(start + 3), nullableText(start + 4), nullableText(start + 5), nullableText(start + 6), nullableText(start + 7)];
    const inventory = (index: number) => (item: number): number => guest.view(int(index), 4, item * 4).getInt32(0, true);
    const goal = (index: number) => readQvmBotGoal(guest.view(int(index), QVM_BOT_GOAL_BYTES));
    const complete = (result: void | Promise<void>): QvmHostResult => result === undefined ? 0 : result.then(() => 0);
    switch (call.code) {
        case QvmGameImport.G_BOT_ALLOCATE_CLIENT: return services.allocateClient();
        case QvmGameImport.G_BOT_FREE_CLIENT: return complete(services.freeClient(int(1)));
        case QvmGameImport.BOTLIB_SETUP: return services.setup();
        case QvmGameImport.BOTLIB_SHUTDOWN: return services.shutdown();
        case QvmGameImport.BOTLIB_LIBVAR_SET: library.variables.set(text(1), text(2)); return 0;
        case QvmGameImport.BOTLIB_LIBVAR_GET: guest.writeString(int(2), library.variables.getString(text(1)), int(3)); return 0;
        case QvmGameImport.BOTLIB_PC_ADD_GLOBAL_DEFINE: return Number(library.globals.add(text(1)));
        case QvmGameImport.BOTLIB_START_FRAME: return library.startFrame(float(1));
        case QvmGameImport.BOTLIB_LOAD_MAP: return services.loadMap(text(1));
        case QvmGameImport.BOTLIB_UPDATENTITY: return services.updateEntity(int(1), call, int(2));
        case QvmGameImport.BOTLIB_GET_SNAPSHOT_ENTITY: return services.snapshotEntity(int(1), int(2));
        case QvmGameImport.BOTLIB_GET_CONSOLE_MESSAGE: {
            const message = services.consoleMessage(int(1));
            if (message === null) return 0;
            guest.writeString(int(2), message, int(3)); return 1;
        }
        case QvmGameImport.BOTLIB_USER_COMMAND: return complete(services.userCommand(int(1), readQvmUserCommand(guest.view(int(2), QVM_USER_COMMAND_BYTES))));
        case QvmGameImport.BOTLIB_EA_SAY: library.actions.say(int(1), text(2)); return 0;
        case QvmGameImport.BOTLIB_EA_SAY_TEAM: library.actions.sayTeam(int(1), text(2)); return 0;
        case QvmGameImport.BOTLIB_EA_COMMAND: library.actions.command(int(1), text(2)); return 0;
        case QvmGameImport.BOTLIB_EA_ACTION: library.actions.action(int(1), int(2)); return 0;
        case QvmGameImport.BOTLIB_EA_GESTURE: library.actions.gesture(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_TALK: library.actions.talk(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_ATTACK: library.actions.attack(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_USE: library.actions.use(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_RESPAWN: library.actions.respawn(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_CROUCH: library.actions.crouch(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_MOVE_UP: library.actions.moveUp(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_MOVE_DOWN: library.actions.moveDown(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_MOVE_FORWARD: library.actions.moveForward(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_MOVE_BACK: library.actions.moveBack(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_MOVE_LEFT: library.actions.moveLeft(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_MOVE_RIGHT: library.actions.moveRight(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_SELECT_WEAPON: library.actions.selectWeapon(int(1), int(2)); return 0;
        case QvmGameImport.BOTLIB_EA_JUMP: library.actions.jump(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_DELAYED_JUMP: library.actions.delayedJump(int(1)); return 0;
        case QvmGameImport.BOTLIB_EA_MOVE: library.actions.move(int(1), vector(2), float(3)); return 0;
        case QvmGameImport.BOTLIB_EA_VIEW: library.actions.view(int(1), vector(2)); return 0;
        case QvmGameImport.BOTLIB_EA_END_REGULAR: library.actions.endRegular(int(1), float(2)); return 0;
        case QvmGameImport.BOTLIB_EA_GET_INPUT: guest.span(int(3), 40).set(library.actions.getInputBytes(int(1), float(2))); return 0;
        case QvmGameImport.BOTLIB_EA_RESET_INPUT: library.actions.resetInput(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_LOAD_CHARACTER: return library.characters.load(text(1), float(2));
        case QvmGameImport.BOTLIB_AI_FREE_CHARACTER: library.characters.free(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_CHARACTERISTIC_FLOAT: return float32ToBits(library.characters.float(int(1), int(2)));
        case QvmGameImport.BOTLIB_AI_CHARACTERISTIC_BFLOAT: return float32ToBits(library.characters.boundedFloat(int(1), int(2), float(3), float(4)));
        case QvmGameImport.BOTLIB_AI_CHARACTERISTIC_INTEGER: return library.characters.integer(int(1), int(2));
        case QvmGameImport.BOTLIB_AI_CHARACTERISTIC_BINTEGER: return library.characters.boundedInteger(int(1), int(2), int(3), int(4));
        case QvmGameImport.BOTLIB_AI_CHARACTERISTIC_STRING: guest.writeString(int(3), library.characters.string(int(1), int(2)), int(4)); return 0;
        case QvmGameImport.BOTLIB_AI_ALLOC_CHAT_STATE: return library.chat.allocate();
        case QvmGameImport.BOTLIB_AI_FREE_CHAT_STATE: library.chat.free(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_QUEUE_CONSOLE_MESSAGE: library.chat.queueConsoleMessage(int(1), int(2), text(3)); return 0;
        case QvmGameImport.BOTLIB_AI_REMOVE_CONSOLE_MESSAGE: library.chat.removeConsoleMessage(int(1), int(2)); return 0;
        case QvmGameImport.BOTLIB_AI_NUM_CONSOLE_MESSAGE: return library.chat.numConsoleMessages(int(1));
        case QvmGameImport.BOTLIB_AI_NEXT_CONSOLE_MESSAGE: {
            const message = library.chat.nextConsoleMessage(int(1)); if (message === null) return 0;
            const view = guest.view(int(2), 276); view.setInt32(0, message.handle, true); view.setFloat32(4, message.time, true); view.setInt32(8, message.type, true);
            guest.writeString(int(2) + 12, message.message, 256); view.setInt32(268, 0, true); view.setInt32(272, 0, true); return message.handle;
        }
        case QvmGameImport.BOTLIB_AI_INITIAL_CHAT: library.chat.initialChat(int(1), nullableText(2), int(3), variables(4)); return 0;
        case QvmGameImport.BOTLIB_AI_REPLY_CHAT: return Number(library.chat.replyChat(int(1), text(2), int(3), int(4), variables(5)));
        case QvmGameImport.BOTLIB_AI_NUM_INITIAL_CHATS: return library.chat.numInitialChats(int(1), nullableText(2));
        case QvmGameImport.BOTLIB_AI_CHAT_LENGTH: return library.chat.chatLength(int(1));
        case QvmGameImport.BOTLIB_AI_ENTER_CHAT: library.chat.enterChat(int(1), int(2), int(3)); return 0;
        case QvmGameImport.BOTLIB_AI_GET_CHAT_MESSAGE: library.chat.writeChatMessage(int(1), message => guest.writeString(int(2), message, int(3))); return 0;
        case QvmGameImport.BOTLIB_AI_STRING_CONTAINS: return stringContains(nullableText(1), nullableText(2), int(3) !== 0);
        case QvmGameImport.BOTLIB_AI_UNIFY_WHITE_SPACES: unifyWhiteSpacesInPlace(guest.pointer(int(1))); return 0;
        case QvmGameImport.BOTLIB_AI_REPLACE_SYNONYMS: library.chat.replaceSynonymsInPlace(() => guest.pointer(int(1)), int(2)); return 0;
        case QvmGameImport.BOTLIB_AI_LOAD_CHAT_FILE: return library.chat.loadChatFile(int(1), text(2), text(3)) ? 0 : 8;
        case QvmGameImport.BOTLIB_AI_SET_CHAT_GENDER: library.chat.setGender(int(1), int(2)); return 0;
        case QvmGameImport.BOTLIB_AI_SET_CHAT_NAME: library.chat.setName(int(1), text(2), int(3)); return 0;
        case QvmGameImport.BOTLIB_AI_ALLOC_GOAL_STATE: return library.goals.allocGoalState(int(1));
        case QvmGameImport.BOTLIB_AI_FREE_GOAL_STATE: library.goals.freeGoalState(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_RESET_GOAL_STATE: library.goals.resetGoalState(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_RESET_AVOID_GOALS: library.goals.resetAvoidGoals(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_PUSH_GOAL: library.goals.pushGoal(int(1), () => guest.span(int(2), QVM_BOT_GOAL_BYTES)); return 0;
        case QvmGameImport.BOTLIB_AI_POP_GOAL: library.goals.popGoal(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_EMPTY_GOAL_STACK: library.goals.emptyGoalStack(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_GET_TOP_GOAL:
        case QvmGameImport.BOTLIB_AI_GET_SECOND_GOAL: {
            const result = call.code === QvmGameImport.BOTLIB_AI_GET_TOP_GOAL ? library.goals.getTopGoalBytes(int(1)) : library.goals.getSecondGoalBytes(int(1));
            if (result === null) return 0; guest.span(int(2), QVM_BOT_GOAL_BYTES).set(result); return 1;
        }
        case QvmGameImport.BOTLIB_AI_GOAL_NAME: guest.writeString(int(2), library.goals.goalName(int(1)), int(3)); return 0;
        case QvmGameImport.BOTLIB_AI_AVOID_GOAL_TIME: return float32ToBits(library.goals.avoidGoalTime(int(1), int(2)));
        case QvmGameImport.BOTLIB_AI_SET_AVOID_GOAL_TIME: library.goals.setAvoidGoalTime(int(1), int(2), float(3)); return 0;
        case QvmGameImport.BOTLIB_AI_REMOVE_FROM_AVOID_GOALS: library.goals.removeFromAvoidGoals(int(1), int(2)); return 0;
        case QvmGameImport.BOTLIB_AI_LOAD_ITEM_WEIGHTS: return library.goals.loadItemWeights(int(1), () => text(2));
        case QvmGameImport.BOTLIB_AI_FREE_ITEM_WEIGHTS: library.goals.freeItemWeights(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_CHOOSE_LTG_ITEM: return Number(library.goals.chooseLTGItem(int(1), vector(2), inventory(3), int(4)));
        case QvmGameImport.BOTLIB_AI_CHOOSE_NBG_ITEM: return Number(library.goals.chooseNBGItem(int(1), vector(2), inventory(3), int(4), int(5) === 0 ? null : goal(5), float(6)));
        case QvmGameImport.BOTLIB_AI_TOUCHING_GOAL: return Number(touchingGoal(vector(1), goal(2)));
        case QvmGameImport.BOTLIB_AI_ITEM_GOAL_IN_VIS_BUT_NOT_VISIBLE: return Number(library.goals.itemGoalInVisButNotVisible(int(1), vector(2), vector(3), goal(4)));
        case QvmGameImport.BOTLIB_AI_INIT_LEVEL_ITEMS: library.goals.initLevelItems(); return 0;
        case QvmGameImport.BOTLIB_AI_UPDATE_ENTITY_ITEMS: library.goals.updateEntityItems(); return 0;
        case QvmGameImport.BOTLIB_AI_ALLOC_WEAPON_STATE: return library.weapons.allocateState();
        case QvmGameImport.BOTLIB_AI_FREE_WEAPON_STATE: library.weapons.freeState(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_RESET_WEAPON_STATE: library.weapons.resetState(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_LOAD_WEAPON_WEIGHTS: return library.weapons.loadWeights(int(1), () => text(2));
        case QvmGameImport.BOTLIB_AI_CHOOSE_BEST_FIGHT_WEAPON: return library.weapons.chooseBestFightWeapon(int(1), inventory(2));
        case QvmGameImport.BOTLIB_AI_GET_WEAPON_INFO: {
            const bytes = library.weapons.weaponInfoBytes(int(1), int(2)); if (bytes !== undefined) guest.span(int(3), bytes.length).set(bytes); return 0;
        }
        case QvmGameImport.BOTLIB_AI_GET_LEVEL_ITEM_GOAL:
        case QvmGameImport.BOTLIB_AI_GET_MAP_LOCATION_GOAL: {
            const location = call.code === QvmGameImport.BOTLIB_AI_GET_MAP_LOCATION_GOAL;
            const output = location ? 2 : 3;
            const result = location ? library.goals.getMapLocationGoal(text(1), goal(output)) : library.goals.getLevelItemGoal(int(1), text(2), goal(output));
            if (result === null) return 0; writeQvmBotGoal(guest.view(int(output), QVM_BOT_GOAL_BYTES), result, location ? 'location' : 'level-item'); return location ? 1 : result.number;
        }
        case QvmGameImport.BOTLIB_AI_GET_NEXT_CAMP_SPOT_GOAL: {
            const result = library.goals.getNextCampSpotGoal(int(1), goal(2)); if (result === null) return 0;
            writeQvmBotGoal(guest.view(int(2), QVM_BOT_GOAL_BYTES), result.goal); return result.next;
        }
        case QvmGameImport.BOTLIB_AI_DUMP_AVOID_GOALS: library.goals.dumpAvoidGoals(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_DUMP_GOAL_STACK: library.goals.dumpGoalStack(int(1)); return 0;
        case QvmGameImport.BOTLIB_AI_INTERBREED_GOAL_FUZZY_LOGIC: library.goals.interbreedGoalFuzzyLogic(int(1), int(2), int(3)); return 0;
        case QvmGameImport.BOTLIB_AI_MUTATE_GOAL_FUZZY_LOGIC: library.goals.mutateGoalFuzzyLogic(int(1), float(2)); return 0;
        case QvmGameImport.BOTLIB_AI_SAVE_GOAL_FUZZY_LOGIC: library.goals.saveGoalFuzzyLogic(int(1), text(2)); return 0;
        case QvmGameImport.BOTLIB_AI_GENETIC_PARENTS_AND_CHILD_SELECTION: {
            const result = library.geneticSelection({ count: int(1), rank: index => guest.view(int(2), 4, index * 4).getFloat32(0, true),
                write: (target, value) => guest.view(int(target === 'parent1' ? 3 : target === 'parent2' ? 4 : 5), 4).setInt32(0, value, true) });
            return Number(result.kind === 'selected');
        }
        case QvmGameImport.BOTLIB_AI_FIND_MATCH: {
            const view = guest.view(int(2), 328);
            const variable = (index: number): ChatMatchVariable => ({
                get offset() { return view.getInt8(264 + index * 8); }, set offset(value) { view.setInt8(264 + index * 8, value); },
                get length() { return view.getInt32(268 + index * 8, true); }, set length(value) { view.setInt32(268 + index * 8, value, true); },
            });
            const buffer: ChatMatchBuffer = { string: guest.span(int(2), 256),
                get type() { return view.getInt32(256, true); }, set type(value) { view.setInt32(256, value, true); },
                get subtype() { return view.getInt32(260, true); }, set subtype(value) { view.setInt32(260, value, true); },
                variables: [variable(0), variable(1), variable(2), variable(3), variable(4), variable(5), variable(6), variable(7)] };
            return Number(library.chat.findMatchInto(text(1), int(3), buffer));
        }
        case QvmGameImport.BOTLIB_AI_MATCH_VARIABLE: {
            const view = guest.view(int(1), 328);
            library.chat.writeMatchVariable(index => ({ offset: view.getInt8(264 + index * 8), length: view.getInt32(268 + index * 8, true) }), int(2), int(4),
                (offset, capacity) => guest.writeString(int(3), guest.readString(int(1) + offset), capacity), () => { guest.span(int(3), 1)[0] = 0; }); return 0;
        }
        case QvmGameImport.BOTLIB_PC_LOAD_SOURCE: return library.sources.loadSourceHandle(text(1));
        case QvmGameImport.BOTLIB_PC_FREE_SOURCE: return Number(library.sources.freeSourceHandle(int(1)));
        case QvmGameImport.BOTLIB_PC_READ_TOKEN: {
            const result = library.sources.readTokenHandleResult(int(1)); if (result === undefined) return 0;
            writeQvmScriptToken(guest.view(int(2), QVM_SCRIPT_TOKEN_BYTES), result.token); return Number(result.read);
        }
        case QvmGameImport.BOTLIB_PC_SOURCE_FILE_AND_LINE: {
            const result = library.sources.sourceFileAndLine(int(1)); if (result === undefined) return 0;
            guest.writeString(int(2), result.filename, 128); guest.view(int(3), 4).setInt32(0, result.line, true); return 1;
        }
        default: return null;
    }
}

function readQvmUserCommand(view: DataView): WireUserCommand {
    return { serverTime: view.getInt32(0, true), angles: [view.getInt32(4, true), view.getInt32(8, true), view.getInt32(12, true)], buttons: view.getInt32(16, true), weapon: view.getUint8(20), forwardmove: view.getInt8(21), rightmove: view.getInt8(22), upmove: view.getInt8(23) };
}
