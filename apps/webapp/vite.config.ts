import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { qozaraPwaVersionPlugin, PWA_VERSION_GLOB_IGNORES } from "@qozara/pwa-vite";
import path from "path";
import tsconfigPaths from "vite-tsconfig-paths";

const VITE_PORT = Number(process.env.VITE_PORT || process.env.PORT || 3001);

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    qozaraPwaVersionPlugin({ defineKey: "__COMMIT_HASH__" }),
    VitePWA({
      registerType: "prompt",
      manifest: false,
      includeAssets: ["manifest.json"],
      workbox: {
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        globIgnores: [...PWA_VERSION_GLOB_IGNORES],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@quozen/core": path.resolve(__dirname, "../../packages/core/src"),
      "@quozen/ai-services": path.resolve(__dirname, "../../packages/ai-services/src"),
    },
  },
  root: "./",
  envDir: "../../",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Safely extract massive visual libraries ONLY
          'vendor-recharts': ['recharts'],
          'vendor-lucide': ['lucide-react'],
        }
      },
    },
  },
  server: {
    port: VITE_PORT,
    strictPort: true,
  },
});