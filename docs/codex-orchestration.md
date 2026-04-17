# Codex Orchestration Rules

## 목적

이 문서는 KoreanLaw 저장소에서 개발용 멀티 에이전트를 운영할 때의 규칙이다.

서비스 런타임 에이전트와 개발용 코딩 에이전트를 분리한다.

- 서비스 런타임 에이전트: 실제 사용자 요청 처리 파이프라인
- 개발용 코딩 에이전트: 코드 탐색, 구현, 검증, 리뷰 분업

## 기본 운영 모델

기본 팀 크기는 `3~5 builders + 1 reviewer`다.

10개 이상 에이전트를 동시에 띄우지 않는다. 지금 저장소는 법률 판단, 개인정보, retrieval 품질이 같이 얽혀 있어서 검증 병목이 먼저 온다.

## 역할

### Orchestrator

- 사용자 요구를 스펙과 작업 단위로 쪼갠다.
- 파일 소유권을 정한다.
- 병렬 가능한 작업과 순차 작업을 구분한다.
- 최종 통합과 커밋/푸시를 책임진다.

### Planner

- `project.md`, `ARCHITECTURE.md`, `docs/multi-agent-runtime.md`, `docs/mcp-first-runtime.md`를 먼저 확인한다.
- 구현 전에 acceptance criteria를 적는다.
- runtime stage 이름이 늘어나는 설계를 막는다.

### Backend Worker

- `apps/api/src/**` 구현 담당.
- HTTP handler, service, store, retrieval runtime을 파일 경계에 맞게 분리한다.
- live/mock provider 분기를 중복하지 않는다.

### Retrieval Worker

- `apps/api/src/retrieval/**`, `fixtures/providers/**`, retrieval 테스트 담당.
- MCP-first tool runtime을 중심으로 수정한다.
- law/precedent agent에는 provider 로직을 넣지 않는다.

### Frontend Worker

- `apps/web/**` 담당.
- 현재 main UI 톤을 유지한다.
- 기능 추가 시 인증 gate, 게스트 3회 제한, 결과 상세 패널 흐름을 깨지 않는다.

### Verifier

- 테스트, 타입체크, fixture shape, privacy boundary를 검증한다.
- 빌더와 같은 파일을 수정하지 않는다.
- 실패 원인을 재현 가능한 명령으로 남긴다.

### Reviewer

- 읽기 중심 역할이다.
- 법률 정확성, 개인정보 노출, 면책 문구, retrieval evidence 부족, 과도한 결론 문장을 우선 본다.
- 코드 냄새와 스파게티 조짐을 발견하면 파일 경계 기준으로 지적한다.

## 파일 소유권 규칙

- 하나의 파일은 한 번에 한 에이전트만 수정한다.
- `apps/api/src/retrieval/tools.ts`, `apps/api/src/retrieval/planner.ts`, `apps/api/src/orchestrator/run-analysis.mjs`는 충돌 위험이 높으므로 동시에 여러 명이 만지지 않는다.
- `AGENTS.md`는 사용자 명시 요청이 있을 때만 수정한다.
- `.claude/`, `.env.local`, secret 값은 기본적으로 커밋하지 않는다.
- `main` 브랜치는 건드리지 않는다.

## 작업 라이프사이클

1. `Plan`: 목표, 파일 범위, 검증 명령을 정한다.
2. `Claim`: 담당 파일을 명시한다.
3. `Implement`: 담당 범위만 수정한다.
4. `Validate`: 최소 검증 명령을 실행한다.
5. `Review`: reviewer가 경계 위반과 누락 테스트를 본다.
6. `Integrate`: orchestrator가 충돌 없이 합치고 커밋한다.

현재 자동화 보조 명령:

- `npm run orch:next -- --json` : 다음 pending task를 machine-readable 형식으로 조회
- `npm run orch:brief -- --task <id>` : sub-agent handoff용 brief 생성
- `npm run orch:claim -- --task <id> [--role <role>]` : pending task를 in_progress로 claim
- `npm run orch:update -- --task <id> --status <pending|in_progress|completed|blocked>` : task 상태 갱신
- `npm run orch:review -- --task <id> [--write]` : reviewer checklist 생성 및 선택적으로 `docs/review-notes.md` 갱신
- `npm run orch:validate` : task/role 정의와 파일 범위 경고 검사

## 검증 게이트

작업 종류별 최소 검증은 아래를 따른다.

- API/runtime 변경: `npm run typecheck`, `npm run test:mock`, 관련 `npm run test:*`
- retrieval 변경: `npm run test:bridge`, `npm run test:evidence-pack`, `npm run test:retrieval-rerank`, `npm run test:retrieval-provider`
- classifier/guided extraction 변경: `npm run test:guided-extraction`, `npm run test:scope-filter`, `npm run test:mixed-fixtures`
- keyword verification 변경: `npm run test:keyword`, `npm run test:keyword-http`
- UI 변경: `npm run web:check`, `npm run build:web`
- 광범위 변경: `npm run check`

Docker 또는 live HTTP smoke는 로컬 daemon과 환경 변수가 준비된 경우에만 실행한다. 실패가 환경 문제인지 코드 문제인지 구분해서 보고한다.

## 루프 가드레일

- 같은 오류에서 3회 이상 실패하면 중단하고 다른 접근을 제안한다.
- 테스트를 통과시키기 위해 product rule, privacy rule, disclaimer를 제거하지 않는다.
- 불확실한 법률 판단은 확정 표현으로 바꾸지 않는다.
- fixture만 맞추기 위해 live provider contract를 깨지 않는다.

## Retrieval / MCP-first 규칙

- retrieval 핵심은 `planner.ts`, `tools.ts`, `mcp-adapter.ts`, `verification*.ts`에 둔다.
- law/precedent agent는 thin wrapper다.
- keyword verification과 full analysis는 같은 planning/scoring 규칙을 공유한다.
- 입력 단어가 특정 term family에 매핑되면 판례 본문/요지/스니펫에 실제 표현 또는 동등 표현이 있는지 우선 확인한다.
- broad issue 결과는 fallback으로만 사용하고, exact/specific evidence가 있으면 그 결과를 우선한다.

## 기록 규칙

- 중요한 의사결정은 문서에 남긴다.
- runtime 결과에는 `preview`와 `trace`를 분리해서 남긴다.
- public preview에는 원문 전체, 이메일, 전화번호, 상세 개인정보를 넣지 않는다.
- 내부 trace는 provider, input ref, output ref, duration 중심으로 남긴다.

## 통합 기준

커밋 전 확인:

- `git status`에서 의도한 파일만 staged
- `.claude/`, `.env.local` 제외
- `main` 아님
- 최소 검증 명령 통과
- 변경 설명이 “무엇을 왜 바꿨는지”를 포함
