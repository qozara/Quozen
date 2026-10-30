import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { execSync } from "child_process";
import tsconfigPaths from "vite-tsconfig-paths";

const getGitHash = () => {
  try {
    if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
    return execSync("git rev-parse HEAD").toString().trim();
  } catch (e) {
    return "dev";
  }
};

const commitHash = getGitHash().substring(0, 7);
const VITE_PORT = Number(process.env.VITE_PORT || process.env.PORT || 3001);

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    VitePWA({
      registerType: "prompt",
      manifest: false,
      includeAssets: [
        "favicon.ico",
        "favicon.svg",
        "favicon-96x96.png",
        "apple-touch-icon.png",
        "logo.svg",
        "manifest.json",
      ],
      workbox: {
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
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
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
});