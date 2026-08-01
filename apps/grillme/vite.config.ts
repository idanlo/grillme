import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { DEV_PROXIED_PATH_PREFIXES } from "@grillme/shared/devProxy";

const port = Number(process.env.PORT ?? 5733);
const explicitHost = process.env.HOST?.trim();
const host = explicitHost || "localhost";
const backendPort = Number(process.env.GRILLME_PORT?.trim() ?? process.env.T3CODE_PORT?.trim());
const proxyTarget =
  Number.isInteger(backendPort) && backendPort > 0 ? `http://localhost:${backendPort}/` : undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  server: {
    host,
    port,
    strictPort: true,
    allowedHosts: [".ts.net"],
    ...(proxyTarget
      ? {
          proxy: Object.fromEntries(
            DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
              prefix,
              {
                target: proxyTarget,
                changeOrigin: true,
                ...(prefix === "/ws" ? { ws: true } : {}),
              },
            ]),
          ),
        }
      : {}),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
