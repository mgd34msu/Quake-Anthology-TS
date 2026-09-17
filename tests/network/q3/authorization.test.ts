import { expect, test } from 'bun:test';
import { Q3ServerAuthorization } from '../../../src/network/q3/authorization.ts';
import { Q3ServerAdmission } from '../../../src/network/q3/admission.ts';
import type { Q3Address, Q3Challenge, Q3OutgoingDatagram } from '../../../src/network/q3/admission.ts';
import type { Ipv4Address } from '../../../src/network/common/endpoint.ts';
import { decodeConnectionless, encodeConnectionlessText } from '../../../src/network/q3/connectionless.ts';

const authority: Ipv4Address = { kind: 'ipv4', host: [192, 0, 2, 1], port: 27952 };
const client: Q3Address = { kind: 'ipv4', host: [198, 51, 100, 2], port: 30000 };

test('Q3 WAN challenge uses the native authorization exchange and rejects a forged authority', async () => {
    const sent: Q3OutgoingDatagram[] = [];
    let lookups = 0;
    const send = (to: Q3Address, payload: Uint8Array) => { sent.push({ to, payload }); };
    const authorization = new Q3ServerAuthorization({
        async resolve() { lookups++; return authority; }, enabled: () => true,
        gameDirectory: () => 'missionpack', strictAuth: () => '1', send, print() {},
    });
    const admission = new Q3ServerAdmission({
        enabled: () => true, slots: () => [], privateClients: () => 0, privatePassword: () => '',
        reconnectLimitSeconds: () => 3, minimumPing: () => 0, maximumPing: () => 0,
        authorizeAddress: () => authorization.address, demoRestricted: () => false,
        isLan: () => false, random: () => 123, authorize: challenge => authorization.request(challenge),
        send, admit: () => null, dropBot() {}, print() {}, query() {},
    });
    await admission.receive(client, encodeConnectionlessText('getchallenge'), 100);
    expect(sent).toHaveLength(1); expect(sent[0]?.to).toEqual(authority);
    const request = sent[0]; if (request === undefined) throw new Error('Missing authority request');
    const decoded = decodeConnectionless(request.payload, 'server');
    expect(decoded.command).toBe('getIpAuthorize');
    expect(decoded.arguments.slice(1)).toEqual(['198.51.100.2', 'missionpack', '0', '1']);
    const nonce = decoded.arguments[0]; if (nonce === undefined) throw new Error('Missing challenge');
    await admission.receive(client, encodeConnectionlessText(`ipAuthorize ${nonce} accept`), 110);
    expect(sent).toHaveLength(1);
    await admission.receive(authority, encodeConnectionlessText(`ipAuthorize ${nonce} accept`), 120);
    expect(sent).toHaveLength(2); expect(sent[1]?.to).toEqual(client);
    const response = sent[1]; if (response === undefined) throw new Error('Missing challenge response');
    expect(decodeConnectionless(response.payload, 'client').command).toBe('challengeResponse');
    await admission.receive(client, encodeConnectionlessText('getchallenge'), 130);
    expect(lookups).toBe(1);
});

test('Q3 authorization cannot publish after its challenge or server retires during lookup', async () => {
    let resolveLookup: ((address: Ipv4Address) => void) | undefined;
    const lookup = new Promise<Ipv4Address>(resolve => { resolveLookup = resolve; });
    const sent: Q3OutgoingDatagram[] = [];
    let enabled = true;
    const owner = new Q3ServerAuthorization({ resolve: () => lookup, enabled: () => enabled,
        gameDirectory: () => '', strictAuth: () => '1', send(to, payload) { sent.push({ to, payload }); }, print() {}, });
    const challenge: Q3Challenge = { address: client, challenge: 17, time: 0, firstTime: 0, pingTime: 0, connected: false };
    const pending = owner.request(challenge);
    challenge.challenge = 18;
    if (resolveLookup === undefined) throw new Error('Missing lookup continuation');
    resolveLookup(authority); await pending;
    expect(sent).toHaveLength(0);
    enabled = false; await owner.request(challenge);
    expect(sent).toHaveLength(0);
});
