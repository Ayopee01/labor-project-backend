# Backend API Structure

Backend Express API for labor/user management. During development the API runs
locally with `npm run dev`, while PostgreSQL runs as a local database service.
Prisma owns the database schema, migrations, seed, and database client.

## Stack

- Node.js
- Express.js
- PostgreSQL
- Prisma ORM
- TypeScript compiled to CommonJS

## Development Setup

```bash
npm install
copy .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

The server listens on `PORT` or `8080`.
Create a local PostgreSQL database first and set `DATABASE_URL` in `.env`.

Default seed admin:

- username: `admin`
- password: `Admin@123456`

The seed account is hardcoded in `prisma/seed.ts` because it is only for local
development/testing.

## Development Runtime

```text
labor-project
  |- npm run dev       Express API
  |- PostgreSQL        local database service
  `- Prisma            schema, migration, seed, client
```

Useful commands:

```bash
npm run db:migrate
npm run db:seed
npm run db:studio
npm run build
npm test
```

Production migration command:

```bash
npm run db:deploy
```

`npm test` runs tests that do not need a database. To run DB-backed service
smoke tests:

```bash
RUN_DB_TESTS=1 npm test
```

On Windows PowerShell:

```powershell
$env:RUN_DB_TESTS="1"; npm test
```

## Routes

### Auth

- `POST /api/auth/login`
- `POST /api/auth/login/confirm-force`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Admin Users

- `POST /api/admin/users`
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `PATCH /api/admin/users/:id/password`
- `PATCH /api/admin/users/:id/status`
- `PATCH /api/admin/users/:id/work-schedule`
- `GET /api/admin/users/:id/work-schedule`
- `GET /api/admin/users/:id/work-schedules`

## File Layout

```text
prisma/
  schema.prisma
  seed.ts

src/
  app.ts
  db/
    prisma.ts
  docs/
    swagger.ts
    openapi/
  middlewares/
    auth.middleware.ts
    async-handler.middleware.ts
    error.middleware.ts
    role.middleware.ts
    session.middleware.ts
  repositories/
    account.repository.ts
    mapper.ts
    profile.repository.ts
    session.repository.ts
    work-schedule.repository.ts
  routes/
    auth.routes.ts
    system.routes.ts
    users.routes.ts
  services/
    auth.service.ts
    user.service.ts
  types/
    domain.ts
    express.d.ts
  utils/
    api-error.ts
    jwt.ts
    password.ts
    refresh-token-hash.ts
    shift.ts
```
