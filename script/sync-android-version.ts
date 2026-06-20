import { join } from "path"
import { execSync } from "child_process"

const rootDir = process.cwd()
const appPkgPath = join(rootDir, "packages/app/package.json")
const androidPkgPath = join(rootDir, "packages/android/package.json")

try {
  const appPkg = await Bun.file(appPkgPath).json()
  const androidPkgFile = Bun.file(androidPkgPath)
  const androidPkg = await androidPkgFile.json()

  const appVersion = appPkg.version
  const androidVersion = androidPkg.version

  if (!appVersion) {
    console.error("Could not find version in packages/app/package.json")
    process.exit(1)
  }

  // Extract whispercode suffix from current android version
  const suffixMatch = androidVersion.match(/(-whispercode-\d+)/)
  const suffix = suffixMatch ? suffixMatch[1] : "-whispercode-672"
  const expectedAndroidVersion = `${appVersion}${suffix}`

  if (androidVersion !== expectedAndroidVersion) {
    console.log(`Syncing Android version: ${androidVersion} -> ${expectedAndroidVersion}`)
    androidPkg.version = expectedAndroidVersion
    await Bun.write(androidPkgPath, JSON.stringify(androidPkg, null, 2) + "\n")
    
    // Also run bun install to update lockfile
    console.log("Running bun install to update lockfile...")
    const env = { ...process.env, PATH: `${process.env.PATH}:/Users/isaac/.bun/bin` }
    execSync("bun install", { stdio: "inherit", env })
    
    // Try to auto-commit the version sync
    try {
      execSync("git add packages/android/package.json bun.lock", { stdio: "inherit", env })
      execSync(`git commit -m "chore: sync android version to ${expectedAndroidVersion}"`, { stdio: "inherit", env })
      console.log(`✅ Automatically committed version sync to ${expectedAndroidVersion}`)
    } catch (e) {
      console.log("Note: Could not auto-commit version sync (possibly in an interactive git state or no git repo).")
    }
  } else {
    console.log(`Android version is already in sync (${androidVersion}).`)
  }
} catch (error) {
  console.error("Failed to sync Android version:", error)
  process.exit(1)
}
