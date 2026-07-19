type Exports = Record<string, string | { import: string; types: string }>

type Pkg = {
  exports: Exports
}

export function rewrite(pkg: Pkg) {
  const next = structuredClone(pkg)

  for (const [key, value] of Object.entries(next.exports)) {
    if (typeof value !== "string") continue
    const file = value.replace("./src/", "./dist/").replace(".ts", "")
    next.exports[key] = {
      import: `${file}.js`,
      types: `${file}.d.ts`,
    }
  }

  return next
}
