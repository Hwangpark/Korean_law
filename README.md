# ⚖️ Korean Law Analyzer

> **커뮤니티 글, 게임 채팅, 일상 대화 캡처 한 장으로 법적 분석 끝.**  
> 국가법령정보 공개 API + 멀티에이전트 시스템으로 관련 법령과 유사 판례를 자동 검색하고, 고소 가능 여부 및 예상 처벌을 안내합니다.

---

## 🔍 이런 상황에 씁니다

| 상황 | 예시 |
|------|------|
| 커뮤니티 익명글 | 허위사실 유포, 명예훼손, 악플 |
| 게임 내 채팅 | 협박, 욕설, 게임 사기 |
| 메신저 대화 | 스토킹, 성희롱, 공갈 |
| 온라인 거래 | 사기, 환불 거부 |

캡처 이미지 또는 텍스트를 붙여넣으면 → **"이게 죄가 되나요?"** 에 답해줍니다.

---

## 🏗️ 시스템 구조

```
사용자 (회원가입 / 로그인)
          │
          ▼
  ┌──────────────┐
  │  Auth Layer  │  ← JWT 인증
  └──────┬───────┘
         │
         ▼
사용자 (이미지 / 텍스트 업로드)
         │
         ▼
  ┌───────────────┐
  │  Orchestrator │  ← 전체 흐름 조율
  └──────┬────────┘
         │
  ┌──────▼──────┐
  │  OCR Agent  │  ← 이미지에서 텍스트 추출 + 발화자 구분
  └──────┬──────┘
         │
  ┌──────▼──────────┐
  │ Classifier Agent│  ← 명예훼손 / 협박 / 사기 등 유형 분류
  └──────┬──────────┘
         │
    ┌────┴─────┐  (병렬 실행)
    ▼          ▼
┌─────────┐ ┌──────────────────┐
│  Law    │ │ Precedent Search │
│ Search  │ │     Agent        │
│ Agent   │ │  (유사 판례 검색) │
└────┬────┘ └────────┬─────────┘
     └───────┬───────┘
             ▼
  ┌──────────────────────────────────┐
  │        Legal Analysis Agent      │
  │  고소 가능 여부 + 예상 처벌 판단  │
  │  + 비전문가 언어로 결과 포맷 변환 │
  └──────────────────────────────────┘
             │
             ▼
  ┌──────────────────────────────────┐
  │     PostgreSQL (Docker)          │
  │  분석 결과 저장 / 히스토리 조회   │
  └──────────────────────────────────┘
             │
             ▼
       결과 화면 출력
```

---

## 🤖 에이전트 역할 요약

| 에이전트 | 역할 |
|---------|------|
| **Orchestrator** | 파이프라인 전체 조율, 병렬 실행 관리, SSE 스트리밍 |
| **OCR Agent** | Vision 모델로 이미지→텍스트, 발화자 A/B 분리, UI 요소 제거 |
| **Classifier Agent** | 위법 행위 유형 식별 → 법령 카테고리 매핑 |
| **Law Search Agent** | 국가법령정보 API → 관련 조문, 처벌 조항, 친고죄 여부 |
| **Precedent Agent** | 판례 API → 유사 사건 판결 결과 및 법원 판단 요약 |
| **Legal Analysis Agent** | 법령 + 판례 종합 → 고소 가능성, 예상 형량, 증거 수집 안내 + 일반인 언어로 결과 포맷 변환 |

---

## 👤 인증 구조

```
회원가입  →  이메일 + 비밀번호 → bcrypt 해싱 → PostgreSQL 저장
로그인    →  검증 후 JWT 발급 (Access Token + Refresh Token)
API 요청  →  Authorization: Bearer {token} 헤더 검증
```

**DB 테이블 (예정)**

| 테이블 | 내용 |
|--------|------|
| `users` | id, email, password_hash, created_at |
| `analysis_history` | id, user_id, input_text, result_json, created_at |

로그인한 사용자는 본인의 분석 히스토리를 조회할 수 있습니다.

---

## 📡 데이터 소스

**[국가법령정보 공개 API](https://open.law.go.kr/LSO/openApi/guideList.do)**

```
법령 목록 검색  →  OC100101
법령 본문 조회  →  OC100103
판례 목록 검색  →  OC100201
판례 본문 조회  →  OC100203
행정규칙 검색   →  OC100301
```

---

## 🖥️ 결과 화면 구성

```
┌────────────────────────────────────────────────────┐
│  위험도  ████████░░  Level 4 / 5  (고위험)          │
├────────────────────────────────────────────────────┤
│  ✅ 사이버 명예훼손 성립 가능                        │
│     └ 근거: 정보통신망법 제70조 제1항               │
│     └ 예상: 3년 이하 징역 / 3천만원 이하 벌금       │
├────────────────────────────────────────────────────┤
│  📁 유사 판례                                       │
│     2023도1234 | 대법원 | 유죄 | 벌금 300만원       │
├────────────────────────────────────────────────────┤
│  📋 권장 행동                                       │
│     □ 게시글 URL + 스크린샷 보존                    │
│     □ 사이버수사대 고소장 제출                      │
│     □ 임시처분 신청 (IP 추적)                       │
└────────────────────────────────────────────────────┘
```

---

## 🛠️ 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | Next.js 14+, Tailwind CSS |
| Backend | FastAPI 또는 Next.js API Routes |
| 인증 | JWT (Access + Refresh Token) |
| 데이터베이스 | PostgreSQL (Docker) |
| 실시간 통신 | Server-Sent Events (SSE) |
| 작업 큐 | Redis |
| 법령 데이터 | 국가법령정보 공개 API |

---

## 🐳 Docker 구성

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: koreanlaw
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

---

## 🗺️ 개발 로드맵

- **Phase 1 — 인증 + MVP**
  - [ ] 회원가입 / 로그인 (JWT)
  - [ ] PostgreSQL Docker 세팅
  - [ ] 텍스트 직접 입력 지원
  - [ ] Classifier + Law Search Agent
  - [ ] 기본 결과 화면

- **Phase 2 — 판례 연동**
  - [ ] Precedent Search Agent
  - [ ] Legal Analysis Agent
  - [ ] SSE 실시간 진행 표시
  - [ ] 분석 히스토리 저장 / 조회

- **Phase 3 — 이미지 + 고도화**
  - [ ] OCR Agent (이미지 업로드)
  - [ ] 위험도 시각화
  - [ ] 모바일 최적화

---

## ⚙️ 환경 변수

```env
# DB
DB_USER=
DB_PASSWORD=
DB_HOST=localhost
DB_PORT=5432
DB_NAME=koreanlaw

# JWT
JWT_SECRET=
JWT_EXPIRES_IN=1h
REFRESH_TOKEN_EXPIRES_IN=7d

# 국가법령정보 API
LAW_API_KEY=          # open.law.go.kr 발급 대기 중
LAW_API_BASE_URL=https://open.law.go.kr/LSO/openApi/
```

---

## ⚠️ 면책 고지

> 본 서비스는 법률 정보 제공을 목적으로 하며, **법적 효력이 없습니다.**  
> 구체적인 법률 조언은 반드시 변호사에게 문의하시기 바랍니다.

---

## 📎 참고

- [국가법령정보 공개 API 가이드](https://open.law.go.kr/LSO/openApi/guideList.do)
- [시스템 상세 설계 → ARCHITECTURE.md](./ARCHITECTURE.md)
