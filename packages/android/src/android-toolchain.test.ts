// @ts-expect-error Bun test types are excluded from the production tsconfig.
import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const text = (value: string) => readFile(`${root}/${value}`, "utf8")

test("Android Gradle toolchain stays on supported versions", async () => {
  const [wrapper, build, buildSrc, task] = await Promise.all([
    text("src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties"),
    text("src-tauri/gen/android/build.gradle.kts"),
    text("src-tauri/gen/android/buildSrc/build.gradle.kts"),
    text("src-tauri/gen/android/buildSrc/src/main/java/com/devgriffin/whispercode/kotlin/BuildTask.kt"),
  ])

  expect(wrapper).toContain("gradle-9.1.0-bin.zip")
  expect(build).toContain("com.android.tools.build:gradle:8.13.2")
  expect(build).toContain("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.21")
  expect(buildSrc).toContain("com.android.tools.build:gradle:8.13.2")
  expect(task).toContain("execOperations.exec")
  expect(task).not.toContain("project.exec")
})

test("Android modules target JVM 17", async () => {
  const files = await Promise.all([
    text("src-tauri/gen/android/app/build.gradle.kts"),
    text("src-tauri/mobile-bridge/android/build.gradle.kts"),
  ])

  files.forEach((file) => {
    expect(file).toContain("JavaVersion.VERSION_17")
    expect(file).toContain("JvmTarget.JVM_17")
    expect(file).not.toContain("kotlinOptions")
    expect(file).not.toContain("VERSION_1_8")
  })
})
