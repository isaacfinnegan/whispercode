import { defineConfig } from "vite"
import appPlugin from "@opencode-ai/app/vite"

const buildNumber = new Date().toISOString().replace(/[-T:]/g, "").slice(0, 14)

export default defineConfig({
  plugins: [appPlugin],
  publicDir: "../app/public",
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
  },
  server: {
    host: "0.0.0.0",
    port: 1422,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    assetsDir: ".",
  },
})
