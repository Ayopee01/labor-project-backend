# Backend API Structure

Backend Express API for labor/user management.

The project supports two development modes:

- Local development on a developer machine
- Shared development/test deployment on Render

The shared Render environment provides a single public Backend Base URL for:

- Frontend integration
- Postman testing
- LINE OA webhook testing
- WebSocket testing
- Integration testing

Prisma owns the PostgreSQL schema, migrations, seed, and database client.

## Stack

- Node.js
- Express.js
- PostgreSQL
- Redis / Redis-compatible Key Value
- BullMQ
- Prisma ORM
- TypeScript compiled to CommonJS
- Docker
- GitHub Actions CI
- Render for shared development/test deployment

## Local Development Setup

Install dependencies:

```bash
npm install