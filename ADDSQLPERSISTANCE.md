Plan to implement                                                       │
│                                                                         │
│ Plan: Add SQLite Persistence Layer                                      │
│                                                                         │
│ Context                                                                 │
│                                                                         │
│ F.R.I.D.A.Y.'s core engine currently has no persistence — tasks,        │
│ security events, and metrics are all in-memory or hardcoded to zeros.   │
│ better-sqlite3 is already a dependency but unused. The gateway has 3    │
│ stubbed API endpoints (GET /tasks, GET /tasks/:id, GET                  │
│ /security/events) returning empty data. The getMetrics() method in      │
│ SecureClaw returns placeholder zeros for task stats. This change adds a │
│  SQLite database layer to persist tasks, security events, and provide   │
│ real task metrics.                                                      │
│                                                                         │
│ Approach                                                                │
│                                                                         │
│ Create a single Database class that manages SQLite, then wire it into   │
│ the existing components. Follow the existing pattern from               │
│ AuditChainStorage (interface-based storage backends).                   │
│                                                                         │
│ Files to Create                                                         │
│                                                                         │
│ 1. packages/core/src/storage/database.ts — Main SQLite database class   │
│                                                                         │
│ Schema (3 tables):                                                      │
│                                                                         │
│ -- Tasks table (mirrors the Task type from @friday/shared)              │
│ CREATE TABLE IF NOT EXISTS tasks (                                      │
│   id TEXT PRIMARY KEY,                                                  │
│   correlation_id TEXT,                                                  │
│   parent_task_id TEXT,                                                  │
│   type TEXT NOT NULL,                                                   │
│   name TEXT NOT NULL,                                                   │
│   description TEXT,                                                     │
│   input_hash TEXT NOT NULL,                                             │
│   status TEXT NOT NULL DEFAULT 'pending',                               │
│   created_at INTEGER NOT NULL,                                          │
│   started_at INTEGER,                                                   │
│   completed_at INTEGER,                                                 │
│   duration_ms INTEGER,                                                  │
│   timeout_ms INTEGER NOT NULL,                                          │
│   result_success INTEGER,                                               │
│   result_output_hash TEXT,                                              │
│   result_error_code TEXT,                                               │
│   result_error_message TEXT,                                            │
│   result_error_recoverable INTEGER,                                     │
│   resources_json TEXT,          -- JSON blob for ResourceUsage          │
│   security_context_json TEXT NOT NULL  -- JSON blob for SecurityContext │
│ );                                                                      │
│                                                                         │
│ -- Security events table (mirrors SecurityEvent from @friday/shared)    │
│ CREATE TABLE IF NOT EXISTS security_events (                            │
│   id TEXT PRIMARY KEY,                                                  │
│   type TEXT NOT NULL,                                                   │
│   severity TEXT NOT NULL,                                               │
│   message TEXT NOT NULL,                                                │
│   user_id TEXT,                                                         │
│   ip_address TEXT,                                                      │
│   user_agent TEXT,                                                      │
│   resource TEXT,                                                        │
│   action TEXT,                                                          │
│   details_json TEXT,                                                    │
│   timestamp INTEGER NOT NULL,                                           │
│   acknowledged INTEGER NOT NULL DEFAULT 0,                              │
│   acknowledged_by TEXT,                                                 │
│   acknowledged_at INTEGER                                               │
│ );                                                                      │
│                                                                         │
│ -- Indexes                                                              │
│ CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);           │
│ CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);   │
│ CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);               │
│ CREATE INDEX IF NOT EXISTS idx_security_events_severity ON              │
│ security_events(severity);                                              │
│ CREATE INDEX IF NOT EXISTS idx_security_events_timestamp ON             │
│ security_events(timestamp);                                             │
│ CREATE INDEX IF NOT EXISTS idx_security_events_type ON                  │
│ security_events(type);                                                  │
│                                                                         │
│ Class API:                                                              │
│ export class Database {                                                 │
│   constructor(dbPath: string)  // Uses better-sqlite3                   │
│   initialize(): void           // Creates tables + indexes              │
│   close(): void                                                         │
│                                                                         │
│   // Tasks                                                              │
│   insertTask(task: Task): void                                          │
│   updateTask(task: Task): void                                          │
│   getTask(id: string): Task | null                                      │
│   listTasks(opts: { status?: string; limit?: number; offset?: number    │
│ }): { tasks: Task[]; total: number }                                    │
│   getTaskMetrics(): TaskMetrics  // Aggregation query for getMetrics()  │
│                                                                         │
│   // Security Events                                                    │
│   insertSecurityEvent(event: SecurityEvent): void                       │
│   listSecurityEvents(opts: { severity?: string; limit?: number }): {    │
│ events: SecurityEvent[]; total: number }                                │
│   getSecurityMetrics(): Partial<SecurityMetrics>  // Counts by          │
│ severity/type                                                           │
│ }                                                                       │
│                                                                         │
│ 2. packages/core/src/storage/sqlite-audit-storage.ts — SQLite-backed    │
│ AuditChainStorage                                                       │
│                                                                         │
│ Implements the existing AuditChainStorage interface so it can replace   │
│ InMemoryAuditStorage:                                                   │
│                                                                         │
│ export class SqliteAuditStorage implements AuditChainStorage {          │
│   constructor(db: BetterSqlite3.Database)                               │
│   // Implements: append, getLast, iterate, count, getById               │
│ }                                                                       │
│                                                                         │
│ This reuses the same database connection from Database but creates its  │
│ own audit_entries table.                                                │
│                                                                         │
│ Files to Modify                                                         │
│                                                                         │
│ 3. packages/core/src/secureclaw.ts                                      │
│                                                                         │
│ - Add Database as a new component initialized in step 2 (after config,  │
│ before logger)                                                          │
│ - Use config.core.dataDir for the DB path (e.g.,                        │
│ ${dataDir}/secureclaw.db)                                               │
│ - Pass Database to TaskExecutor so it can persist tasks                 │
│ - Pass SqliteAuditStorage as the default auditStorage (instead of       │
│ InMemoryAuditStorage)                                                   │
│ - Update getMetrics() to call db.getTaskMetrics() and                   │
│ db.getSecurityMetrics() instead of returning zeros                      │
│ - Wire rate limiter stats into security metrics                         │
│ - Close DB in cleanup()                                                 │
│                                                                         │
│ 4. packages/core/src/task/executor.ts                                   │
│                                                                         │
│ - Accept optional Database in constructor/createTaskExecutor            │
│ - After task creation (line ~197), call db.insertTask(task)             │
│ - After task completion/failure (lines ~305, ~340), call                │
│ db.updateTask(task)                                                     │
│ - After cancellation, call db.updateTask(task)                          │
│                                                                         │
│ 5. packages/core/src/gateway/server.ts                                  │
│                                                                         │
│ - Accept Database in GatewayServerOptions                               │
│ - GET /api/v1/tasks — call db.listTasks() with query params             │
│ - GET /api/v1/tasks/:id — call db.getTask(id)                           │
│ - GET /api/v1/security/events — call db.listSecurityEvents() with query │
│  params                                                                 │
│                                                                         │
│ 6. packages/core/src/index.ts                                           │
│                                                                         │
│ - Export Database, SqliteAuditStorage from storage module               │
│                                                                         │
│ Implementation Order                                                    │
│                                                                         │
│ 1. Create packages/core/src/storage/database.ts — schema + CRUD +       │
│ metrics queries                                                         │
│ 2. Create packages/core/src/storage/sqlite-audit-storage.ts —           │
│ AuditChainStorage impl                                                  │
│ 3. Modify packages/core/src/task/executor.ts — accept DB, persist task  │
│ lifecycle                                                               │
│ 4. Modify packages/core/src/gateway/server.ts — implement the 3 TODO    │
│ endpoints                                                               │
│ 5. Modify packages/core/src/secureclaw.ts — wire DB into                │
│ initialization, metrics, shutdown                                       │
│ 6. Update packages/core/src/index.ts — add exports                      │
│                                                                         │
│ Key Design Decisions                                                    │
│                                                                         │
│ - SQLite (not Postgres): Already a dependency, fits the local-first     │
│ philosophy, zero config                                                 │
│ - Flat columns for tasks (not pure JSON blob): Enables indexed queries  │
│ on status/type/timestamps                                               │
│ - JSON blobs for nested objects (resources, securityContext, details):  │
│ These are read-as-whole, no need to query individual fields             │
│ - Synchronous API: better-sqlite3 is synchronous which is actually      │
│ faster for SQLite — no need for async wrappers except where the         │
│ existing interfaces require it (AuditChainStorage)                      │
│ - DB path from config: Uses existing core.dataDir setting, defaults to  │
│ ~/.secureclaw/data/secureclaw.db                                        │
│                                                                         │
│ Verification                                                            │
│                                                                         │
│ 1. cd packages/core && npx tsc --noEmit — verify no type errors         │
│ 2. Inspect that GET /api/v1/tasks, GET /api/v1/tasks/:id, GET           │
│ /api/v1/security/events no longer return stubs                          │
│ 3. Verify getMetrics() returns real aggregated task data from the DB    │
│ 4. Confirm InMemoryAuditStorage is still available but                  │
│ SqliteAuditStorage is the new default
