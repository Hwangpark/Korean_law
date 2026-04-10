# Korean Law Multi-Agent Scaffold

이 저장소는 [ARCHITECTURE.md](/Users/minsu/Desktop/KoreanLaw/ARCHITECTURE.md)를 기준으로 만든 mock-first 멀티에이전트 스캐폴드다.

현재 상태:
- 실서비스 UI/API 구현 전 단계
- Codex가 읽기 좋은 프로젝트 가이드와 역할 분리 추가
- 국가법령정보 API 키 없이도 돌아가는 mock 파이프라인 포함
- OCR → 분류 → 법령 검색 → 판례 검색 → 법적 판단 → 리포트 생성 흐름 검증 가능

빠른 실행:

```bash
npm run mock:run
npm test
```

기본 fixture:
- [fixtures/requests/sample-community.json](/Users/minsu/Desktop/KoreanLaw/fixtures/requests/sample-community.json)
- [fixtures/requests/sample-messenger-image.json](/Users/minsu/Desktop/KoreanLaw/fixtures/requests/sample-messenger-image.json)

다음 단계:
1. `LAW_API_KEY` 발급 후 `LAW_PROVIDER=live` provider 구현
2. `apps/web`에 Next.js App Router UI 추가
3. SSE 진행 이벤트를 `apps/api` 오케스트레이터에 연결
