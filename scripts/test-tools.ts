import { buildReferenceSeeds } from "../apps/api/src/analysis/references.js";
import { createRetrievalTools, listTools } from "../apps/api/src/retrieval/tools.js";

const API_BASE_URL = process.env.AUTH_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";

type ReferenceItem = {
  id: string;
  kind: "law" | "precedent";
  href: string;
  title: string;
  subtitle: string;
  summary: string;
  details: string;
  url: string;
  articleNo?: string | null;
  caseNo?: string | null;
  court?: string | null;
  verdict?: string | null;
  penalty?: string | null;
  similarityScore?: number | null;
  sourceMode: string;
  officialSourceLabel?: string | null;
  authorityTier?: string;
  referenceDate?: string | null;
  freshnessStatus?: string;
  keywords: string[];
  caseId: number | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
};

function createReferenceLibraryStub() {
  const items = new Map<string, ReferenceItem>();

  return {
    async saveReferenceLibrary(input: { providerMode: string; result: Record<string, unknown> }) {
      const seeds = buildReferenceSeeds(input.result, input.providerMode);
      const records = seeds.map((seed) => ({
        id: seed.sourceKey,
        kind: seed.kind,
        href: `/api/references/${seed.kind}/${encodeURIComponent(seed.sourceKey)}`,
        title: seed.title,
        subtitle: seed.subtitle,
        summary: seed.summary,
        details: seed.details,
        url: seed.url,
        articleNo: seed.articleNo,
        caseNo: seed.caseNo,
        court: seed.court,
        verdict: seed.verdict,
        penalty: seed.penalty,
        similarityScore: seed.similarityScore,
        sourceMode: seed.sourceMode,
        officialSourceLabel: seed.officialSourceLabel,
        authorityTier: seed.authorityTier,
        referenceDate: seed.referenceDate,
        freshnessStatus: seed.freshnessStatus,
        keywords: seed.keywords,
        caseId: null,
        runId: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }));

      for (const record of records) {
        items.set(record.id, record);
      }

      return records;
    },
    async getReferenceByKindAndId(_kind: "law" | "precedent", id: string) {
      return items.get(id) ?? null;
    }
  };
}

function createAuthServiceStub() {
  return {
    async verifyToken() {
      return { sub: "1" };
    }
  };
}

function assertToolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) {
    throw new Error("tool list payload must include an array of tools.");
  }

  const names = tools.map((tool: { name?: unknown }) => String(tool?.name ?? ""));
  for (const expectedName of [
    "search_law_tool",
    "get_law_detail_tool",
    "search_precedent_tool",
    "get_precedent_detail_tool"
  ]) {
    if (!names.includes(expectedName)) {
      throw new Error(`missing tool ${expectedName}`);
    }
  }

  return names;
}

function getItems(payload: Record<string, unknown>): unknown[] {
  return Array.isArray(payload.items) ? payload.items : [];
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.message.includes("fetch failed")) {
    return true;
  }
  const cause = error.cause as { code?: string } | undefined;
  return cause?.code === "ECONNREFUSED" || cause?.code === "ENOTFOUND";
}

async function fetchJson(path: string, init?: RequestInit): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}${path}`, init);
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    payload
  };
}

async function runInternalChecks(): Promise<Record<string, unknown>> {
  const tools = createRetrievalTools({
    providerMode: "mock",
    authService: createAuthServiceStub() as never,
    analysisStore: createReferenceLibraryStub() as never
  });

  const toolNames = assertToolNames(listTools().tools);
  const internalNames = assertToolNames(tools.listTools().tools);
  if (toolNames.join(",") !== internalNames.join(",")) {
    throw new Error("internal tool list does not match listTools() contract.");
  }

  const profileContext = {
    birthDate: "2010-01-01",
    nationality: "foreign",
    ageYears: 16,
    ageBand: "child",
    isMinor: true,
    legalNotes: ["미성년자 검토 필요"]
  };

  const lawSearch = await tools.searchLawTool({
    query: "니 애미",
    context_type: "game_chat",
    limit: 3,
    profile_context: profileContext
  });
  const lawItems = getItems(lawSearch as unknown as Record<string, unknown>);
  if (lawSearch.count !== lawItems.length || lawItems.length === 0) {
    throw new Error("internal searchLawTool contract failed.");
  }

  const precedentSearch = await tools.searchPrecedentTool({
    query: "니 애미",
    context_type: "game_chat",
    limit: 3,
    profile_context: profileContext
  });
  const precedentItems = getItems(precedentSearch as unknown as Record<string, unknown>);
  if (precedentSearch.count !== precedentItems.length || precedentItems.length === 0) {
    throw new Error("internal searchPrecedentTool contract failed.");
  }

  const firstLaw = lawItems[0] as { id?: unknown; title?: unknown };
  const firstPrecedent = precedentItems[0] as { id?: unknown; title?: unknown };
  if (!firstLaw?.id || !firstPrecedent?.id) {
    throw new Error("internal tool searches must return ids.");
  }

  const lawDetail = await tools.getLawDetailTool({ law_id: firstLaw.id });
  const precedentDetail = await tools.getPrecedentDetailTool({ precedent_id: firstPrecedent.id });
  if (!lawDetail.item?.id || !precedentDetail.item?.id) {
    throw new Error("internal detail tool contract failed.");
  }
  if (lawDetail.item.id !== firstLaw.id || precedentDetail.item.id !== firstPrecedent.id) {
    throw new Error("internal detail tools returned mismatched ids.");
  }

  return {
    mode: "internal",
    toolCount: internalNames.length,
    lawId: String(firstLaw.id),
    precedentId: String(firstPrecedent.id),
    lawDetailTitle: lawDetail.item.title ?? null,
    precedentDetailTitle: precedentDetail.item.title ?? null
  };
}

async function runHttpChecks(): Promise<Record<string, unknown>> {
  const listResponse = await fetchJson("/tools");
  if (listResponse.status !== 200) {
    throw new Error(`tool list failed with ${listResponse.status}: ${JSON.stringify(listResponse.payload)}`);
  }
  const toolNames = assertToolNames(listResponse.payload.tools);

  const aliasResponse = await fetchJson("/api/tools");
  if (aliasResponse.status !== 200) {
    throw new Error(`alias tool list failed with ${aliasResponse.status}: ${JSON.stringify(aliasResponse.payload)}`);
  }
  assertToolNames(aliasResponse.payload.tools);

  const searchLaw = await fetchJson("/tools/search_law_tool", {
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
  if (searchLaw.status !== 200) {
    throw new Error(`search_law_tool failed with ${searchLaw.status}: ${JSON.stringify(searchLaw.payload)}`);
  }
  const lawItems = getItems(searchLaw.payload);
  if (lawItems.length === 0) {
    throw new Error("search_law_tool should return at least one item.");
  }
  const firstLaw = lawItems[0] as { id?: unknown; title?: unknown };
  if (!firstLaw?.id) {
    throw new Error("search_law_tool should return a law item id.");
  }

  const searchPrecedent = await fetchJson("/tools/search_precedent_tool", {
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
  if (searchPrecedent.status !== 200) {
    throw new Error(
      `search_precedent_tool failed with ${searchPrecedent.status}: ${JSON.stringify(searchPrecedent.payload)}`
    );
  }
  const precedentItems = getItems(searchPrecedent.payload);
  if (precedentItems.length === 0) {
    throw new Error("search_precedent_tool should return at least one item");
  }
  const firstPrecedent = precedentItems[0] as { id?: unknown; title?: unknown };
  if (!firstPrecedent?.id) {
    throw new Error("search_precedent_tool should return a precedent item id");
  }

  const lawDetail = await fetchJson("/tools/get_law_detail_tool", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      law_id: firstLaw.id
    })
  });
  if (lawDetail.status !== 200) {
    throw new Error(`get_law_detail_tool failed with ${lawDetail.status}: ${JSON.stringify(lawDetail.payload)}`);
  }

  const detailResponse = await fetchJson("/tools/get_precedent_detail_tool", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      precedent_id: firstPrecedent.id
    })
  });
  if (detailResponse.status !== 200) {
    throw new Error(
      `get_precedent_detail_tool failed with ${detailResponse.status}: ${JSON.stringify(detailResponse.payload)}`
    );
  }

  return {
    mode: "http",
    toolCount: toolNames.length,
    lawId: String(firstLaw.id),
    precedentId: String(firstPrecedent.id),
    lawDetailTitle: ((lawDetail.payload.item as { title?: unknown } | undefined)?.title ?? null),
    precedentDetailTitle: ((detailResponse.payload.item as { title?: unknown } | undefined)?.title ?? null)
  };
}

async function main(): Promise<void> {
  const internalSummary = await runInternalChecks();

  try {
    const httpSummary = await runHttpChecks();
    process.stdout.write(`${JSON.stringify({ ...internalSummary, ...httpSummary }, null, 2)}\n`);
    return;
  } catch (error) {
    if (!isConnectionFailure(error)) {
      throw error;
    }
  }

  process.stdout.write(`${JSON.stringify(internalSummary, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
