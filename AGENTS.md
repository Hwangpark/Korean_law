# AGENTS.md

## 프로젝트 목적
- 한국어 텍스트 또는 이미지 대화 캡처를 입력받아 법적 쟁점, 관련 법령, 유사 판례, 참고용 분석 리포트를 생성한다.
- 현재는 API 키가 없으므로 mock-first 개발을 기본 원칙으로 한다.

## 소스 오브 트루스
- [ARCHITECTURE.md](/Users/minsu/Desktop/KoreanLaw/ARCHITECTURE.md): 제품 구조와 단계별 요구사항
- [docs/multi-agent-runtime.md](/Users/minsu/Desktop/KoreanLaw/docs/multi-agent-runtime.md): 런타임 에이전트 계약과 mock 동작 범위

## 현재 저장소 구조
- [apps/api](/Users/minsu/Desktop/KoreanLaw/apps/api): 오케스트레이터와 런타임 에이전트 스캐폴드
- [apps/web](/Users/minsu/Desktop/KoreanLaw/apps/web): 향후 Next.js UI 자리
- [fixtures](/Users/minsu/Desktop/KoreanLaw/fixtures): mock 요청, OCR 결과, 법령/판례 fixture
- [scripts](/Users/minsu/Desktop/KoreanLaw/scripts): 저장소 유지보수 및 검증 스크립트
- [docs](/Users/minsu/Desktop/KoreanLaw/docs): 아키텍처 보조 문서

## 개발 원칙
- API 키가 생기기 전까지는 외부 네트워크 호출을 새로 추가하지 않는다.
- mock provider는 실제 runtime contract와 동일한 필드를 유지한다.
- 법률 해석은 항상 참고용으로 표현하고, 결과물에 면책 문구를 남긴다.
- 개인정보 마스킹, 업로드 후 삭제, 오남용 방지 규칙은 기능 추가 시 제거하지 않는다.
- Law Search와 Precedent Search는 병렬 가능하도록 입력 계약을 느슨하게 유지한다.

## Codex 작업 방식
- 문서 탐색, 데이터 계약 검토, fixture 정리는 read-heavy subtask로 분리한다.
- `apps/api/src/**`와 `apps/web/**`는 동시에 수정하더라도 같은 파일을 공유하지 않게 역할을 나눈다.
- reviewer 성격의 검토에서는 정확성, 개인정보, 면책 누락, 테스트 누락을 우선 본다.
- mock 모드와 live 모드 분기 로직은 한 군데에만 두고 agent별로 중복하지 않는다.

## 권장 명령
- `npm run mock:run`
- `npm test`
- `npm run check`

## 구현 시 주의점
- OCR 결과는 `source_type`, `utterances`, `raw_text`를 유지한다.
- 분류 결과는 `issues`, `is_criminal`, `is_civil`를 유지한다.
- 최종 리포트는 비전문가가 이해할 수 있는 요약과 면책 문구를 포함해야 한다.
- 실제 API 연동 시 fixture shape를 먼저 깨지지 않게 유지한 뒤 provider만 교체한다.
