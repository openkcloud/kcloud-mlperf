<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-21 | Updated: 2026-04-21 -->

# server/src

## Purpose
NestJS application source code. Organized by feature modules (MLPerf exams, MMLU exams, results) with shared infrastructure (entities, enums, DTOs, interceptors, filters). Communicates with PostgreSQL via TypeORM and with an external LLM evaluation service via gRPC.

## Key Files

| File | Description |
|------|-------------|
| `main.ts` | App bootstrap — creates NestJS app with gRPC microservice transport |
| `app.module.ts` | Root module — imports TypeORM, Config, Schedule, and all feature modules |
| `app.controller.ts` | Root controller with health/status endpoints |
| `app.service.ts` | Root service |
| `app.controller.spec.ts` | Unit test for root controller |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `entities/` | TypeORM entity definitions: `MpExam`, `MpExamResult`, `MmExam`, `MmExamResult` |
| `enums/` | Shared enums: exam status, test scenarios, exam modes — keep in sync with `web/src/enums/` |
| `common-dto/` | Shared DTOs: pagination params, settings |
| `mp-exam/` | MLPerf exam module: controller, service, DTOs (create, update, query) |
| `mp-exam-result/` | MLPerf result module: controller, service, DTOs |
| `mm-exam/` | MMLU exam module: controller, service, DTOs |
| `mm-exam-result/` | MMLU result module: controller, service, DTOs |
| `files/` | File upload/download module for exam packages and results |
| `grpc-client/` | gRPC client module — wraps communication with external evaluation service |
| `loki/` | Loki logging integration module |
| `interceptors/` | NestJS interceptors: error formatting, request logging, response transformation |
| `filters/` | HTTP exception filters for consistent error responses |

## For AI Agents

### Working In This Directory
- Each feature module follows NestJS convention: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/` subfolder
- Entities in `entities/` define the database schema — changes require migration or `synchronize: true` in dev
- Enums in `enums/` are shared with the frontend — any changes must be mirrored in `web/src/enums/`
- DTOs use `class-validator` decorators — always add validation to new fields
- gRPC proto is in `../proto/exam.proto` — generated types in `../proto-types/`

### Testing Requirements
- Unit tests: `*.spec.ts` files alongside source files
- Test each module's service independently by mocking TypeORM repositories
- E2E tests in `../test/` directory

### Common Patterns
- Module pattern: `@Module({ controllers: [...], providers: [...], imports: [...] })`
- Repository injection: `@InjectRepository(Entity)` in services
- DTO validation: `class-validator` decorators + `ValidationPipe` in main.ts
- Pagination: shared `common-dto/` pagination params reused across all list endpoints
- Response transformation via interceptors (not in controllers)

## Dependencies

### Internal
- `entities/` ← imported by all feature modules for repository injection
- `enums/` ← imported by DTOs and services for type safety
- `common-dto/` ← imported by feature module DTOs for pagination
- `grpc-client/` ← imported by exam modules for triggering evaluations
- `loki/` ← imported by modules needing log shipping

### External
- @nestjs/core, @nestjs/common, @nestjs/config
- @nestjs/typeorm + typeorm + pg (PostgreSQL)
- @grpc/grpc-js + @nestjs/microservices
- class-validator, class-transformer
- @nestjs/schedule (cron jobs)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
