// Best-effort fire-and-forget telemetry for the AOS live map (agenttrail daemon).
export async function emitTrail(event) {
  const body = JSON.stringify(event);
  const ports = process.env.AGENTTRAIL_PORT
    ? [Number(process.env.AGENTTRAIL_PORT)]
    : Array.from({ length: 15 }, (_, i) => 5330 + i);
  await Promise.allSettled(
    ports.map((port) =>
      fetch(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(300),
      }).catch(() => {})
    )
  );
}
