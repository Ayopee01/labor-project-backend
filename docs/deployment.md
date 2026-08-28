# Deployment

The shared development/test environment is deployed to Render.

This environment is intended for:

- Backend development
- Frontend integration
- Postman testing
- LINE OA webhook testing
- WebSocket testing
- Integration testing
- QA
- Feature demonstrations

This Render environment is not the final production environment.

## Deployment Architecture

```text
Developer
    |
    | git push
    v
GitHub Repository
    |
    v
GitHub Actions CI
    |
    | CI checks pass
    v
Render
    |
    |-- Backend Web Service
    |-- PostgreSQL
    `-- Key Value / Redis-compatible datastore