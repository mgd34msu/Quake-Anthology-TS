import type { CommandContext } from "../contracts/common.ts";
import type { CommandBuffer } from "../core/commands/index.ts";
import type { LlmRequestInput } from "../llm/request.ts";
import { llmConsoleCatalog, llmExecInstructions, validateLlmBatch } from "./llm-batch.ts";

export interface LlmCommandRequester {
  request(input: LlmRequestInput): Promise<string>;
}

export function registerLlmCommands(commands: CommandBuffer, print: (text: string, source: CommandContext) => void, requester?: LlmCommandRequester): () => void {
  const registered: string[] = [];
  const pending = new Map<string, AbortController>();
  let disposed = false;
  for (const definition of [
    { name: "llm_ask", usage: "llm_ask <question>", summary: "Ask the configured LLM and print its answer in this console.", examples: ['llm_ask "How do I change brightness?"'] },
    { name: "llm_exec", usage: "llm_exec <request>", summary: "Ask the configured LLM for console commands, validate the whole batch, then print and execute it in your context.", examples: ['llm_exec "Set brightness to the default"'] },
  ]) {
    if (commands.register(definition.name, invocation => {
      const source = invocation.source, origin = source.origin, prompt = invocation.args.join(" ").trim();
      if (!invocation.direct || origin.kind !== "local-seat" && origin.kind !== "local-console") {
        print("LLM commands require direct input from a local player console. Scripts, modules, and servers cannot start requests.\n", source); return;
      }
      if (prompt.length === 0) { print(`Usage: ${definition.usage}\nQuote text containing semicolons.\n`, source); return; }
      if (requester === undefined) { print("Configure a provider and model in Options > LLM before sending a request.\n", source); return; }
      if (prompt.length > 4096) { print("LLM prompt exceeds 4096 characters. Ask a shorter question.\n", source); return; }
      const key = origin.kind === "local-seat" ? `seat:${origin.seat.index}` : "console";
      if (pending.has(key)) { print("An LLM request is already running in this console.\n", source); return; }
      const controller = new AbortController();
      pending.set(key, controller);
      const timer = setTimeout(() => {
        controller.abort();
        if (!disposed && pending.get(key) === controller) {
          pending.delete(key); print("LLM request timed out. Try again.\n", source);
        }
      }, 120000);
      controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      const current = (): boolean => !disposed && !controller.signal.aborted && pending.get(key) === controller;
      const run = async (): Promise<void> => {
        try {
          const instructions = definition.name === "llm_exec" ? llmExecInstructions(commands, source, prompt)
            : `Answer the user's question concisely, including general questions unrelated to the game. Your answer is displayed in a plain-text game console without Markdown rendering. Use short paragraphs and put command or code examples on their own lines. Do not use Markdown code fences, language headers, inline backticks, headings, or tables. Preserve meaningful code syntax and indentation.\nFor advice about this running engine, use only command and setting names from the registered catalog below. Follow their documented usage and allowed values. Do not assume that commands from another Quake engine exist here. If a requested setting or command is absent, say it is not registered; do not present a guessed name or a set command creating an unregistered variable as a working solution. If usage is undocumented, say so instead of inventing arguments. The catalog describes available commands, not current values or proof that an action is permitted. You have no console history, current settings, files, or game state. You only answer questions; do not claim to have executed commands.\n${llmConsoleCatalog(commands, source, prompt)}`;
          print("LLM request started.\n", source);
          const answer = await requester.request({ prompt, instructions, signal: controller.signal });
          if (!current()) return;
          if (definition.name === "llm_ask") { print(`${answer}\n`, source); return; }
          const batch = validateLlmBatch(answer, commands, source);
          if (!current()) return;
          print(`${batch.join("; ")}\n`, source);
          commands.executeBatch(batch.join("\n") + "\n", source, controller.signal);
        } catch (error) {
          if (current()) print(`LLM request failed: ${error instanceof Error ? error.message : "Unknown error"}\n`, source);
        } finally {
          clearTimeout(timer);
          if (pending.get(key) === controller) pending.delete(key);
        }
      };
      void run();
      return undefined;
    }, definition)) registered.push(definition.name);
  }
  return () => {
    disposed = true;
    for (const controller of pending.values()) controller.abort();
    pending.clear();
    for (const name of registered) commands.unregister(name);
  };
}
