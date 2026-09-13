import { expect, test } from 'bun:test';
import { Q3ClientNetwork } from '../../../src/app/bootstrap/network/q3-client.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { encodeConnectionlessText } from '../../../src/network/q3/connectionless.ts';

test('native Q3 client reads connectionless print body after the command line', async () => {
  const server = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
  const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
  if (server.address.kind !== 'ipv4') throw new Error('Expected loopback IPv4');
  const prints: string[] = [];
  const client = new Q3ClientNetwork({ transport, remote: server.address, qport: 196, host: {
    identity: { client: createIdentityOwner('q3-print').client(0, 0), seat: null }, downloading: false, userinfo: () => '', attach: () => undefined,
    command: () => { throw new Error('No gameplay command expected'); }, disconnected: () => undefined,
    print: text => { prints.push(text); }, clearActive: async () => undefined, systemInfo: async () => undefined,
    gamestate: async () => undefined, snapshot: () => undefined, downloadSize: size => size,
    download: async () => undefined, mapRestart: () => undefined,
  } });
  try {
    const send = async (bytes: Uint8Array): Promise<void> => {
      const count = prints.length; server.send(transport.address, bytes);
      const deadline = performance.now() + 1000;
      while (prints.length === count && performance.now() < deadline) { await Bun.sleep(1); await client.poll(performance.now()); }
      expect(prints.length).toBe(count + 1);
    };
    await send(encodeConnectionlessText('print\nFirst line\n  second  line\n100%\u00e9'));
    expect(prints.at(-1)).toBe('First line\n  second  line\n100..');
    const body = new TextEncoder().encode('print\nkept\0discarded\n');
    const packet = new Uint8Array(body.length + 4); packet.fill(255, 0, 4); packet.set(body, 4);
    await send(packet); expect(prints.at(-1)).toBe('kept');
    await send(encodeConnectionlessText('print ignored same-line text')); expect(prints.at(-1)).toBe('');
    await send(encodeConnectionlessText('print\n' + 'x'.repeat(1100))); expect(prints.at(-1)).toBe('x'.repeat(1023));
    expect(client.phase).toBe('connecting');
  } finally { client.close(); server.close(); }
});
