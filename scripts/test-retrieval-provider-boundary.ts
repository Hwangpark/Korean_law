import assert from "node:assert/strict";
import { createRetrievalAdapter, type RetrievalLiveProvider } from "../apps/api/src/retrieval/mcp-adapter.js";
import { buildKeywordQueryPlan } from "../apps/api/src/retrieval/planner.js";

const plan = buildKeywordQueryPlan("허위사실을 단톡방에 유포했습니다", "messenger");

async function testLiveModeWithoutInjectedProviderUsesFixtures() {
  const adapter = createRetrievalAdapter("live");

  assert.equal(adapter.providerInfo.requested_mode, "live");
  assert.equal(adapter.providerInfo.provider, "mock");
  assert.equal(adapter.providerInfo.source, "live_fallback");
  assert.equal(adapter.providerInfo.live_enabled, false);

  const laws = await adapter.searchLaws(plan, 2);
  const precedents = await adapter.searchPrecedents(plan, 2);

  assert.ok(laws.length > 0, "live fallback should keep deterministic law fixture results");
  assert.ok(precedents.length > 0, "live fallback should keep deterministic precedent fixture results");
  assert.equal(laws[0]?.retrieval_evidence?.provider, "mock");
  assert.equal(precedents[0]?.retrieval_evidence?.provider, "mock");
}

async function testInjectedLiveProviderIsNormalizedToFixtureShape() {
  const liveProvider: RetrievalLiveProvider = {
    async searchLaws({ fixtureSeeds }) {
      return [
        {
          ...fixtureSeeds[0],
          law_name: "정보통신망 이용촉진 및 정보보호 등에 관한 법률",
          article_no: "제70조",
          article_title: "벌칙",
          content: "사람을 비방할 목적으로 정보통신망을 통하여 공공연하게 거짓의 사실을 드러낸 경우를 다룬다.",
          penalty: "공식 조문 확인 필요",
          url: "https://www.law.go.kr/"
        }
      ];
    },
    async searchPrecedents({ fixtureSeeds }) {
      return [
        {
          ...fixtureSeeds[0],
          case_no: "live-provider-boundary-test",
          court: "테스트 법원",
          date: "2026-01-01",
          summary: "단체 대화방에서 허위사실을 게시한 사안",
          verdict: "테스트 판결",
          sentence: "테스트",
          key_reasoning: "공연성과 허위사실 적시 여부가 쟁점이다.",
          url: "https://www.law.go.kr/",
          similarity_score: 0.99
        }
      ];
    }
  };
  const adapter = createRetrievalAdapter({ providerMode: "live", liveProvider });

  assert.equal(adapter.providerInfo.provider, "live");
  assert.equal(adapter.providerInfo.source, "live");
  assert.equal(adapter.providerInfo.live_enabled, true);

  const laws = await adapter.searchLaws(plan, 1);
  const precedents = await adapter.searchPrecedents(plan, 1);

  assert.equal(laws[0]?.retrieval_evidence?.provider, "live");
  assert.equal(precedents[0]?.retrieval_evidence?.provider, "live");
  assert.ok(laws[0]?.retrieval_evidence?.snippet?.text);
  assert.ok(precedents[0]?.retrieval_evidence?.snippet?.text);
}

async function testHybridRankingReordersLiveLawCandidates() {
  const networkPlan = buildKeywordQueryPlan("정보통신망으로 허위사실을 퍼뜨려 명예를 훼손했습니다", "community");
  const liveProvider: RetrievalLiveProvider = {
    async searchLaws() {
      return [
        {
          law_name: "형법",
          article_no: "제307조",
          article_title: "명예훼손",
          content: "공연히 사실 또는 허위사실을 적시하여 사람의 명예를 훼손한 경우를 다룬다.",
          penalty: "2년 이하 징역 또는 500만원 이하 벌금",
          url: "https://www.law.go.kr/",
          topics: ["명예훼손"],
          queries: ["명예훼손", "허위사실 적시"]
        },
        {
          law_name: "정보통신망법",
          article_no: "제70조",
          article_title: "벌칙",
          content: "정보통신망을 이용하여 사람을 비방할 목적으로 사실 또는 허위사실을 드러내어 명예를 훼손한 경우를 다룬다.",
          penalty: "3년 이하 징역 또는 3천만원 이하 벌금",
          url: "https://www.law.go.kr/",
          topics: ["명예훼손"],
          queries: ["명예훼손", "허위사실 적시", "정보통신망"]
        }
      ];
    },
    async searchPrecedents({ fixtureSeeds }) {
      return fixtureSeeds;
    }
  };

  const adapter = createRetrievalAdapter({ providerMode: "live", liveProvider });
  const laws = await adapter.searchLaws(networkPlan, 2);

  assert.equal(laws[0]?.law_name, "정보통신망법");
  assert.equal(laws[0]?.article_no, "제70조");
}

await testLiveModeWithoutInjectedProviderUsesFixtures();
await testInjectedLiveProviderIsNormalizedToFixtureShape();
await testHybridRankingReordersLiveLawCandidates();

console.log("retrieval provider boundary tests passed");
