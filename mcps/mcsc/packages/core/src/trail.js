// Best-effort fire-and-forget telemetry for the AOS live map (the agenttrail hub).
// v2: one named hub port. The legacy per-repo range is only tried when
// AGENTTRAIL_LEGACY=1.
export async function emitTrail(event) {
  const body = JSON.stringify(event);
  const hubPort = Number(process.env.AGENTTRAIL_PORT) || 5350;
  const ports = [hubPort];
  if (process.env.AGENTTRAIL_LEGACY === '1') {
    for (let i = 0; i < 15; i += 1) if (5330 + i !== hubPort) ports.push(5330 + i);
  }
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

export const trailHubPort = () => Number(process.env.AGENTTRAIL_PORT) || 5350;