# Booking & Client Portal Platform

Work in progress. A multi-tenant booking platform for service businesses: online booking with instant
quotes and deposits, a client portal, a crew app, an admin console and an AI assistant that books
through the same server rules. The demo business is fictional.

## Local development

Requirements: Node.js 24, Docker Desktop.

```bash
npm install
npm run db:start      # local Supabase in Docker
cp .env.example .env.local   # then fill in values from `npm run db:status`
npm run dev           # http://localhost:3000
```

Checks:

```bash
npm run check         # typecheck, lint, format check, unit tests
```
