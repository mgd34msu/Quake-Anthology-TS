/*
 * One-shot cleanup callbacks retained by an owner until close, unifying the
 * removal-list pattern formerly open-coded across compat bindings. Running
 * the stack snapshots its entries first: callbacks registered while running
 * wait for the next run, exactly as the former splice-then-iterate lists.
 * GPL-2.0-or-later.
 */

export type Cleanup = () => void;

export class CleanupStack {
  private entries: Cleanup[] = [];

  get length(): number { return this.entries.length; }

  add(...cleanups: Cleanup[]): void {
    this.entries.push(...cleanups);
  }

  push(...cleanups: Cleanup[]): void {
    this.entries.push(...cleanups);
  }

  /** Runs callbacks in registration order and empties the stack. */
  runAll(): void {
    const entries = this.entries;
    this.entries = [];
    for (const entry of entries) entry();
  }

  /** Runs callbacks in reverse order without emptying the stack (retained scopes). */
  invokeReverse(): void {
    for (let index = this.entries.length - 1; index >= 0; index--) this.entries[index]?.();
  }

  /** Runs callbacks in reverse registration order and empties the stack. */
  runReverse(): void {
    const entries = this.entries;
    this.entries = [];
    for (let index = entries.length - 1; index >= 0; index--) entries[index]?.();
  }

  clear(): void {
    this.entries = [];
  }
}
