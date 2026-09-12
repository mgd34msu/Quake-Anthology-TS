/** SV_CheckWaterTransition preserves source initialization and empty waterlevel values. */
export function q1WaterTransition<T extends number>(previousType: number, contents: T): {
  readonly waterType: T | -1; readonly waterLevel: number; readonly splash: boolean;
} {
  if (previousType === 0) return { waterType: contents, waterLevel: 1, splash: false };
  if (contents <= -3) return { waterType: contents, waterLevel: 1, splash: previousType === -1 };
  return { waterType: -1, waterLevel: contents, splash: previousType !== -1 };
}
