const API_BASE_URL = process.env.AUTH_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";

async function main(): Promise<void> {
  const response = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}/api/keywords/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: "패드립",
      context_type: "game_chat",
      guest_id: `test-guest-${Date.now()}`,
      limit: 3
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`keyword verification failed with ${response.status}: ${JSON.stringify(payload)}`);
  }

  const output = {
    status: response.status,
    runId: payload.run_id,
    headline: payload.verification?.headline,
    lawCount: Array.isArray(payload.matched_laws) ? payload.matched_laws.length : 0,
    precedentCount: Array.isArray(payload.matched_precedents) ? payload.matched_precedents.length : 0,
    guestRemaining: payload.guest_remaining
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
