import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const WEB_BUILD_ID = process.env.CODEPIPER_WEB_BUILD_ID ?? process.env.npm_package_version ?? "dev";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __CODEPIPER_WEB_BUILD_ID__: JSON.stringify(WEB_BUILD_ID),
  },
  // Load .env from monorepo root so VITE_* config is shared with daemon/CLI runtime.
  envDir: path.resolve(__dirname, "../.."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3456",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:9999",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-router-dom")) {
            return "react-vendor";
          }

          if (id.includes("node_modules/recharts")) {
            return "chart-vendor";
          }

          if (
            id.includes("node_modules/xterm") ||
            id.includes("node_modules/xterm-addon-fit") ||
            id.includes("node_modules/xterm-addon-web-links")
          ) {
            return "terminal-vendor";
          }

          if (id.includes("node_modules/@monaco-editor/react")) {
            return "monaco-react";
          }

          if (id.includes("node_modules/monaco-editor")) {
            return "monaco-core";
          }

          return undefined;
        },
      },
    },
  },
});
