# Keyword Verification Architecture

## Goal

사용자가 단어 또는 짧은 문구를 입력하면 다음 단계를 거쳐 참고용 법률 검증 결과를 반환한다.

1. 입력어 정규화
2. 사건 맥락 추론
3. 관련 법령/판례 검색 질의 확장
4. 공식 소스 기반 검색
5. 검색 결과 검증 및 점수화
6. 클릭 가능한 상세 근거 반환

이 흐름은 기존 전체 사건 분석 파이프라인과 분리된 모듈로 유지한다.

## Why Hybrid Instead Of A Full MCP Runtime

`SeoNaRu/korean-law-mcp` 저장소는 다음 패턴을 참고하기에 적합하다.

- `search` 와 `detail` tool 분리
- 네트워크 재시도와 실패 캐시
- 검색 결과 정규화
- 법령과 판례를 같은 인터페이스로 다루는 구조

하지만 현재 서비스는 TypeScript API 서버와 PostgreSQL 기반 히스토리/인증을 이미 사용하고 있으므로,
Python FastMCP 서버를 그대로 포함하면 런타임이 이중화되고 배포 경계가 흐려진다.

따라서 구현 원칙은 다음과 같다.

- 공식 API는 source of truth 로 유지
- 우리 서버 내부에 `MCP-style adapter` 만 둔다
- 사용자 응답용 검색/상세 데이터는 PostgreSQL 캐시를 재사용한다

## Backend Module Split

`apps/api/src/retrieval/`

- `types.ts`
  - keyword verification request/response 계약
  - search hit / hydrated reference / verification item 타입
- `planner.ts`
  - 입력어 정규화
  - issue catalog 기반 후보 쟁점 추론
  - 검색 질의 확장
- `mcp-adapter.ts`
  - `searchLaw`
  - `getLawDetail`
  - `searchPrecedent`
  - `getPrecedentDetail`
  - mock/live provider 분기
- `verification.ts`
  - 검색 결과를 검증 점수와 설명으로 변환
  - 법령/판례를 UI 친화적 구조로 정리
- `store.ts`
  - query run / match hit 저장
  - `reference_library` 와의 연결 키 저장
- `service.ts`
  - planner, adapter, verifier, store 조합
  - 기존 `reference_library` upsert 호출
- `http.ts`
  - `/api/keywords/verify`
  - `/api/keywords/runs/:id`

## Reuse Of Existing Reference Library

현재 저장소에는 `reference_library` 가 이미 있고 상세 조회 API도 연결되어 있다.

신규 keyword verification 은 별도 원문 저장소를 만들지 않고 아래 규칙으로 이 테이블을 재사용한다.

1. 법령/판례 검색 후 정규화된 결과를 pseudo-analysis 결과처럼 묶는다
2. 기존 `saveReferenceLibrary` 를 호출해 `reference_library` 에 upsert 한다
3. verification 결과에는 `reference_key` 와 `href` 를 포함한다
4. UI 상세 보기는 기존 `/api/references/:kind/:id` 를 그대로 사용한다

이 방식이면 상세 보기 체계를 중복 구현하지 않아도 된다.

## Persistence

신규 테이블은 query execution 추적에만 집중한다.

### `keyword_verification_runs`

- `id`
- `user_id`
- `guest_id`
- `query_text`
- `normalized_query`
- `context_type`
- `provider_mode`
- `plan_json`
- `summary_json`
- `created_at`

### `keyword_verification_hits`

- `id`
- `run_id`
- `reference_source_key`
- `kind`
- `query_text`
- `issue_type`
- `rank_order`
- `match_reason`
- `confidence_score`
- `created_at`

이 테이블은 "왜 이 결과가 반환되었는지" 를 추적하는 용도다.

## Response Contract

```json
{
  "run_id": "uuid",
  "query": {
    "original": "패드립",
    "normalized": "패드립",
    "context_type": "game_chat"
  },
  "plan": {
    "tokens": ["패드립"],
    "candidate_issues": [
      {
        "type": "모욕",
        "reason": "욕설/비하 표현과 유사"
      }
    ],
    "law_queries": ["모욕", "형법 제311조"],
    "precedent_queries": ["게임 채팅 모욕", "온라인 모욕"]
  },
  "verification": {
    "summary": "입력어 자체는 비법률 용어지만 모욕 및 협박 맥락 검토가 필요합니다.",
    "warnings": ["입력어 단독으로는 공연성 판단이 어렵습니다."],
    "matched_laws": [],
    "matched_precedents": []
  },
  "reference_library": {
    "items": []
  }
}
```

## Verification Rules

점수화는 LLM 의존 없이 deterministic rule 로 시작한다.

- issue keyword 직접 일치
- 검색 결과 제목/요약에 입력어 또는 확장 질의 포함
- context type 과 issue type 의 조합 적합성
- 조문/판례 본문에 욕설, 협박, 공개성, 반복성 같은 핵심 요소가 포함되는지

출력에는 다음이 반드시 포함된다.

- 점수
- 매칭 사유 한 줄
- 참고용 면책 문구

## UI Integration

기존 메인 UI는 유지한다.

- 분석 입력 카드 아래에 keyword verification card 추가
- 짧은 단어/문구 입력용 필드 제공
- 로그인/게스트 제한은 기존 흐름 재사용
- 결과는 inline list + detail panel 로 표시

전체 사건 분석 결과 화면과 별도 상태를 유지해 기존 분석 UX 를 깨지 않는다.
