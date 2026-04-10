# apps/web

Vite + React + TypeScript frontend scaffold for KoreanLaw.

## What is here

- Homepage with a deliberate, non-generic landing layout
- Signup form wired to `POST /auth/signup`
- Login form wired to `POST /auth/login`
- Session revalidation through `GET /auth/me`
- Configurable auth base URL via `VITE_AUTH_BASE_URL` or the UI input
- Works with the root Docker Compose stack on `http://localhost:5173`

## Commands

```bash
npm --prefix apps/web install
npm --prefix apps/web run dev
npm --prefix apps/web run check
npm --prefix apps/web run build
```
