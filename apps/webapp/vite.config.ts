import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
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