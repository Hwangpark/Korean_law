# MCP-First Retrieval Runtime

이 문서는 retrieval을 agent 내부 로직이 아니라 **tool/runtime 중심**으로 유지하는 이유와 provider 경계를 정의한다.

핵심 원칙은 간단하다.

- 검색 전략은 runtime tool layer에서 만든다.
- law / precedent agent는 thin wrapper로 둔다.
- provider 교체는 adapter seam에서만 처리한다.
- mock-first가 기본이며, live provider는 명시적으로 주입될 때만 사용한다.

## 1. MCP-first 의미

retrieval은 아래 요구를 동시에 만족해야 한다.

- broad query + precise query fan-out
- law / precedent 병렬 실행
- mock / live provider 교체
- preview / trace 생성
- reference library 저장
- evidence pack 생성

이 로직이 agent별로 흩어지면 provider 분기와 trace 조립이 중복된다. 따라서 retrieval 핵심은 아래 계층에 둔다.

- `planner.ts`
- `tools.ts`
- `mcp-adapter.ts`
- `verification.ts`

## 2. 현재 흐름

1. `Classifier Agent`가 signal detection + guided extraction 결과를 만든다.
2. `planner.ts`가 broad/precise query bucket을 만든다.
3. `tools.ts`가 runtime entrypoint 역할을 한다.
4. `mcp-adapter.ts`가 provider boundary를 감싼다.
5. `verification.ts`가 snippet/rerank/evidence card를 만든다.
6. `Law Search Agent` / `Precedent Search Agent`는 결과를 얇게 래핑한다.

## 3. planner 책임

planner는 단순 키워드 배열이 아니라 **retrieval execution plan**을 만든다.

- `candidateIssues`
- `broadLawQueries`
- `preciseLawQueries`
- `broadPrecedentQueries`
- `precisePrecedentQueries`
- `lawQueryRefs`
- `precedentQueryRefs`
- `warnings`
- `scopeFlags`

## 4. tools runtime 책임

`tools.ts`는 아래를 담당한다.

- query plan 입력
- adapter 호출
- preview 조합
- trace 조합
- reference library materialize
- provider source를 trace / preview / reference 저장 경계에 반영

agent는 provider가 fixture인지 live인지 직접 판단하지 않는다.

## 5. adapter 책임

`mcp-adapter.ts`는 provider 전환 지점이다.

보장해야 할 것:

- provider를 바꿔도 `LawDocumentRecord` / `PrecedentDocumentRecord` shape는 유지한다.
- `retrieval_evidence`에는 `reference_key`, `matched_queries`, `matched_issue_types`, `snippet`을 항상 붙인다.
- live provider가 결과를 일부 필드만 돌려도 adapter가 sanitize/normalize한다.
- live provider가 주입되지 않았으면 네트워크를 호출하지 않고 fixture fallback을 쓴다.

## 6. Provider Source 계약

adapter는 `providerInfo`를 가진다.

```ts
{
  requested_mode: string;
  provider: string;
  source: "fixture" | "live" | "live_fallback";
  live_enabled: boolean;
  fallback_reason?: string;
}
```

source 의미:

- `fixture`: mock-first fixture provider.
- `live`: 명시적으로 주입된 live provider를 사용.
- `live_fallback`: live mode가 요청됐지만 live provider가 주입되지 않아 fixture로 대체.

중요:

- `LAW_PROVIDER=live` 자체가 네트워크 호출을 의미하지 않는다.
- 네트워크 호출은 `RetrievalLiveProvider`가 명시적으로 주입될 때만 가능하다.
- default runtime은 mock-first다.

## 7. Live Provider Plug-in Seam

향후 law.go.kr 연동은 아래 인터페이스를 구현해서 adapter에 주입한다.

```ts
interface RetrievalLiveProvider {
  searchLaws(input: {
    plan: KeywordQueryPlan;
    limit: number;
    fixtureSeeds: LawDocumentRecord[];
  }): Promise<Array<Partial<LawDocumentRecord>>>;

  searchPrecedents(input: {
    plan: KeywordQueryPlan;
    limit: number;
    fixtureSeeds: PrecedentDocumentRecord[];
  }): Promise<Array<Partial<PrecedentDocumentRecord>>>;
}
```

adapter는 live 결과를 그대로 노출하지 않고 fixture와 같은 public contract로 normalize한다.

## 8. preview / trace 분리

### preview

- UI 요약용
- top issue / top law / top precedent 중심
- provider source에 따른 disclaimer 포함

### trace

- 디버그와 replay용
- tool, provider, duration, input/output ref 포함
- `provider_source=fixture|live|live_fallback`을 reason에 남긴다.

## 9. 이 구조의 이점

- mock-first 개발 원칙이 유지된다.
- live provider 준비를 하면서도 기본 네트워크 호출이 생기지 않는다.
- fixture shape와 live shape가 adapter에서 통일된다.
- law / precedent agent는 계속 thin wrapper로 남는다.
- rerank, evidence pack, citation 고도화 위치가 명확하다.

한 줄 요약:

**retrieval provider는 adapter seam으로만 교체하고, live provider는 명시적 주입 전까지 절대 기본 호출 경로가 아니다.**
