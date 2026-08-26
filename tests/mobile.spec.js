import { test, expect } from "@playwright/test";
import { isolate, seedState, buildState, expectNoHorizontalOverflow, PAGES } from "./helpers.js";

test.describe("手機版版面", () => {
  for (const [path, title] of PAGES) {
    test(`${path} 在手機寬度下不會整頁左右捲動`, async ({ page }) => {
      await isolate(page);
      await seedState(page, buildState({
        scores: { "stu-4201": { a01: 88 } },
        attendance: { "2026-08-20": { "stu-4201": "present" } }
      }));
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("固定頁首不會超出畫面，右上角設定圖示仍可點到", async ({ page }) => {
    await isolate(page);
    await seedState(page, buildState());
    // 學生頁有寬表格，最容易把初始包含區塊撐寬。
    await page.goto("students.html");
    await expect(page.locator("#student-table-body tr").first()).toBeVisible();

    const viewport = page.viewportSize().width;
    const topbar = await page.locator(".topbar").boundingBox();
    const icon = await page.locator(".top-icon").boundingBox();
    expect(topbar.width).toBeLessThanOrEqual(viewport + 1);
    expect(icon.x + icon.width).toBeLessThanOrEqual(viewport);
    await expect(page.locator(".top-icon")).toBeVisible();
  });

  test("寬表格只在自己的容器內橫向捲動", async ({ page }) => {
    await isolate(page);
    await seedState(page, buildState());
    await page.goto("students.html");
    await expect(page.locator("#student-table-body tr").first()).toBeVisible();

    const wrap = await page.locator(".table-wrap").first().evaluate(node => ({
      scroll: node.scrollWidth,
      client: node.clientWidth,
      overflowX: getComputedStyle(node).overflowX
    }));
    expect(wrap.overflowX).toBe("auto");
    expect(wrap.scroll).toBeGreaterThan(wrap.client);
    await expectNoHorizontalOverflow(page);
  });
});
