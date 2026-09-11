export async function unusedPort(): Promise<number> {
  const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
  const port = socket.port;
  socket.close();
  return port;
}

export async function query(port: number, request: string) {
  const response: { hex: string; text: string; from: string; port: number; elapsedMs: number }[] = [];
  const start = performance.now();
  const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: {
    data(_socket, bytes, responsePort, address) {
      response.push({ hex: Buffer.from(bytes).toString("hex"), text: Buffer.from(bytes).toString("latin1"),
        from: address, port: responsePort, elapsedMs: performance.now() - start });
    },
  } });
  const bytes = Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from(request + "\n", "ascii")]);
  try {
    socket.send(bytes, port, "127.0.0.1");
    while (response.length === 0 && performance.now() - start < 2000) await Bun.sleep(10);
    return { destination: `127.0.0.1:${port}`, request, sentHex: bytes.toString("hex"), response };
  } finally { socket.close(); }
}
