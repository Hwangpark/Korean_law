# Auth Setup

이 문서는 로컬 개발 환경에서 회원가입/로그인 흐름을 붙이기 위한 실전용 준비 절차다.

현재 저장소에는 TypeScript auth 서버와 React/Vite 프론트가 이미 들어가 있으며, 아래 절차대로 바로 실행해서 검증할 수 있다.

## 목표

- 사용자별 로그인을 전제로 세션 또는 토큰 기반 인증을 붙인다.
- 데이터 저장소는 Docker의 PostgreSQL을 사용한다.
- 로컬 PostgreSQL 비밀번호는 `park8948`을 사용한다.
- 사용자 회원가입 비밀번호는 `9자 이상 + 영문 + 숫자 + 특수문자` 조합을 강제한다.
- auth 스모크 테스트는 실행 중인 로컬 서버의 register/login 엔드포인트를 실제로 호출한다.
- React 프론트는 `apps/web`에서 `/auth/signup`, `/auth/login`, `/auth/me`와 직접 통신한다.

## PostgreSQL Docker 실행

가장 단순한 로컬 구성은 루트의 compose 스택을 쓰는 것이다.

```bash
npm install
npm run db:up
```

연결 문자열 예시는 다음과 같다.

```text
postgresql://park:park8948@127.0.0.1:5432/koreanlaw
```

전체 스택을 함께 띄우려면 다음을 사용한다.

```bash
npm run stack:up
```

이미 다른 PostgreSQL이 `5432`를 쓰고 있다면 다음처럼 포트를 바꿔 실행할 수 있다.

```bash
POSTGRES_PORT=5433 npm run stack:up
```

## 현재 auth 계약

백엔드는 다음 JSON API를 제공한다.

- 회원가입: `POST /auth/signup`
- 회원가입 alias: `POST /auth/register`, `POST /api/auth/signup`, `POST /api/auth/register`
- 로그인: `POST /auth/login`
- 로그인 alias: `POST /api/auth/login`
- 현재 사용자 확인: `GET /auth/me`
- 헬스체크: `GET /health`

권장 요청 바디:

```json
{
  "email": "user@example.test",
  "password": "Park8948!",
  "name": "Test User"
}
```

권장 응답:

- 회원가입은 `201`
- 로그인은 `200`
- 로그인 성공 시 `token`, `token_type`, `expires_in`, `issued_at`, `user`를 반환
- 호환성을 위해 camelCase 필드도 함께 반환한다.

## 로컬 세팅 순서

1. `.env.example`를 참고해 루트 `.env.local` 값을 맞춘다.
2. `npm install`로 루트 의존성을 설치한다.
3. `npm run db:up`로 PostgreSQL 컨테이너를 올린다.
4. `npm run dev:api`로 TypeScript auth 서버를 실행한다.
5. 별도 터미널에서 `npm run test:auth`로 회원가입과 로그인을 확인한다.
6. 프론트 확인이 필요하면 `npm run web:install && npm run dev:web`를 실행한다.

## 스모크 테스트 동작 방식

`scripts/test-auth.ts`는 다음을 수행한다.

- 실행 중인 로컬 서버에 register 요청을 보낸다.
- 같은 계정으로 login 요청을 보낸다.
- 로그인 응답이 토큰 또는 쿠키를 주는지 확인한다.

기본값은 다음과 같다.

- `AUTH_BASE_URL=http://127.0.0.1:3001`
- `AUTH_PASSWORD=Park8948!`
- `AUTH_REGISTER_PATHS=/api/auth/register,/api/register,/auth/register,/api/auth/signup,/auth/signup`
- `AUTH_LOGIN_PATHS=/api/auth/login,/api/login,/auth/login,/api/auth/signin`

payload shape가 다르면 아래 환경변수로 맞춘다.

- `AUTH_REGISTER_BODY_JSON`
- `AUTH_LOGIN_BODY_JSON`
- `AUTH_EMAIL_FIELD`
- `AUTH_PASSWORD_FIELD`
- `AUTH_NAME_FIELD`

예시:

```bash
AUTH_BASE_URL=http://127.0.0.1:3001 \
AUTH_REGISTER_BODY_JSON='{"email":"{{email}}","password":"{{password}}","name":"{{name}}"}' \
AUTH_LOGIN_BODY_JSON='{"email":"{{email}}","password":"{{password}}"}' \
npm run test:auth
```

## 주의점

- 이 문서의 `park8948`은 PostgreSQL 로컬 개발 전용이다.
- 공유 환경이나 운영 환경에서는 반드시 다른 비밀번호와 비밀 관리 체계를 써야 한다.
- CSRF 보호가 강하게 걸린 form 기반 auth라면, smoke test를 그 계약에 맞게 한 단계 더 맞춰야 한다.
