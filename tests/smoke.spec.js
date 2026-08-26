import { test, expect } from "@playwright/test";
import { isolate, collectConsoleErrors, PAGES } from "./helpers.js";

test.describe("全站巡檢", () => {
  for (const [path, title] of PAGES) {
    test(`${path} 正常載入且無腳本錯誤`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await isolate(page);
      await page.goto(path);

      await expect(page).toHaveTitle(new RegExp(`^${title}｜`));
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.locator("#app-shell .sidebar")).toBeVisible();
      // Vite 建置失敗時會蓋一層錯誤畫面，順便擋住這種情況。
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("側欄列出全部十個頁面且目前頁面標為 active", async ({ page }) => {
    await isolate(page);
    await page.goto("attendance.html");

    const links = page.locator("#app-shell .main-nav .nav-link");
    await expect(links).toHaveCount(PAGES.length - 1);
    await expect(page.locator("#app-shell .nav-link.active")).toHaveAttribute("href", "attendance.html");
  });

  test("班級切換器列出六班", async ({ page }) => {
    await isolate(page);
    await page.goto("index.html");

    const options = page.locator(".class-switcher select option");
    await expect(options).toHaveCount(6);
    await expect(options).toHaveText(["402 班", "403 班", "601 班", "602 班", "603 班", "608 班"]);
  });
});
