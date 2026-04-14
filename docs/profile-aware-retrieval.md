# Profile-Aware Retrieval

## 목적
- 회원가입에서 받은 `name / birth_date / gender / nationality`를 `user_profiles`에 저장한다.
- 분석과 키워드 검증은 인증 정보가 아니라 `profile_context` 파생값만 사용한다.
- `korean-law-mcp`는 Python 서버를 통째로 들이지 않고, `search/detail` 도구 계약과 캐시 발상만 흡수한다.

## 구조
- `apps/api/src/auth/profile.ts`
  - 입력 프로필 검증과 canonical 값 정규화
  - `male/female`, `korean/foreign`로 저장 통일
- `apps/api/src/analysis/profile-context.ts`
  - `birthDate -> ageYears / ageBand / isMinor / legalNotes` 파생
- `apps/api/src/retrieval/*`
  - `KeywordVerificationRequest.profileContext`를 optional 입력으로 받음
  - planner가 연령/국적 기반 질의 확장을 수행
  - run/hit 저장 시 `profile_snapshot`을 같이 남김
- `apps/api/src/analysis/*`
  - 로그인 사용자는 분석 시점의 `profile_context`를 읽어 결과와 DB snapshot에 함께 저장

## 연령 규칙
- `adult`: 만 19세 이상
- `minor`: 만 18세 이상 19세 미만
- `child`: 만 18세 미만

이 규칙은 결과를 확정하는 법률판단이 아니라, 안내 문구와 검색 우선순위를 조정하는 제품 규칙이다.

## 욕설 검출
- `apps/api/src/lib/abuse-patterns.mjs`
  - 정규화
  - collapse 비교
  - `패드립` 계열 alias/pattern
- classifier와 retrieval planner는 같은 규칙을 사용한다.

## MCP 흡수 범위
- 유지
  - `searchLaw`, `getLawDetail`, `searchPrecedent`, `getPrecedentDetail` 같은 tool shape
  - live API 실패 시 cache/fallback 전략
- 배제
  - Python FastMCP 서버 런타임 전체
  - live-only 조회

## External Tool Endpoints
- `GET /api/tools`
- `POST /api/tools/search_law_tool`
- `POST /api/tools/get_law_detail_tool`
- `POST /api/tools/search_precedent_tool`
- `POST /api/tools/get_precedent_detail_tool`

외부 에이전트는 위 endpoint를 직접 사용하고, 사용자 화면은 계속 `/api/keywords/verify`, `/api/analyze`만 사용한다.

## 검증 순서
1. `npm run test:abuse`
2. `npm run test:keyword`
3. `npm run test:keywords`
