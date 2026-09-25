import type { QvmBodyPart, QvmScenePresentation } from "../../contracts/qvm-mod-presentation.ts";
import { QvmOpcode, type QvmImage } from "./image.ts";

/** A declared body helper owns only its direct calls inside the matched original player function. */
export function qualifyQvmBodyCalls(image: QvmImage, body: QvmScenePresentation["body"]): ReadonlyMap<number, QvmBodyPart> {
  const { player, mesh } = body, instructions = image.instructions;
  if ([player.centityArgument, mesh.entityArgument, mesh.stateArgument].some(argument => !Number.isInteger(argument) || argument < 0 || argument > 9)
    || mesh.shaderOffset !== 112) throw new Error("Source body arguments differ from the original refEntity ABI");
  if (instructions[player.entry]?.opcode !== QvmOpcode.OP_ENTER || instructions[mesh.entry]?.opcode !== QvmOpcode.OP_ENTER)
    throw new Error("Source body scope requires original function entries");
  let end = player.entry + 1;
  while (end < instructions.length && instructions[end]?.opcode !== QvmOpcode.OP_ENTER) end++;
  const calls = new Map<number, QvmBodyPart>();
  const valid = (index: number): boolean => {
    const target = instructions[index - 1];
    return index > player.entry && index < end && instructions[index]?.opcode === QvmOpcode.OP_CALL
      && target?.opcode === QvmOpcode.OP_CONST && target.operand === mesh.entry;
  };
  if (mesh.parts === undefined) {
    for (let index = player.entry + 1; index < end; index++) if (valid(index)) calls.set(index, "body");
  } else for (const row of mesh.parts) {
    if (!Number.isSafeInteger(row.call) || !valid(row.call) || calls.has(row.call)) throw new Error("Source body part does not name a distinct original player-to-mesh call");
    calls.set(row.call, row.part);
  }
  if (calls.size === 0) throw new Error("Source body scope has no qualified original mesh calls");
  return calls;
}
