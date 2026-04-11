# KoreanLaw

한국어 텍스트, 캡처 이미지, 링크를 입력받아 법적 쟁점, 관련 법령, 유사 판례, 참고용 분석 결과를 생성하는 멀티에이전트 법률 분석 작업대입니다.

현재 브랜치 `codex` 기준 구현 범위:
- React + TypeScript 웹 UI
- 회원가입 / 로그인 / 세션 복원
- Docker PostgreSQL 개발 스택
- 6-agent 분석 파이프라인
- 이미지 OCR (`tesseract.js`)
- 국가법령정보 공동활용 Open API live 연동
- 링크 크롤링 + SSRF / `robots.txt` 기본 방어
- 사용자별 분석 히스토리 저장

## Runtime Agents

1. Orchestrator
2. OCR Agent
3. Classifier Agent
4. Law Search Agent
5. Precedent Agent
6. Legal Analysis Agent

## Stack

- Web: React 18 + Vite + TypeScript
- API: Node + TypeScript (`tsx`) + existing mock/live agent modules
- DB: PostgreSQL 16 (Docker)
- OCR: `tesseract.js`
- Ingestion: built-in HTML fetch / normalize pipeline
- Auth: JWT + PostgreSQL

## Local Run

1. `.env.local`을 준비합니다.
2. 의존성을 설치합니다.
3. Docker 스택을 올립니다.

```bash
npm install
npm --prefix apps/web install
npm run stack:up
```

기본 접속 주소:
- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Adminer: `http://localhost:8080`
- PostgreSQL: `localhost:5433` in local dev

## Required Env

`.env.example`를 참고하고, 실제 값은 `.env.local`에 둡니다.

중요 항목:
- `LAW_PROVIDER=live`
- `LAW_API_KEY=<your-open-law-oc>`
- `LAW_API_BASE_URL=https://www.law.go.kr/DRF/`
- `DATABASE_URL=postgresql://...`
- `AUTH_JWT_SECRET=...`

## API

### Auth
- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`
- `GET /health`

### Analysis
- `POST /api/analyze`
- `GET /api/history`

`/api/analyze`는 로그인된 사용자 토큰이 필요합니다.

입력 모드:
- `text`
- `image`
- `link`

## Analysis Request Shape

```json
{
  "title": "메신저 협박 검토",
  "context_type": "messenger",
  "input_mode": "image",
  "text": "반복 협박 정황이 보입니다.",
  "image_base64": "data:image/png;base64,...",
  "image_name": "capture.png",
  "image_mime_type": "image/png"
}
```

링크 입력 예시:

```json
{
  "title": "게시글 링크 검토",
  "context_type": "community",
  "input_mode": "link",
  "url": "https://example.com/post/123",
  "text": "댓글 흐름과 삭제 여부를 같이 보고 싶습니다."
}
```

## Checks

```bash
npm run check
npm run build:web
npm run test:auth
npm run test:mock
```

## Notes

- 결과는 참고용이며 법적 효력이 없습니다.
- 이미지 원본은 DB에 저장하지 않고 OCR 텍스트와 메타데이터만 저장합니다.
- 링크 크롤링은 `http/https`만 허용하며, localhost / private IP / 특수 주소를 차단합니다.
- `robots.txt`가 404가 아닌 방식으로 확인 실패하면 차단합니다.
