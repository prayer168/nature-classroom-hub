import { defineConfig } from "vite";
import { resolve } from "node:path";

const pages = ["index", "students", "rewards", "grades", "tools", "resources", "reports", "settings"];

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map(page => [page, resolve(import.meta.dirname, `${page}.html`)]))
    }
  }
});

