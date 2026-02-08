# Mongo Backend

A lightweight Hono + MongoDB service that exposes API endpoints suitable for API gateway fan-out and aggregation.

## Getting Started

1. Duplicate `.env.example` to `.env` and update the values.
2. Install dependencies with `pnpm install`.
3. Run the development server:
   ```bash
   pnpm dev
   ```
4. Build for production with `pnpm build` and run `pnpm start`.

## API

- `GET /health` – Pings MongoDB and returns readiness info.
- `GET /records` – Lists records with optional `limit`, `skip`, `q`, and `collection` parameters.
- `POST /records/query` – Accepts a JSON body with `filter`, `projection`, `sort`, `limit`, `skip`, and optional `collection` to support API gateway-driven queries.

All endpoints are CORS-enabled to make them easy to wire behind gateways or edge functions.
