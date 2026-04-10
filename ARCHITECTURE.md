# 한국 법률 분석 멀티에이전트 시스템 설계

## 개요

사용자가 커뮤니티 익명글, 게임 내 대화, 일상 대화 캡처(이미지)를 업로드하면,  
해당 내용을 분석하여 **관련 법령 조회 → 판례 비교 → 형사/민사 처벌 가능성 판단**을 수행하는 반응형 웹 서비스.

---

## 데이터 소스

**국가법령정보 공개 API** (`https://open.law.go.kr/LSO/openApi/`)

| 분류 | 엔드포인트 | 설명 |
|------|-----------|------|
| 법령 목록 검색 | `OC100101` | 키워드로 법령 목록 조회 |
| 법령 본문 조회 | `OC100103` | 특정 법령 전문 조회 |
| 판례 목록 검색 | `OC100201` | 키워드/법원 필터로 판례 목록 |
| 판례 본문 조회 | `OC100203` | 판례 상세 (판결 이유 포함) |
| 행정규칙 검색 | `OC100301` | 행정 규제/지침 검색 |

> API 키 발급: https://open.law.go.kr 회원가입 후 신청

---

## 시스템 아키텍처

```
[사용자 브라우저]
      │
      ▼
[Next.js 반응형 웹 Frontend]
      │  이미지 업로드 / 텍스트 입력
      ▼
[API Gateway (Next.js API Routes / FastAPI)]
      │
      ▼
[Orchestrator Agent]  ◄── 전체 흐름 조율, 작업 분배
      │
  ┌───┴──────────────────────────────────────┐
  ▼           ▼             ▼                ▼
[OCR Agent] [Classifier] [Law Search]  [Precedent]
            [Agent]      [Agent]        [Agent]
  │           │             │                │
  └───────────┴─────────────┴────────────────┘
                      │
                      ▼
              [Legal Analysis Agent]
                      │
                      ▼
              [사용자에게 결과 반환]
```

---

## 에이전트별 역할 정의

### 1. Orchestrator Agent (조율 에이전트)

**역할:** 전체 파이프라인 관리 및 에이전트 간 데이터 흐름 조율

**입력:** 사용자 업로드 (이미지 또는 텍스트)  
**출력:** 최종 분석 결과 (Legal Analysis Agent 결과물)

**수행 작업:**
- 입력 타입 판별 (이미지 vs 텍스트)
- 에이전트 실행 순서 결정 및 병렬 실행 조율
- 각 에이전트 결과 수집 및 다음 에이전트에 전달
- 오류 발생 시 재시도 또는 폴백 처리
- 전체 처리 상태를 프론트엔드에 SSE(Server-Sent Events)로 스트리밍

**트리거 조건:** 사용자 요청 수신 즉시

---

### 2. OCR Agent (텍스트 추출 에이전트)

**역할:** 이미지에서 텍스트 추출

**입력:** 이미지 파일 (PNG, JPG, WebP)  
**출력:** 추출된 원문 텍스트 (JSON)

**수행 작업:**
- Vision 모델로 이미지 내 텍스트 인식
- 캡처 맥락 파악 (커뮤니티 UI인지, 게임 채팅창인지, 카카오톡인지 등)
- 발화자 구분 (A가 한 말 / B가 한 말 분리)
- 불필요한 UI 요소 제거 (버튼, 메뉴, 타임스탬프 등)
- 텍스트 정제 (오타 보정 포함)

**결과 포맷:**
```json
{
  "source_type": "community|game_chat|messenger|unknown",
  "utterances": [
    { "speaker": "A", "text": "...", "timestamp": "..." },
    { "speaker": "B", "text": "...", "timestamp": "..." }
  ],
  "raw_text": "전체 원문"
}
```

---

### 3. Classifier Agent (법적 쟁점 분류 에이전트)

**역할:** 추출된 텍스트에서 법적으로 문제 될 수 있는 행위 유형 분류

**입력:** OCR Agent 결과  
**출력:** 법적 쟁점 목록 및 관련 법령 카테고리

**수행 작업:**
- 텍스트에서 위법 가능 행위 식별
- 행위 유형을 법령 카테고리로 매핑

**분류 카테고리 (예시):**

| 행위 유형 | 관련 법령 |
|----------|---------|
| 명예훼손 | 형법 제307조, 정보통신망법 제70조 |
| 협박/공갈 | 형법 제283조, 제350조 |
| 모욕 | 형법 제311조 |
| 성희롱/성적 발언 | 성폭력처벌법, 양성평등기본법 |
| 개인정보 유출 | 개인정보보호법 제71조 |
| 사기 | 형법 제347조 |
| 스토킹 | 스토킹범죄처벌법 |
| 게임 내 사기/현금거래 | 게임산업진흥법 |
| 저작권 침해 | 저작권법 |

**결과 포맷:**
```json
{
  "issues": [
    {
      "type": "명예훼손",
      "severity": "high|medium|low",
      "keywords": ["키워드1", "키워드2"],
      "law_search_queries": ["명예훼손", "허위사실 적시"]
    }
  ],
  "is_criminal": true,
  "is_civil": true
}
```

---

### 4. Law Search Agent (법령 검색 에이전트)

**역할:** 분류된 쟁점에 해당하는 법령 조문 조회

**입력:** Classifier Agent 결과의 `law_search_queries`  
**출력:** 관련 법령 조문 목록

**수행 작업:**
- 국가법령정보 API로 법령 목록 검색
- 각 법령의 해당 조항 본문 조회
- 형량/과태료 등 처벌 조항 추출
- 친고죄/반의사불벌죄 여부 확인

**API 호출 흐름:**
```
1. GET /OC100101?query={검색어}  → 법령 목록
2. GET /OC100103?lawId={법령ID}  → 법령 본문
3. 해당 조항 파싱 (조문 번호, 내용, 처벌 규정)
```

**결과 포맷:**
```json
{
  "laws": [
    {
      "law_name": "형법",
      "article_no": "제307조",
      "article_title": "명예훼손",
      "content": "공연히 사실을 적시하여...",
      "penalty": "2년 이하 징역 또는 500만원 이하 벌금",
      "is_complaint_required": true,
      "url": "https://..."
    }
  ]
}
```

---

### 5. Precedent Search Agent (판례 검색 에이전트)

**역할:** 유사한 과거 판례 검색 및 결과 요약

**입력:** Classifier Agent 결과 + Law Search Agent 결과  
**출력:** 유사 판례 목록 및 요약

**수행 작업:**
- 국가법령정보 API로 판례 검색
- 사건 개요와의 유사도 기반 상위 N개 선별
- 판결 결과 (유죄/무죄, 선고 형량) 추출
- 법원 판단 이유 핵심 요약

**API 호출 흐름:**
```
1. GET /OC100201?query={키워드}&court={법원}  → 판례 목록
2. GET /OC100203?caseId={판례ID}             → 판례 본문
3. 판결 이유 및 결론 파싱
```

**결과 포맷:**
```json
{
  "precedents": [
    {
      "case_no": "2023도1234",
      "court": "대법원",
      "date": "2023-05-15",
      "summary": "피고인이 온라인 커뮤니티에...",
      "verdict": "유죄",
      "sentence": "벌금 300만원",
      "key_reasoning": "허위사실 적시의 고의가 인정되어...",
      "similarity_score": 0.87,
      "url": "https://..."
    }
  ]
}
```

---

### 6. Legal Analysis Agent (법적 판단 + 결과 포맷 에이전트)

**역할:** 수집된 법령 + 판례를 바탕으로 종합 법적 판단 생성 및 사용자용 결과 포맷 반환

**입력:** Classifier + Law Search + Precedent Agent 결과 전체  
**출력:** 구조화된 법적 분석 결과 + 프론트엔드 렌더링용 데이터

**수행 작업:**
- 고소 가능 여부 판단 (형사/민사 구분)
- 성립 가능한 혐의 목록 및 각 혐의별 성립 요건 대조
- 유사 판례 기준 예상 처벌 범위 산출
- 친고죄 여부 → 피해자 고소 필요 여부 안내
- 증거 수집 권고사항 생성
- 면책 가능성 (위법성 조각 사유) 검토
- 비전문가도 이해할 수 있는 요약과 카드형 결과 데이터 생성

**결과 포맷:**
```json
{
  "summary": "현재 입력에서는 2건의 주요 법적 쟁점이 탐지되었습니다.",
  "can_sue": true,
  "risk_level": 4,
  "charges": [
    {
      "charge": "사이버 명예훼손",
      "basis": "정보통신망법 제70조 제1항",
      "elements_met": ["공연성 ✓", "허위사실 ✓", "비방 목적 △"],
      "probability": "high|medium|low",
      "expected_penalty": "3년 이하 징역 또는 3천만원 이하 벌금"
    }
  ],
  "recommended_actions": [
    "게시글 스크린샷 및 URL 보존",
    "작성자 IP 추적을 위한 임시처분 신청",
    "경찰서 사이버수사대 고소장 제출"
  ],
  "issue_cards": [
    {
      "title": "사이버 명예훼손",
      "basis": "정보통신망법 제70조 제1항",
      "probability": "high"
    }
  ],
  "precedent_cards": [
    {
      "case_no": "2023도1234",
      "court": "대법원",
      "verdict": "유죄"
    }
  ],
  "next_steps": ["증거 보존", "법률 상담 검토"],
  "disclaimer": "본 분석은 참고용이며 법적 효력이 없습니다..."
}
```

---

## 에이전트 실행 흐름 (시퀀스)

```
사용자 업로드
     │
     ▼
Orchestrator
     │
     ├──[이미지 입력]──► OCR Agent ──────────────────────────────────┐
     │                                                               │
     └──[텍스트 입력]──────────────────────────────────────────────► ▼
                                                           Classifier Agent
                                                                 │
                                          ┌──────────────────────┤
                                          ▼                      ▼
                                   Law Search Agent    (병렬 실행)
                                          │            Precedent Search Agent
                                          └──────────────────────┤
                                                                  ▼
                                                         Legal Analysis Agent
                                                                  │
                                                                  ▼
                                                           사용자 결과 화면
```

**병렬 실행:** Law Search Agent와 Precedent Search Agent는 동시 실행 가능  
**최종 구조:** Orchestrator 포함 총 6개 에이전트

---

## 프론트엔드 구성 (반응형 웹)

### 기술 스택 권장
- **Framework:** Next.js 14+ (App Router)
- **Styling:** Tailwind CSS
- **상태 관리:** Zustand 또는 React Query
- **실시간 진행 표시:** Server-Sent Events (SSE)
- **파일 업로드:** react-dropzone

### 주요 화면

#### 1. 입력 화면
- 드래그 앤 드롭 이미지 업로드 영역
- 직접 텍스트 입력 탭
- 분석 유형 선택 (커뮤니티 / 게임채팅 / 메신저 / 기타)

#### 2. 분석 진행 화면 (SSE 스트리밍)
```
[텍스트 추출 중...]      ✓ 완료
[법적 쟁점 분류 중...]   ⟳ 진행 중
[법령 검색 중...]        ○ 대기
[판례 검색 중...]        ○ 대기
[종합 분석 중...]        ○ 대기
```

#### 3. 결과 화면
- **위험도 게이지** (레벨 1~5, 색상 코드)
- **혐의 카드** (죄명 / 근거 법령 / 성립 가능성)
- **유사 판례** 카드 (사건번호 / 판결 / 요약)
- **권장 행동 체크리스트**
- **면책 고지** 배너

---

## 백엔드 API 구조

```
POST /api/analyze
  Body: { image?: File, text?: string, context_type: string }
  Response: { job_id: string }

GET /api/analyze/:job_id/stream  (SSE)
  Events:
    - agent_start: { agent: "ocr|classifier|law|precedent|analysis" }
    - agent_done:  { agent: "...", result: {...} }
    - complete:    { analysis: {...} }
    - error:       { message: "..." }

GET /api/analyze/:job_id
  Response: 최종 분석 결과 (완료된 경우)
```

---

## 환경 변수

```env
LAW_API_KEY=              # 국가법령정보 API 키
LAW_API_BASE_URL=https://open.law.go.kr/LSO/openApi/
OPENAI_API_KEY=           # Vision/LLM 모델용 (또는 다른 모델)
REDIS_URL=                # 작업 큐 및 캐싱
```

---

## 캐싱 전략

| 데이터 | 캐시 TTL | 이유 |
|--------|---------|------|
| 법령 본문 | 24시간 | 법령은 자주 바뀌지 않음 |
| 판례 검색 결과 | 12시간 | 새 판례 추가 속도 느림 |
| OCR 결과 | 세션 동안 | 동일 이미지 재분석 방지 |
| 분석 결과 | 1시간 | 동일 텍스트 재요청 대응 |

---

## 주요 고려사항

### 법적 면책
- 모든 결과 화면에 **"본 서비스는 법률 정보 제공 목적이며, 법적 효력이 없습니다. 구체적인 법률 조언은 변호사에게 문의하세요."** 문구 필수 표시
- 결과를 캡처하거나 공유할 때 면책 문구 포함

### 개인정보
- 업로드된 이미지는 분석 후 즉시 삭제 (서버 저장 금지)
- 개인 식별 정보(얼굴, 이름, 연락처)는 OCR 결과에서 마스킹 처리

### 오남용 방지
- Rate Limiting (IP당 일 10회)
- 악성 콘텐츠(아동 성착취 등) 탐지 시 분석 거부

---

## 개발 우선순위 (Phase)

### Phase 1 — MVP
- [ ] OCR Agent (텍스트 입력만 지원)
- [ ] Classifier Agent (기본 5개 유형)
- [ ] Law Search Agent (법령 API 연동)
- [ ] 기본 결과 화면

### Phase 2 — 판례 연동
- [ ] Precedent Search Agent
- [ ] Legal Analysis Agent
- [ ] SSE 진행 상황 스트리밍

### Phase 3 — 이미지 지원 + 고도화
- [ ] OCR Agent (이미지 업로드)
- [ ] 위험도 시각화
- [ ] 모바일 최적화
