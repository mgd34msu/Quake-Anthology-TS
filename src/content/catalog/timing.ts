import type { GameFamily, ProviderReference, ProviderTiming } from "../../contracts/content.ts";

export function nativeProviderTiming(provider: ProviderReference, family: GameFamily, rerelease: boolean): ProviderTiming {
  return { provider: provider.provider,
    numeric: { id: `${family}:binary32`, arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "checked-c-truncation", integerOverflow: "wrap32" },
    clock: family === "q1" ? { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null }
      : family === "q2" ? rerelease ? { kind: "q2-rerelease", frameMilliseconds: 25, preparation: "before-frame" } : { kind: "q2-classic", frameMilliseconds: 100 }
      : { kind: "q3", serverFrameMilliseconds: 50, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 } };
}
