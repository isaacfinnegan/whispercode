# Self-Hosted Local UI and Dev Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable self-hosted local serving of UI static assets when `packages/app/dist` exists during development, and support custom proxy targets via the `OPENCODE_UI_UPSTREAM` environment variable.

**Architecture:** Update the HTTP API UI serving middleware to check for local built frontend assets under `packages/app/dist` (or a custom path defined by `OPENCODE_LOCAL_DIST_PATH`) before falling back to proxying. Convert the hardcoded upstream URL into a dynamic helper checking `OPENCODE_UI_UPSTREAM` to support customizable proxying/live-reloading.

**Tech Stack:** TypeScript, Bun, Effect-TS (`effect`), `@opencode-ai/core/fs-util`

---

### Task 1: Write Failing Tests for Custom Proxy Target and Local Dist Fallback

**Files:**
- Modify: `packages/opencode/test/server/httpapi-ui.test.ts`
- Test: `packages/opencode/test/server/httpapi-ui.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following two tests at the end of the `describe("HttpApi UI fallback", ...)` block in `packages/opencode/test/server/httpapi-ui.test.ts`:

```typescript
  it.live("respects custom OPENCODE_UI_UPSTREAM proxy target", () =>
    Effect.gen(function* () {
      let proxiedUrl: string | undefined
      const originalUpstream = process.env.OPENCODE_UI_UPSTREAM
      process.env.OPENCODE_UI_UPSTREAM = "https://custom.opencode-dev.ai"

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (originalUpstream) {
            process.env.OPENCODE_UI_UPSTREAM = originalUpstream
          } else {
            delete process.env.OPENCODE_UI_UPSTREAM
          }
        }),
      )

      const response = yield* uiApp({
        disableEmbeddedWebUi: true,
        client: httpClient(
          new Response("<html>custom</html>", { headers: { "content-type": "text/html" } }),
          (request) => {
            proxiedUrl = request.url
          },
        ),
      }).request("/")

      expect(response.status).toBe(200)
      expect(yield* responseText(response)).toBe("<html>custom</html>")
      expect(proxiedUrl).toBe("https://custom.opencode-dev.ai/")
    }),
  )

  it.live("falls back to local dist assets if index.html exists", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const nodePath = require("node:path")

      // Create a temporary directory structure for testing local dist fallback
      const tempDist = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const dir = `/tmp/opencode-test-dist-${Math.random().toString(36).slice(2)}`
          return dir
        }),
        (dir) => fs.remove(dir, { recursive: true }).pipe(Effect.orDie),
      )

      yield* fs.makeDirectory(tempDist, { recursive: true })
      yield* fs.writeFileString(nodePath.join(tempDist, "index.html"), "<html>local html</html>")
      yield* fs.writeFileString(nodePath.join(tempDist, "script.js"), "console.log('local js')")

      const originalDist = process.env.OPENCODE_LOCAL_DIST_PATH
      process.env.OPENCODE_LOCAL_DIST_PATH = tempDist

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (originalDist) {
            process.env.OPENCODE_LOCAL_DIST_PATH = originalDist
          } else {
            delete process.env.OPENCODE_LOCAL_DIST_PATH
          }
        }),
      )

      // Request root '/'
      const response = yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/")), {
        fs,
        client: HttpClient.HttpClient,
        disableEmbeddedWebUi: true,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
            HttpClient.layer,
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(yield* responseText(response)).toBe("<html>local html</html>")

      // Request '/script.js'
      const responseJs = yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/script.js")), {
        fs,
        client: HttpClient.HttpClient,
        disableEmbeddedWebUi: true,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
            HttpClient.layer,
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(responseJs.status).toBe(200)
      expect(responseJs.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(responseJs)).toBe("console.log('local js')")

      // Request a non-existent path should fallback to index.html
      const responseRoute = yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/settings")), {
        fs,
        client: HttpClient.HttpClient,
        disableEmbeddedWebUi: true,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
            HttpClient.layer,
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(responseRoute.status).toBe(200)
      expect(responseRoute.headers.get("content-type")).toContain("text/html")
      expect(yield* responseText(responseRoute)).toBe("<html>local html</html>")
    }),
  )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run --cwd packages/opencode test -- test/server/httpapi-ui.test.ts`
Expected: Test failures or type-check failures.

- [ ] **Step 3: Commit the test file**

```bash
rtk git add packages/opencode/test/server/httpapi-ui.test.ts
rtk git commit -m "test: add failing tests for custom proxy target and local dist fallback"
```

---

### Task 2: Implement Dynamic Upstream and Local File Fallback

**Files:**
- Modify: `packages/opencode/src/server/shared/ui.ts`
- Test: `packages/opencode/test/server/httpapi-ui.test.ts`

- [ ] **Step 1: Write minimal implementation**

Modify `packages/opencode/src/server/shared/ui.ts` to implement the dynamic upstream helper and local file fallback mechanism:

```typescript
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import nodePath from "node:path"
import { ProxyUtil } from "../proxy-util"

let embeddedUIPromise: Promise<Record<string, string> | null> | undefined

export const getUIUpstream = () => {
  try {
    return new URL(process.env.OPENCODE_UI_UPSTREAM || "https://app.opencode.ai")
  } catch {
    return new URL("https://app.opencode.ai")
  }
}

export const UI_UPSTREAM = getUIUpstream()

export const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:`
export const DEFAULT_CSP = csp()

export function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

export function cspForHtml(body: string) {
  const match = themePreloadHash(body)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], len === undefined ? undefined : Number(len))
}

function proxyResponseHeaders(headers: Record<string, string>) {
  const result = new Headers(headers)
  // FetchHttpClient exposes decoded response bodies, so forwarding upstream
  // transfer metadata makes browsers decode already-decoded assets again.
  result.delete("content-encoding")
  result.delete("content-length")
  result.delete("transfer-encoding")
  return result
}

export function upstreamURL(path: string) {
  return new URL(path, getUIUpstream()).toString()
}

export function embeddedUI(disableEmbeddedWebUi: boolean) {
  if (disableEmbeddedWebUi) return Promise.resolve(null)
  return (embeddedUIPromise ??=
    // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null))
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function embeddedUIResponse(file: string, body: Uint8Array) {
  const mime = FSUtil.mimeType(file)
  const headers = new Headers({ "content-type": mime })
  if (mime.startsWith("text/html")) {
    headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
  }
  return HttpServerResponse.raw(body, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: FSUtil.Interface,
  embeddedWebUI: Record<string, string>,
) {
  const file = embeddedWebUI[requestPath.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
  if (!file) return Effect.succeed(notFound())

  return fs.readFile(file).pipe(
    Effect.map((body) => embeddedUIResponse(file, body)),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
  )
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: FSUtil.Interface; client: HttpClient.HttpClient; disableEmbeddedWebUi: boolean },
) {
  return Effect.gen(function* () {
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI(services.disableEmbeddedWebUi))
    const requestPath = new URL(request.url, "http://localhost").pathname

    if (embeddedWebUI) return yield* serveEmbeddedUIEffect(requestPath, services.fs, embeddedWebUI)

    // Check if local dev assets exist in packages/app/dist or custom path
    const localDistPath =
      process.env.OPENCODE_LOCAL_DIST_PATH ||
      nodePath.resolve(import.meta.dirname, "../../../../app/dist")
    const hasLocalDist = yield* services.fs.existsSafe(nodePath.join(localDistPath, "index.html"))

    if (hasLocalDist) {
      const filePath = nodePath.join(localDistPath, requestPath.replace(/^\//, ""))
      const isFile = yield* services.fs.isFile(filePath)
      const targetFile = isFile ? filePath : nodePath.join(localDistPath, "index.html")

      const body = yield* services.fs.readFile(targetFile).pipe(
        Effect.catchAll(() => services.fs.readFile(nodePath.join(localDistPath, "index.html"))),
      )
      return embeddedUIResponse(targetFile, body)
    }

    const upstream = getUIUpstream()
    const response = yield* services.client.execute(
      HttpClientRequest.make(request.method)(upstreamURL(requestPath), {
        headers: ProxyUtil.headers(request.headers, { host: upstream.host }),
        body: requestBody(request),
      }),
    )
    const headers = proxyResponseHeaders(response.headers)

    if (response.headers["content-type"]?.includes("text/html")) {
      const body = yield* response.text
      headers.set("Content-Security-Policy", cspForHtml(body))
      return HttpServerResponse.text(body, { status: response.status, headers })
    }

    headers.set("Content-Security-Policy", csp())
    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      headers,
    })
  })
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run --cwd packages/opencode test -- test/server/httpapi-ui.test.ts`
Expected: PASS

- [ ] **Step 3: Run full typecheck**

Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run --cwd packages/opencode typecheck`
Expected: PASS

- [ ] **Step 4: Commit implementation**

```bash
rtk git add packages/opencode/src/server/shared/ui.ts
rtk git commit -m "feat(server): serve local UI assets when present and support OPENCODE_UI_UPSTREAM"
```
