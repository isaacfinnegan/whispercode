import { devices, expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptInputV2Mobile"
const projectID = "proj_prompt_input_v2_mobile"

test.use({ ...devices["Pixel 5"], viewport: { width: 390, height: 844 } })

async function openComposer(page: Parameters<typeof mockOpenCodeServer>[0]) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-input-v2-mobile",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session`)
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)
  return composer.locator('[data-component="prompt-input"]')
}

test("mounts v2 without autofocus on mobile web", async ({ page }) => {
  const input = await openComposer(page)

  await expect(input).toBeVisible()
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  await expect(input).not.toBeFocused()
})

test("appends final transcription once and ignores partial transcription", async ({ page }) => {
  const input = await openComposer(page)
  await input.fill("existing draft")
  await expect(input).toHaveText("existing draft")

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("opencode:transcription", { detail: { text: "partial", isFinal: false } }))
    window.dispatchEvent(new CustomEvent("opencode:transcription", { detail: { text: "final words", isFinal: true } }))
  })

  await expect(input).toHaveText("existing draft final words")
  await expect(input).not.toContainText("partial")
})
