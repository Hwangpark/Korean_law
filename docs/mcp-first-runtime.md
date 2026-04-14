# MCP-First Retrieval Runtime

## 목표

- 검색 로직을 각 agent 안에 흩뿌리지 않고, 내부 tool runtime 한 곳에서 먼저 실행한다.
- Orchestrator는 `plan -> tool runtime -> law/precedent agent -> legal analysis` 순서만 조율한다.
- UI와 저장 계층은 `preview`와 `trace`를 통해 어떤 tool을 먼저 탔는지 확인할 수 있어야 한다.

## 현재 흐름

1. `OCR Agent`가 원문을 정리한다.
2. `Classifier Agent`가 쟁점 후보를 만든다.
3. `retrieval/planner.ts`의 `buildAnalysisRetrievalPlan()`이 원문과 분류 결과를 합쳐 검색 plan을 만든다.
4. `retrieval/tools.ts`가 plan을 받아 `search_law_tool`, `search_precedent_tool`을 실행한다.
5. `Law Search Agent`, `Precedent Search Agent`는 직접 provider를 만지지 않고 runtime 결과만 소비한다.
6. `Legal Analysis Agent`가 law/precedent 결과를 최종 판단 포맷으로 합친다.

## 파일 경계

- [apps/api/src/retrieval/planner.ts](/Users/minsu/Desktop/KoreanLaw/apps/api/src/retrieval/planner.ts)
  - query plan 생성
  - classifier 결과를 retrieval plan으로 승격
- [apps/api/src/retrieval/tools.ts](/Users/minsu/Desktop/KoreanLaw/apps/api/src/retrieval/tools.ts)
  - 내부 MCP-style tool runtime
  - tool list, search/detail, preview/trace 조합
- [apps/api/src/retrieval/http.ts](/Users/minsu/Desktop/KoreanLaw/apps/api/src/retrieval/http.ts)
  - HTTP transport만 담당
- [apps/api/src/orchestrator/run-analysis.mjs](/Users/minsu/Desktop/KoreanLaw/apps/api/src/orchestrator/run-analysis.mjs)
  - agent 순서와 병렬 실행만 담당
- [apps/api/src/agents/law-search-agent.mjs](/Users/minsu/Desktop/KoreanLaw/apps/api/src/agents/law-search-agent.mjs)
- [apps/api/src/agents/precedent-search-agent.mjs](/Users/minsu/Desktop/KoreanLaw/apps/api/src/agents/precedent-search-agent.mjs)
  - runtime thin wrapper

## preview / trace

- `meta.retrieval_preview`
  - UI 기본 렌더링용
  - top issue, top law, top precedent, profile flag 요약
- `meta.retrieval_trace`
  - 디버깅용
  - tool 이름, provider, input ref, output ref, duration만 남긴다
  - 원문 전체는 넣지 않는다

## 저장 전략

- 인증 사용자 분석은 `analysis_runs.preview_json`, `analysis_runs.trace_json`에 저장한다.
- keyword verification도 같은 runtime을 타므로 law/precedent 검색 기준이 분기되지 않는다.

## 다음 고도화

1. live provider 결과와 local cache hit 여부를 trace에 구분해서 저장
2. reference_library hit를 retrieval preview rank와 연결
3. tool runtime을 외부 MCP 서버 endpoint로 분리할지, 현재 HTTP `/tools/*`를 유지할지 결정
