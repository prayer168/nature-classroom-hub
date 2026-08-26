import { test, expect } from "@playwright/test";
import { isolate, seedState, buildState } from "./helpers.js";

const resources = [
  { id: "r-all", name: "通用教材", category: "教材", type: "link", url: "https://example.com/a", size: 0, grade: "通用", createdAt: "2026-01-01T00:00:00Z", tags: [] },
  { id: "r-g4", name: "四年級教材", category: "教材", type: "link", url: "https://example.com/b", size: 0, grade: "四年級", createdAt: "2026-01-01T00:00:00Z", tags: [] },
  { id: "r-g6", name: "六年級教材", category: "教材", type: "link", url: "https://example.com/c", size: 0, grade: "六年級", createdAt: "2026-01-01T00:00:00Z", tags: [] }
];

test.describe("教學資料庫", () => {
  test("預設只顯示目前年級與通用資源，可切換為全部年級", async ({ page }) => {
    await isolate(page);
    await seedState(page, buildState({ resources, activeClassId: "c402" }));
    await page.goto("resources.html");

    const cards = page.locator(".resource-card h2");
    await expect(cards).toHaveText(["通用教材", "四年級教材"]);

    await page.selectOption("#resource-scope", "all");
    await expect(cards).toHaveText(["通用教材", "四年級教材", "六年級教材"]);
  });

  test("切換到六年級班級後看到的是六年級資源", async ({ page }) => {
    await isolate(page);
    await seedState(page, buildState({ resources, activeClassId: "c402" }));
    await page.goto("resources.html");
    await expect(page.locator(".resource-card")).toHaveCount(2);

    await page.selectOption(".class-switcher select", "c603");
    await page.waitForLoadState("load");
    await expect(page.locator(".resource-card h2")).toHaveText(["通用教材", "六年級教材"]);
  });

  test("可以直接調整單一資源的適用範圍", async ({ page }) => {
    await isolate(page);
    await seedState(page, buildState({ resources, activeClassId: "c402" }));
    await page.goto("resources.html");

    await page.locator('[data-scope-resource="r-g6"]').isVisible().catch(() => {});
    await page.selectOption("#resource-scope", "all");
    await page.locator('[data-scope-resource="r-g6"]').click();
    await page.selectOption('.modal [name="grade"]', "四年級");
    await page.locator(".modal form button.btn-primary").click();

    await page.selectOption("#resource-scope", "current");
    await expect(page.locator(".resource-card h2")).toHaveText(["通用教材", "四年級教材", "六年級教材"]);
    await expect(page.locator('.resource-card:has-text("六年級教材") .resource-scope-tag')).toHaveText("四年級");
  });
});
