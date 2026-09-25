import type { GuestProcessorState } from "../../guest/core/contracts.ts";
import { captureAbiProcessorState, restoreAbiProcessorState } from "../../guest/abi/runner.ts";
import type { NativeModRegionAuthority } from "./native-mod-region.ts";

export type NativeModInvocationResult<Result> = { readonly kind: "completed"; readonly value: Result } | { readonly kind: "retired" };
interface Scope { current(): boolean; }

/** Retirement ends its source invocation; it is never a fabricated native return value. */
export class NativeModInvocations {
  private readonly scopes: Scope[] = [];
  private readonly retired = new Map<Error, { readonly authority: NativeModRegionAuthority; readonly scope: Scope }>();
  constructor(private readonly state: GuestProcessorState) {}
  run<Result>(current: () => boolean, invoke: () => Result): NativeModInvocationResult<Result> {
    const scope = { current }, before = captureAbiProcessorState(this.state); this.scopes.push(scope);
    try { return { kind: "completed", value: invoke() }; }
    catch (error) {
      const retirement = error instanceof Error ? this.retired.get(error) : undefined;
      if (retirement === undefined || retirement.authority.current()
        || (this.scopes.find(active => !active.current()) ?? retirement.scope) !== scope) throw error;
      this.retired.delete(retirement.authority.error); restoreAbiProcessorState(this.state, before);
      return { kind: "retired" };
    } finally {
      if (this.scopes.pop() !== scope) throw new Error("Native source invocation ownership changed");
      if (this.scopes.length === 0) this.retired.clear();
    }
  }
  guard<Result>(authority: NativeModRegionAuthority, invoke: () => Result): Result {
    const scope = this.scopes.at(-1); if (scope === undefined) throw new Error("Native donor has no owning source invocation");
    this.retired.set(authority.error, { authority, scope }); let retiring = false;
    try { if (!authority.current()) throw authority.error; return invoke(); }
    catch (error) { retiring = error === authority.error && !authority.current(); throw error; }
    finally { if (!retiring) this.retired.delete(authority.error); }
  }
}
