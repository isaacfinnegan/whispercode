# AGENTS.md
This is the root operating guide for agentic coding assistants in this repository.
Scope: entire repo unless a deeper `AGENTS.md` exists in a subdirectory.

## Quick Rules (Read First)
- Use Bun 1.3.x (`packageManager` is `bun@1.3.9`).
- Run commands from repo root with `bun run --cwd <package> ...` when possible.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Default branch is `dev`; local `main` may not exist.
- Prefer automation: execute requested actions unless blocked by missing info or safety concerns.
- Do not run tests from repo root (`bun test` intentionally fails).
- `bunfig.toml` sets test root to `./do-not-run-tests-from-root`.
- To regenerate the JS SDK, run `./packages/sdk/js/script/build.ts`.
- If API/SDK surface changes, run `./script/generate.ts`.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Repo Map
- `packages/opencode`: core CLI, runtime, server, and TUI.
- `packages/app`: SolidJS app and unit/e2e tests.
- `packages/desktop`: Tauri desktop wrapper.
- `packages/android`, `packages/ios`: mobile wrappers.
- `packages/ui`: shared UI components/context/theme.
- `packages/sdk/js`: TypeScript SDK.
- `packages/plugin`, `packages/util`, `packages/function`: shared logic.
- `packages/console/*`: console app/core/function/resource/mail.
- `packages/web`: Astro docs/site package.
- `sdks/vscode`: VS Code extension.

## Setup And Dev
```bash
bun install
bun dev
bun dev --help
bun dev serve --port 4096
bun run --cwd packages/app dev
bun run --cwd packages/desktop tauri dev
```
- `bun dev` is the local equivalent of `opencode`.
- For CLI/TUI work: `bun dev <directory>` or `bun dev .`.

## Build, Typecheck, Lint
```bash
# repo-wide typecheck
bun run typecheck

# common builds
bun run --cwd packages/opencode build
bun run --cwd packages/app build
bun run --cwd packages/desktop build
bun run --cwd packages/android build
bun run --cwd packages/ios build
bun run --cwd packages/web build
bun run --cwd packages/enterprise build
bun run --cwd packages/plugin build
bun run --cwd packages/sdk/js build
bun run --cwd packages/console/app build

# lint/type checks
bun run --cwd packages/opencode lint
bun run --cwd sdks/vscode lint
bun run --cwd sdks/vscode check-types
```
- There is no single repo-wide `lint` script at root.
- Root formatting defaults: no semicolons, `printWidth: 120`, 2-space indent, LF endings.
- Format ad hoc with `bunx prettier --write <paths>`.

## Test Commands (Including Single-Test Runs)
- Never run tests from repo root; use package `--cwd`.

### `packages/opencode` (Bun tests)
```bash
bun run --cwd packages/opencode test
bun run --cwd packages/opencode test -- test/tool/bash.test.ts
bun run --cwd packages/opencode test -- test/tool/bash.test.ts -t "times out"
```

### `packages/app` unit tests (Bun + Happy DOM)
```bash
bun run --cwd packages/app test
bun run --cwd packages/app test:unit
bun run --cwd packages/app test:unit -- ./src/utils/server-health.test.ts
bun run --cwd packages/app test:unit -- -t "reports healthy"
# direct equivalent
bun test --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts
```

### `packages/app` e2e tests (Playwright)
```bash
bun run --cwd packages/app test:e2e
bun run --cwd packages/app test:e2e -- e2e/app/home.spec.ts
bun run --cwd packages/app test:e2e -- -g "home renders and shows core entrypoints"
bun run --cwd packages/app test:e2e:ui
bun run --cwd packages/app test:e2e:report
```

### `sdks/vscode` tests
```bash
bun run --cwd sdks/vscode test
```

## Code Style Guidelines
### General Naming And Structure
- Keep things in one function unless composable or reusable.
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Naming: Prefer concise names; single-word identifiers are preferred when still clear (`camelCase` for vars/functions, `PascalCase` for types/components, `SCREAMING_SNAKE_CASE` for constants).
- Prefer `const` over `let`. Use ternaries or early returns instead of reassignment/else blocks.
- Avoid unnecessary destructuring; `obj.field` is often clearer.
- Avoid using the `any` type; prefer precise types or inference.
- Add explicit annotations at exported/public boundaries.
- Use type guards in narrowing/filter paths to preserve downstream inference.
- Prefer Bun APIs when they are a natural fit (`Bun.file()`, etc.).
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

### Imports
- Keep imports at top of file.
- Prefer explicit type imports (`import type { Foo } from "..."`) when possible.
- Use configured aliases where available (`@/*`, `@tui/*`) instead of deep relative paths.
- In `packages/app/e2e`, import `test`/`expect` from `../fixtures`, not `@playwright/test`.
- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Formatting
- Follow Prettier and existing file formatting; do not hand-format inconsistently.
- No semicolons; 2 spaces; LF; UTF-8; keep lines readable (Prettier width 120).
- Minimize non-essential comments; prefer clear naming and structure.

### Error Handling
- Avoid `try/catch` when a clearer pattern exists.
- Prefer explicit checks, early exits, and `.catch(...)` where it improves clarity.
- Return/throw errors with useful context for debugging.

### Complex Logic
When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

### Testing Style
- Prefer testing real behavior over heavy mocks.
- Keep tests focused and avoid duplicating implementation logic in assertions.
- Use reusable fixtures/helpers.
- In `packages/opencode` tests, use `tmpdir` with `await using` for automatic cleanup.
- In e2e, prefer `data-component`/`data-action` selectors or semantic roles.
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

### Database Style (`packages/opencode`)
- Drizzle schema files: `src/**/*.sql.ts`.
- Naming: snake_case for tables/columns; join keys `<entity>_id`.
- Index naming: `<table>_<column>_idx`.
- Generate migrations with `bun run db generate --name <slug>`.

## Package-Specific Rules
- `packages/app`: NEVER restart the app/server process manually during debugging.
- `packages/app`: for local UI changes, run both:
  - Backend: `bun run --cwd packages/opencode --conditions=browser ./src/index.ts serve --port 4096`
  - App: `bun run --cwd packages/app dev -- --port 4444`
- `packages/app`: prefer `createStore` over many `createSignal` calls.
- `packages/desktop`: never call Tauri `invoke` directly; use `packages/desktop/src/bindings.ts`.

## Type Checking
- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## Cursor/Copilot Rules
- No `.cursorrules` file found.
- No `.cursor/rules/` directory found.
- No `.github/copilot-instructions.md` found.
- If added later, treat them as authoritative and merge into this guide.

## V2 Session Core
- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash activity recovery requires a separate explicit design before it may retry provider work.
- Keep delivery vocabulary explicit. Prompts steer by default and coalesce into the active activity at the next safe provider-turn boundary. Explicit `queue` inputs open FIFO future activities one at a time after the active activity settles.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.
