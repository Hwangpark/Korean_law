# Runtime Multi-Agent Notes

이 문서는 Codex의 작업용 sub-agent와 서비스 런타임 agent를 분리해서 설명한다.

## 1. Codex 작업용 sub-agent
- 목적: 코드 탐색, 문서 정리, 구현 분리, 리뷰
- 기준 파일: [AGENTS.md](/Users/minsu/Desktop/KoreanLaw/AGENTS.md)
- 권장 분업:
  - 문서/계약 탐색
  - API 파이프라인 구현
  - Web UI 구현
  - 리뷰와 테스트 보강

## 2. 서비스 런타임 agent
- Orchestrator
- OCR Agent
- Classifier Agent
- Law Search Agent
- Precedent Search Agent
- Legal Analysis Agent

## 현재 스캐폴드 목표
- 실서비스 이전에 입력과 출력 계약을 고정한다.
- API 키 없이도 end-to-end mock 실행이 가능해야 한다.
- 병렬 대상인 Law Search / Precedent Search를 코드 구조에서 분리한다.
- Legal Analysis Agent가 최종 사용자용 결과 포맷까지 직접 생성한다.
- 이후 live provider를 붙일 때 agent 인터페이스는 유지하고 내부 provider만 바꾼다.
- retrieval 계층은 가능한 한 `tool runtime`으로 먼저 수렴하고, agent는 thin wrapper로 유지한다.

## MCP-first 확장
- 세부 흐름은 [docs/mcp-first-runtime.md](/Users/minsu/Desktop/KoreanLaw/docs/mcp-first-runtime.md)에 정리한다.
- `preview`는 UI용, `trace`는 디버깅용으로 분리한다.

## Mock 모드 원칙
- OCR은 fixture 기반 또는 텍스트 입력 정규화만 수행한다.
- 법령/판례 조회는 `fixtures/providers/*.json` 기반으로 동작한다.
- 법적 판단은 deterministic rule 기반 초안만 제공한다.
- 결과는 항상 참고용이며 실제 법률 자문이 아니라는 문구를 유지한다.
