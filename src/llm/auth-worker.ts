import { parentPort, workerData } from "node:worker_threads";

/** Loopback OAuth callback served off the game thread, so a blocked frame loop cannot starve it. */
function fields(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid subscription callback worker data.");
  return Object.fromEntries(Object.entries(value));
}

if (parentPort === null) throw new Error("Subscription callback worker requires a parent port.");
const port = parentPort;
const data = fields(workerData);
const requestedPort = data["port"], expectedState = data["state"];
if (typeof requestedPort !== "number" || !Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535
  || typeof expectedState !== "string" || expectedState === "") throw new Error("Invalid subscription callback worker data.");

let server: Bun.Server<undefined>;
try {
  server = Bun.serve({ hostname: "127.0.0.1", port: requestedPort,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/auth/callback") return new Response("Not found", { status: 404 });
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (url.searchParams.get("state") !== expectedState) {
        port.postMessage({ kind: "state-mismatch" });
        return new Response("Sign-in failed. State mismatch.", { status: 400 });
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.has("error") || !code) {
        port.postMessage({ kind: "denied" });
        return new Response("Sign-in was not authorized.", { status: 400 });
      }
      port.postMessage({ kind: "code", code });
      return new Response("Authorization received. You can return to the game.", { headers: { Connection: "close" } });
    },
  });
} catch {
  port.postMessage({ kind: "listen-error" });
  throw new Error("Subscription callback listener could not open its port.");
}
port.postMessage({ kind: "ready", port: server.port });
let serverStopped = false;
port.on("message", (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("kind" in value) || value.kind !== "stop") return;
  const force = "force" in value && value.force === true;
  void (async () => {
    if (!serverStopped) { serverStopped = true; await server.stop(force); }
    port.postMessage({ kind: "stopped" });
  })();
});
