# AGENTS.md

## 프로젝트 목적
- 한국어 텍스트 또는 이미지 대화 캡처를 입력받아 법적 쟁점, 관련 법령, 유사 판례, 참고용 분석 리포트를 생성한다.
- mock-first 개발을 기본 원칙으로 하되, live provider는 명시적으로 주입될 때만 사용한다.

## 소스 오브 트루스
- [project.md](/Users/minsu/Desktop/KoreanLaw/project.md): 제품 방향과 채택/비채택 아키텍처
- [ARCHITECTURE.md](/Users/minsu/Desktop/KoreanLaw/ARCHITECTURE.md): 제품 구조와 단계별 요구사항
- [docs/multi-agent-runtime.md](/Users/minsu/Desktop/KoreanLaw/docs/multi-agent-runtime.md): 런타임 에이전트 계약과 mock/live 경계
- [docs/mcp-first-runtime.md](/Users/minsu/Desktop/KoreanLaw/docs/mcp-first-runtime.md): retrieval provider와 MCP-first tool runtime 경계
- [docs/codex-orchestration.md](/Users/minsu/Desktop/KoreanLaw/docs/codex-orchestration.md): 개발용 멀티 에이전트 운영 규칙

## 현재 저장소 구조
- [apps/api](/Users/minsu/Desktop/KoreanLaw/apps/api): 오케스트레이터와 런타임 에이전트 스캐폴드
- [apps/web](/Users/minsu/Desktop/KoreanLaw/apps/web): React/Vite UI
- [fixtures](/Users/minsu/Desktop/KoreanLaw/fixtures): mock 요청, OCR 결과, 법령/판례 fixture
- [scripts](/Users/minsu/Desktop/KoreanLaw/scripts): 저장소 유지보수 및 검증 스크립트
- [docs](/Users/minsu/Desktop/KoreanLaw/docs): 아키텍처 보조 문서
- [ops](/Users/minsu/Desktop/KoreanLaw/ops): 개발용 에이전트 역할, 파일 소유권, 오케스트레이션 규칙

## 개발 원칙
- 기본 실행 경로는 외부 네트워크 없이 통과해야 한다.
- live provider는 환경 변수 값만으로 자동 호출하지 않고, 명시적 provider seam을 통해서만 사용한다.
- mock provider는 실제 runtime contract와 동일한 필드를 유지한다.
- 법률 해석은 항상 참고용으로 표현하고, 결과물에 면책 문구를 남긴다.
- 개인정보 마스킹, 업로드 후 삭제, 오남용 방지 규칙은 기능 추가 시 제거하지 않는다.
- Law Search와 Precedent Search는 병렬 가능하도록 입력 계약을 느슨하게 유지한다.
- runtime stage 이름은 `ocr`, `classifier`, `law`, `precedent`, `analysis`, `orchestrator`를 유지한다.
- Scope Filter, Retrieval Planner, Evidence Rerank, Evidence Pack은 runtime stage가 아니라 logical substep으로 둔다.

## Codex 작업 방식
- 작업 전에는 파일 소유권을 먼저 확인하고, 같은 파일을 두 에이전트가 동시에 수정하지 않는다.
- 문서 탐색, 데이터 계약 검토, fixture 정리는 read-heavy subtask로 분리한다.
- `apps/api/src/**`, `apps/web/**`, `docs/**`, `scripts/**`는 동시에 수정하더라도 같은 파일을 공유하지 않게 역할을 나눈다.
- reviewer 성격의 검토에서는 정확성, 개인정보, 면책 누락, 테스트 누락, architecture boundary 위반을 우선 본다.
- mock 모드와 live 모드 분기 로직은 한 군데에만 두고 agent별로 중복하지 않는다.
- `AGENTS.md`는 사용자가 명시적으로 요청했을 때만 수정한다.
- `.claude/`, `.env.local`, secret 값은 사용자가 명시하지 않는 한 커밋하지 않는다.
- `main` 브랜치는 건드리지 않고, 작업 브랜치는 `codex`를 기본으로 한다.
- 동일 오류가 3회 반복되면 같은 접근을 반복하지 말고 중단 후 원인과 대안을 보고한다.

## 권장 명령
- `npm run mock:run`
- `npm test`
- `npm run check`

## 구현 시 주의점
- OCR 결과는 `source_type`, `utterances`, `raw_text`를 유지한다.
- 분류 결과는 `issues`, `is_criminal`, `is_civil`를 유지한다.
- 최종 리포트는 비전문가가 이해할 수 있는 요약과 면책 문구를 포함해야 한다.
- 실제 API 연동 시 fixture shape를 먼저 깨지지 않게 유지한 뒤 provider만 교체한다.
- retrieval 결과는 preview와 trace를 분리하고, public 응답에 원문 전체를 노출하지 않는다.
- evidence pack 없이 강한 고소 가능성 판단을 생성하지 않는다.
