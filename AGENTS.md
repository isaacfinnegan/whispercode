# AGENTS.md

- To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit `src/generated` or `src/generated-effect` directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

Root guide for agentic coding assistants working in this repository.
Scope: applies to the whole repo unless a deeper `AGENTS.md` exists.

## Quick Rules

- Use Bun `1.3.10` (`packageManager` is `bun@1.3.10`)
- Default branch is `dev`; local `main` may not exist
- Prefer `bun run --cwd <package> ...` from repo root
- Use parallel tool calls when tasks do not depend on each other
- Prefer automation: do the work unless blocked by missing info or safety concerns
- Do not run tests from repo root; `bunfig.toml` points tests at `./do-not-run-tests-from-root`
- `bun dev` is the local equivalent of `opencode`; for CLI or TUI work use `bun dev .` or `bun dev <dir>`
- If API or SDK surface changes, run `./script/generate.ts`
- To regenerate the JS SDK, run `./packages/sdk/js/script/build.ts`

## Respect Deeper Guides

More specific instructions exist and override this file:

- `packages/app/AGENTS.md`
- `packages/app/e2e/AGENTS.md`
- `packages/desktop/AGENTS.md`
- `packages/desktop-electron/AGENTS.md`
- `packages/opencode/AGENTS.md`
- `packages/opencode/test/AGENTS.md`

## Repo Map

- `packages/opencode`: core CLI, runtime, server, and TUI - DO NOT MODIFY THIS PACKAGE
- `packages/app`: Solid app with unit and e2e tests
- `packages/desktop`, `packages/desktop-electron`: desktop wrappers
- `packages/ios`, `packages/android`: mobile wrappers
- `packages/ui`, `packages/storybook`, `packages/web`: UI primitives, previews, and docs site
- `packages/sdk/js`, `sdks/vscode`: TypeScript SDK and VS Code extension
- `packages/plugin`, `packages/util`, `packages/function`, `packages/push`, `packages/push-relay`: shared logic and push services
- `packages/console/*`: console app, core, function, resource, and mail

## Commands

```bash
# setup and dev
bun install
bun dev
bun dev --help
bun dev serve --port 4096
bun run --cwd packages/app dev
bun run --cwd packages/desktop tauri dev

# repo-wide typecheck
bun run typecheck

# common builds
bun run --cwd packages/opencode build
bun run --cwd packages/app build
bun run --cwd packages/desktop build
bun run --cwd packages/desktop-electron build
bun run --cwd packages/android build
bun run --cwd packages/ios build
bun run --cwd packages/web build
bun run --cwd packages/enterprise build
bun run --cwd packages/plugin build
bun run --cwd packages/sdk/js build
bun run --cwd packages/console/app build

# lint and checks
bun run --cwd packages/opencode lint
bun run --cwd sdks/vscode lint
bun run --cwd sdks/vscode check-types
bunx prettier --write <paths>

# tests: packages/opencode
bun run --cwd packages/opencode test
bun run --cwd packages/opencode test -- test/tool/bash.test.ts
bun run --cwd packages/opencode test -- test/tool/bash.test.ts -t "times out"

# tests: packages/app unit
bun run --cwd packages/app test:unit
bun run --cwd packages/app test:unit -- ./src/utils/server-health.test.ts
bun run --cwd packages/app test:unit -- -t "reports healthy"

# from packages/app when you need raw Bun control
bun test --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts

# tests: packages/app e2e
bun run --cwd packages/app test:e2e
bun run --cwd packages/app test:e2e -- e2e/app/home.spec.ts
bun run --cwd packages/app test:e2e -- -g "home renders and shows core entrypoints"
bun run --cwd packages/app test:e2e:local
bun run --cwd packages/app test:e2e:ui
bun run --cwd packages/app test:e2e:report

# tests: run from packages/push
bun test src
bun test src/relay.test.ts
bun test src/relay.test.ts -t "relay"

# tests: run from packages/push-relay
bun test src
bun test src/server.test.ts
bun test src/server.test.ts -t "server"

# tests: sdks/vscode
bun run --cwd sdks/vscode test
```

- There is no single repo-wide lint script at root
- `packages/opencode`'s `lint` script is a repo check, not a standalone ESLint run
- Prefer the narrowest test command that proves the change; start with a file or test-name filter
- No dedicated single-file wrapper was found for `sdks/vscode`; use the package test harness as-is unless you add one

## Code Style Guidelines

- **Imports**: keep imports at the top; prefer `import type`; use aliases such as `@/*` and `@tui/*` when available; in `packages/app/e2e` import `test` and `expect` from `../fixtures`, not `@playwright/test`
- **Formatting**: follow existing formatting and Prettier output; no semicolons; `printWidth` is `120`; use 2-space indentation, LF endings, and UTF-8; keep comments minimal and only for non-obvious logic
- **Types**: avoid `any`; prefer precise types or inference; add explicit types at public or exported boundaries; use type guards when narrowing helps inference; prefer Bun APIs when they are a natural fit
- **Naming**: prefer concise names; use single-word names for locals, params, and helpers unless clarity suffers; avoid long camelCase compounds when a short clear name exists; use `camelCase` for values, `PascalCase` for types/components, `SCREAMING_SNAKE_CASE` for constants, and `snake_case` for DB schema names
- **Structure**: prefer `const` over `let`; prefer early returns over nested `else`; avoid unnecessary destructuring when `obj.field` is clearer; split code only when reuse or readability clearly improves; in `packages/app`, prefer `createStore` over many `createSignal` calls
- **Error handling**: avoid `try/catch` when a clearer flow exists; prefer explicit checks and early exits; use `.catch(...)` when it improves readability; return or throw errors with enough context to debug
- **Testing style**: prefer real behavior over heavy mocks; keep tests focused; reuse fixtures and helpers; in `packages/opencode` tests use `await using` with `tmpdir`; in e2e use `data-component`, `data-action`, or semantic roles; in app e2e prefer `withSession`, `trackSession`, and `trackDirectory` for cleanup
- **Function design**: Keep things in one function unless composable or reusable. Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- **Array methods**: Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream.
- **Config modules**: In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.
- **Effect generators**: In Effect generators, bind services to named variables before calling methods. Do not use nested service yields such as `yield* (yield* Foo.Service).bar()`.

## Package-Specific Rules

- `packages/app`: never restart the app or server process manually during debugging
- `packages/app`: `opencode dev web` proxies `https://app.opencode.ai`, so local UI or CSS changes will not show there; for local UI work run backend `bun run --cwd packages/opencode --conditions=browser ./src/index.ts serve --port 4096` and app `bun run --cwd packages/app dev -- --port 4444`
- `packages/desktop`: do not call Tauri `invoke` directly; use `packages/desktop/src/bindings.ts`
- `packages/desktop-electron`: renderer code should use `window.api` from preload; main IPC handlers belong in `src/main/ipc.ts`
- `packages/opencode`: Drizzle schema files live in `src/**/*.sql.ts`; use `<entity>_id` for join keys and `<table>_<column>_idx` for DB index names. Use snake_case for field names so column names don't need to be redefined as strings. For example:

  ```ts
  // Good
  const table = sqliteTable("session", {
    id: text().primaryKey(),
    project_id: text().notNull(),
    created_at: integer().notNull(),
  })

  // Bad
  const table = sqliteTable("session", {
    id: text("id").primaryKey(),
    projectID: text("project_id").notNull(),
    createdAt: integer("created_at").notNull(),
  })
  ```

- `packages/ios`: if asked to push, release, or upload an iOS build, default to `bun run --cwd packages/ios beam`; it uploads a private TestFlight build, not a public App Store release

## Mobile Fork And Assistant Rules

- This repo is a mobile fork of `sst/opencode`; preserve `packages/ios`, `packages/android`, and mobile platform/resume/storage/share/voice integrations in `packages/app` when merging upstream
- No `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` files were found
- If any of those files appear later, treat them as authoritative and merge them with this guide

## Environment, Dependency, and Merge Rules

- **Bun and Rust PATH**: Prepends `/Users/isaac/.bun/bin` and `/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin` to `PATH` for build tasks, test runs, and git hooks to avoid toolchain version conflicts and command-not-found errors.
- **Ghostty-web Dependency**: Pin `"ghostty-web"` to a stable commit hash in `packages/app/package.json` (like `"github:anomalyco/ghostty-web#20bd361"`) to prevent GitHub download timeouts on `bun install`.
- **Android Version Sync**: Sync the workspace version prefix from `packages/app/package.json` to `packages/android/package.json` using `bun run script/sync-android-version.ts`. Do not skip git hooks (`post-merge` and `post-rewrite`) which run this automatically.
- **Build and Install verification**: Always use the `./packages/android/build-and-install.sh` shell script to compile and install the CLI binary, rebuild the frontend, and package the Android APK to ensure correct paths, environment setups, and binary local installs.
- **Upstream Merge Conflicts**:
  - Keep upstream files clean by returning `null` (e.g., in `help-button.tsx`) rather than deleting them from the file system, minimizing merge conflicts.
  - Discard conflicting non-English `README.*.md` translation files and retain the WhisperCode-specific English documentation.

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **whispercode** (51398 symbols, 106302 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "dev"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource                                     | Use for                                  |
| -------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/whispercode/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/whispercode/clusters`       | All functional areas                     |
| `gitnexus://repo/whispercode/processes`      | All execution flows                      |
| `gitnexus://repo/whispercode/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
