/**
 * Vite configuration — build tool settings for the dbRIP frontend.
 *
 * WHAT IS VITE?
 *   Vite is a modern build tool that replaces Webpack. It provides:
 *   - A dev server with instant hot module replacement (HMR)
 *   - A production build that outputs optimized static files
 *
 * WHAT THIS CONFIG DOES:
 *   - Enables the React plugin (JSX transform, fast refresh in dev)
 *   - Enables the Tailwind CSS plugin (processes utility classes)
 *   - Proxies /v1/* requests to the FastAPI backend during development,
 *     so the frontend can call the API without CORS issues
 *   - Configures Vitest for running component tests
 *
 * HOW THE PROXY WORKS:
 *   In development, the frontend runs on port 5173 and the API on port 8000.
 *   Without the proxy, the browser would block cross-origin requests.
 *   The proxy rewrites requests like:
 *     http://localhost:5173/v1/insertions → http://localhost:8000/v1/insertions
 *   In production, both are served from the same origin, so no proxy is needed.
 */

/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Proxy API requests to FastAPI during development
  server: {
    proxy: {
      "/v1": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },

  // Vitest configuration — runs tests in a simulated browser environment
  // (jsdom provides document, window, etc. without a real browser)
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
