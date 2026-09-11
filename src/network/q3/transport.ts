import type { Q3Address } from "./admission.ts";
import type { ChannelDelivery } from "./netchan.ts";
import type { SourceMessageState } from "./message.ts";
import type { DatagramTransport } from "../common/transport.ts";

/** Uses the shared transport, including distinct loopback endpoints for local seats. */
export function q3ChannelDelivery<Address extends Q3Address>(transport: Pick<DatagramTransport<Address>, "send">, remote: () => Address,
  sourceState: SourceMessageState, trace: (text: string) => void): ChannelDelivery {
  return { sourceState, send: packet => { transport.send(remote(), packet); }, trace: text => { trace(text); } };
}
