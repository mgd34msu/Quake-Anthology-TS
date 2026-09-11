// SPDX-License-Identifier: GPL-2.0-or-later
export { parseAas, aasPointArea, aasTraceAreas, aasBBoxAreas } from "./aas.ts";
export type { AasAsset, AasAreaCrossing } from "./aas.ts";
export { parseKexNavigation } from "./nav.ts";
export type { KexNavigationAsset } from "./nav.ts";
export { navigationFromAsset, navigationClusters, aasAreaTravelFlags, aasTravelFlag, aasTravelMode, kexTravelMode } from "./graph.ts";
export { constructNavigation } from "./construct.ts";
export type { NavigationConstruction, NavigationConnection } from "./construct.ts";
export { createMovementAdmission, createMovementRouteAdmission } from "./movement.ts";
export type { NavigationPredictionDriver, NavigationPrediction, NavigationPredictionLimits } from "./movement.ts";
export { NavigationRuntime } from "./runtime.ts";
export type { NavigationRouteQuery } from "./runtime.ts";
export { loadNavigation } from "./load.ts";
export type { NavigationLoadOptions, LoadedNavigation } from "./load.ts";
export { NavigationContents } from "./helpers.ts";
export type * from "./types.ts";
