import { realpath } from "node:fs/promises";

export interface GitState {
  /** Full HEAD commit id, or null when the directory is not a git work tree. */
  readonly commit: string | null;
  /** True when tracked files differ from HEAD or untracked, non-ignored files exist. Null outside a work tree. */
  readonly dirty: boolean | null;
}

async function git(directory: string, args: readonly string[]): Promise<{ readonly code: number; readonly output: string }> {
  const child = Bun.spawn(["git", "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, output };
}

export async function gitState(directory: string): Promise<GitState> {
  const top = await git(directory, ["rev-parse", "--show-toplevel"]).catch(() => undefined);
  if (top === undefined || top.code !== 0) return { commit: null, dirty: null };
  // A work tree that merely contains the directory (for example a temporary directory inside another repository) is not this project's.
  const [real, root] = await Promise.all([realpath(directory), realpath(top.output.trim())]);
  if (real !== root) return { commit: null, dirty: null };
  const [head, status] = await Promise.all([git(directory, ["rev-parse", "HEAD"]), git(directory, ["status", "--porcelain", "--untracked-files=all"])]);
  if (head.code !== 0 || status.code !== 0) return { commit: null, dirty: null };
  return { commit: head.output.trim(), dirty: status.output.trim() !== "" };
}
