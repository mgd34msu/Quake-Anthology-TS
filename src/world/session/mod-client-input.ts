import type { ModClientInputBinding, ModClientInputOutput } from "../../contracts/mod-callbacks.ts";
import type { ModClientApplication, ModClientServices } from "./mod-clients.ts";

interface Operations<Call, Output> {
  open(application: ModClientApplication): () => void;
  invoke(call: Call, application: ModClientApplication): void;
  output?(outputs: readonly Output[], application: ModClientApplication, run: () => void): readonly ModClientInputOutput[];
}
interface Scope { cleanup: (() => void) | null; opening: boolean; retired: boolean; }

export function subscribeModClientInput<Call, Output = never>(services: ModClientServices, bindings: readonly ModClientInputBinding<Call, Output>[], operations: Operations<Call, Output>): () => undefined {
  if (bindings.length === 0) return () => undefined;
  const active = new Map<ModClientApplication, Scope>(), scopes: Scope[] = [];
  const drain = (): void => {
    const errors: unknown[] = [];
    while (scopes.length !== 0) {
      const scope = scopes.at(-1);
      if (scope === undefined || scope.opening || !scope.retired) break;
      scopes.pop();
      try { scope.cleanup?.(); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Component input cleanup failed");
  };
  const live = (application: ModClientApplication): boolean => services.actor(application.identity.client)?.equals(application.identity.actor) === true
    && services.forActor(application.identity.actor)?.equals(application.identity.client) === true;
  const unsubscribe = services.subscribeApplication(event => {
    const application = event.application;
    if (event.phase === "before") {
      if (!live(application) || !bindings.some(binding => binding.scope === application.scope)) return undefined;
      const scope: Scope = { cleanup: null, opening: true, retired: false };
      active.set(application, scope); scopes.push(scope);
      const errors: unknown[] = [];
      try { scope.cleanup = operations.open(application); }
      catch (error) { active.delete(application); scope.retired = true; errors.push(error); }
      scope.opening = false;
      try { drain(); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Component input opening and cleanup failed");
    }
    const scope = active.get(application);
    if (scope === undefined) return undefined;
    const errors: unknown[] = [];
    try {
      for (const binding of bindings) if ((event.phase === "before" || event.outcome === "completed")
        && binding.scope === application.scope && binding.phase === event.phase) {
        const run = (): void => { for (const call of binding.calls) {
          if (!active.has(application) || !live(application)) break;
          operations.invoke(call, application);
        } };
        if (event.phase === "before" && binding.phase === "before" && binding.outputs !== undefined) {
          if (operations.output === undefined) throw new Error("Source input output adapter is unavailable");
          const outputs = operations.output(binding.outputs, application, run);
          if (active.has(application) && live(application)) for (const output of outputs) event.output(output);
        } else run();
      }
    } catch (error) { errors.push(error); }
    if (event.phase === "after" && active.delete(application)) {
      scope.retired = true;
      try { drain(); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Component input callback and cleanup failed");
    return undefined;
  });
  return () => {
    unsubscribe();
    for (const scope of active.values()) scope.retired = true;
    active.clear(); drain();
    return undefined;
  };
}
