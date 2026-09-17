import type { NetworkAddress } from "../../network/common/endpoint.ts";

export type PlayerServiceStatus =
  | { readonly kind: "unconfigured"; readonly service: "authorization" | "rankings"; readonly reason: string }
  | { readonly kind: "configured"; readonly service: "authorization" | "rankings"; readonly endpoint: NetworkAddress }
  | { readonly kind: "unavailable"; readonly service: "authorization" | "rankings"; readonly endpoint: NetworkAddress; readonly reason: string };

export function playerServiceStatus(service: "authorization" | "rankings", endpoint: NetworkAddress | null): PlayerServiceStatus {
  return endpoint === null ? { kind: "unconfigured", service, reason: `${service} requires an explicitly configured compatible endpoint; local records are not native service submission.` }
    : { kind: "configured", service, endpoint };
}
