const API_BASE_URL = process.env.AUTH_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";

async function main(): Promise<void> {
  const toolListResponse = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}/tools`);
  const toolListPayload = await toolListResponse.json();
  if (!toolListResponse.ok) {
    throw new Error(`tool list failed with ${toolListResponse.status}: ${JSON.stringify(toolListPayload)}`);
  }

  const toolNames = Array.isArray(toolListPayload.tools)
    ? toolListPayload.tools.map((tool: { name?: unknown }) => String(tool.name ?? ""))
    : [];

  for (const expectedName of [
    "search_law_tool",
    "get_law_detail_tool",
    "search_precedent_tool",
    "get_precedent_detail_tool"
  ]) {
    if (!toolNames.includes(expectedName)) {
      throw new Error(`missing tool ${expectedName}`);
    }
  }

  const searchPrecedentResponse = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}/tools/search_precedent_tool`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: "니 애미",
      context_type: "game_chat",
      limit: 3
    })
  });
  const searchPrecedentPayload = await searchPrecedentResponse.json();
  if (!searchPrecedentResponse.ok) {
    throw new Error(
      `search_precedent_tool failed with ${searchPrecedentResponse.status}: ${JSON.stringify(searchPrecedentPayload)}`
    );
  }

  const firstPrecedent = Array.isArray(searchPrecedentPayload.items) ? searchPrecedentPayload.items[0] : null;
  if (!firstPrecedent?.id) {
    throw new Error("search_precedent_tool should return at least one item");
  }

  const detailResponse = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}/tools/get_precedent_detail_tool`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      precedent_id: firstPrecedent.id
    })
  });
  const detailPayload = await detailResponse.json();
  if (!detailResponse.ok) {
    throw new Error(`get_precedent_detail_tool failed with ${detailResponse.status}: ${JSON.stringify(detailPayload)}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        toolCount: toolNames.length,
        firstPrecedentId: firstPrecedent.id,
        firstPrecedentTitle: firstPrecedent.title,
        detailTitle: detailPayload.item?.title ?? null
      },
      null,
      2
    )}\n`
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
