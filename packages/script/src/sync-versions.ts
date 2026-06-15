import { Script } from "./index"
import path from "path"

const version = Script.version
const packages = ["opencode", "android", "app"]

for (const pkgName of packages) {
  const pkgPath = path.resolve(import.meta.dirname || import.meta.dir, `../../${pkgName}/package.json`)
  const file = Bun.file(pkgPath)
  if (await file.exists()) {
    const data = await file.json()
    if (data.version !== version) {
      data.version = version
      await Bun.write(pkgPath, JSON.stringify(data, null, 2) + "\n")
      console.log(`Updated packages/${pkgName}/package.json version to ${version}`)
    } else {
      console.log(`packages/${pkgName}/package.json is already at version ${version}`)
    }
  }
}
