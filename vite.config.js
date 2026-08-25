import { defineConfig } from "vite";
import { resolve } from "node:path";

const pages = ["index", "classroom", "students", "attendance", "rewards", "grades", "tools", "resources", "reports", "settings"];

export default defineConfig({
  base: "./",
  build: {
    // Firebase SDK 本身就有 600 KB，且已切成只在需要時載入的獨立 chunk。
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        ...Object.fromEntries(pages.map(page => [page, resolve(import.meta.dirname, `${page}.html`)])),
        "share-facebook": resolve(import.meta.dirname, "share/facebook-post.html")
      }
    }
  }
});
