import { expect, test } from "bun:test";
import { q3InfoValue, q3PeerUserinfo } from "../../../src/network/q3/admission.ts";

// GAPSIM-011: a userinfo update cannot claim the loopback address.
test("userinfo updates take their ip from the transport address", () => {
  const forged = "\\name\\x\\ip\\localhost";
  const remote = q3PeerUserinfo(forged, { kind: "ipv4", host: [203, 0, 113, 9], port: 27960 }, () => undefined);
  expect(q3InfoValue(remote, "ip")).toBe("203.0.113.9:27960");
  expect(q3InfoValue(remote, "name")).toBe("x");
  expect(q3InfoValue(q3PeerUserinfo("\\name\\x", { kind: "loopback", id: "local" }, () => undefined), "ip")).toBe("localhost");
});
