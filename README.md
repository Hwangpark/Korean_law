# Korean Law Multi-Agent Scaffold

이 저장소는 [ARCHITECTURE.md](/Users/minsu/Desktop/KoreanLaw/ARCHITECTURE.md)를 기준으로 만든 mock-first 멀티에이전트 스캐폴드다.

현재 상태:
- 실서비스 UI/API 구현 전 단계
- Codex가 읽기 좋은 프로젝트 가이드와 역할 분리 추가
- 국가법령정보 API 키 없이도 돌아가는 mock 파이프라인 포함
- Orchestrator 포함 6-agent 구조로 정리 완료
- OCR → 분류 → 법령 검색 → 판례 검색 → 법적 판단 및 결과 포맷 흐름 검증 가능
- Docker PostgreSQL + 사용자 로그인/회원가입 API 스캐폴드 추가
- TypeScript auth API + React/Vite 홈페이지 초안 추가

빠른 실행:

```bash
npm run mock:run
npm test
```

인증/DB 개발:

```bash
npm install
npm run db:up
npm run dev:api
npm run test:auth
```

전체 컨테이너 실행:

```bash
npm run stack:up
```

로컬 `5432`가 이미 사용 중이면:

```bash
POSTGRES_PORT=5433 npm run stack:up
```

웹 프론트 실행:

```bash
npm run web:install
npm run dev:web
```

기본 fixture:
- [fixtures/requests/sample-community.json](/Users/minsu/Desktop/KoreanLaw/fixtures/requests/sample-community.json)
- [fixtures/requests/sample-messenger-image.json](/Users/minsu/Desktop/KoreanLaw/fixtures/requests/sample-messenger-image.json)

다음 단계:
1. `LAW_API_KEY` 발급 후 `LAW_PROVIDER=live` provider 구현
2. 로그인 이후 사건 접수 UI를 `apps/web`에서 멀티에이전트 입력 플로우와 연결
3. SSE 진행 이벤트를 `apps/api` 오케스트레이터에 연결
