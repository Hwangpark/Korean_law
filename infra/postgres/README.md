# Local PostgreSQL

This folder contains the local PostgreSQL setup used for development and the shared Docker stack.

## Required environment

Use the root `.env.local` file as the source of truth for compose. `infra/postgres/.env.example` is a reference snapshot of the required PostgreSQL variables. The shared local-development password is `park8948`.

Optional overrides:

- `POSTGRES_DB` defaults to `koreanlaw`
- `POSTGRES_USER` defaults to `park`
- `POSTGRES_PORT` defaults to `5432`

## Start

```bash
npm run db:up
```

To start the collaborative local stack, including the TypeScript auth API, React web app, and Adminer:

```bash
npm run stack:up
```

If host port `5432` is already occupied, override it without changing the compose file:

```bash
POSTGRES_PORT=5433 npm run stack:up
```

## Notes

- Data is persisted in the named volume `postgres_data`.
- The API container reaches PostgreSQL through the shared compose network at `postgres:5432`.
- The web container runs the Vite React + TypeScript shell on `http://localhost:5173`.
- Adminer is available at `http://localhost:8080` for collaborative inspection.
- SQL files in `infra/postgres/init/` run only on first database initialization.
