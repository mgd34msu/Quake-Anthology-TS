import type { CommandContext } from "../contracts/common.ts";
import type { CommandBuffer } from "../core/commands/index.ts";

/** Explicit placeholders; no provider request or returned command execution occurs. */
export function registerLlmCommands(commands: CommandBuffer, print: (text: string, source: CommandContext) => void): () => void {
  const registered: string[] = [];
  for (const definition of [
    { name: "llm_ask", usage: "llm_ask <question>",
      summary: "Placeholder: LLM requests are not implemented yet. Future: print an LLM answer in the console.",
      examples: ['llm_ask "How do I change brightness?"'] },
    { name: "llm_exec", usage: "llm_exec <request>",
      summary: "Placeholder: LLM requests are not implemented yet. Future: a predefined LLM returns valid semicolon-separated console commands, executed through the normal parser in the invoking user context. Print the exact commands executed, then their results, for inspection, copying and reuse.",
      examples: ['llm_exec "Set brightness to the default"'] },
  ]) {
    if (commands.register(definition.name, invocation => {
      print(invocation.args.join(" ").trim().length === 0
        ? `Usage: ${definition.usage}\nQuote text containing semicolons.\n`
        : "LLM requests are not implemented yet.\n", invocation.source);
      return undefined;
    }, definition)) registered.push(definition.name);
  }
  return () => { for (const name of registered) commands.unregister(name); };
}
