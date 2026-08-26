import { test, expect } from "@playwright/test";
import { isolate, seedState, readState, buildState } from "./helpers.js";

/** 兩項獎品：一項限量、一項不限量；學生有足夠點數可兌換。 */
function rewardsState(overrides = {}) {
  return buildState({
    rewards: {
      menu: [
        { id: "m01", name: "科學貼紙", cost: 5, type: "科學小物", icon: "貼", note: "限量測試用", stock: 1 },
        { id: "m02", name: "優先選角色", cost: 5, type: "學習特權", icon: "選", note: "不限量", stock: null }
      ],
      ledger: [
        { id: "p1", studentId: "stu-4201", category: "探究精神", value: 20, note: "", createdAt: "2026-08-01T00:00:00Z" },
        { id: "p2", studentId: "stu-4202", category: "合作學習", value: 20, note: "", createdAt: "2026-08-02T00:00:00Z" }
      ]
    },
    ...overrides
  });
}

async function openRewards(page, overrides = {}) {
  await isolate(page);
  await seedState(page, rewardsState(overrides));
  await page.goto("rewards.html");
  await expect(page.locator(".reward-catalog-item").first()).toBeVisible();
}

async function redeem(page, studentId, rewardId) {
  await page.locator('[data-action="redeem"]').click();
  await page.locator('.modal [name="studentId"]').selectOption(studentId);
  await page.locator('.modal [name="rewardId"]').selectOption(rewardId);
  await page.locator(".modal form button.btn-primary").click();
}

test.describe("獎品庫存與交付", () => {
  test("卡片顯示剩餘數量，不限量獎品另外標示", async ({ page }) => {
    await openRewards(page);
    const cards = page.locator(".reward-catalog-item");
    await expect(cards.nth(0).locator(".prize-stock")).toHaveText("剩 1 份");
    await expect(cards.nth(1).locator(".prize-stock")).toHaveText("不限量");
  });

  test("兌換會扣庫存，庫存歸零後擋下兌換", async ({ page }) => {
    await openRewards(page);
    await redeem(page, "stu-4201", "m01");

    const soldOutCard = page.locator('.reward-catalog-item:has-text("科學貼紙")');
    await expect(soldOutCard.locator(".prize-stock")).toHaveText("已兌完");
    await expect(soldOutCard).toHaveClass(/is-sold-out/);
    await expect(soldOutCard.locator("[data-redeem-reward]")).toBeDisabled();

    // 從共用兌換視窗再兌一次也要被擋，不能只靠卡片上的按鈕停用。
    await redeem(page, "stu-4202", "m01");
    await expect(page.locator("#toast-region")).toContainText("已經兌完");

    const state = await readState(page);
    expect(state.rewards.menu.find(item => item.id === "m01").stock).toBe(0);
    expect(state.rewards.ledger.filter(entry => entry.rewardId === "m01")).toHaveLength(1);
  });

  test("不限量獎品可以重複兌換且不會出現負庫存", async ({ page }) => {
    await openRewards(page);
    await redeem(page, "stu-4201", "m02");
    await redeem(page, "stu-4202", "m02");

    await expect(page.locator('.reward-catalog-item:has-text("優先選角色") .prize-stock')).toHaveText("不限量");
    const state = await readState(page);
    expect(state.rewards.menu.find(item => item.id === "m02").stock).toBeNull();
    expect(state.rewards.ledger.filter(entry => entry.rewardId === "m02")).toHaveLength(2);
  });

  test("兌換後進入待交付清單，標記交付後移除", async ({ page }) => {
    await openRewards(page);
    await expect(page.locator("#pending-count")).toHaveText("0");
    await expect(page.locator("#pending-deliveries")).toContainText("沒有待交付");

    await redeem(page, "stu-4201", "m01");
    await expect(page.locator("#pending-count")).toHaveText("1");
    await expect(page.locator(".delivery-list li")).toContainText("科學貼紙");
    await expect(page.locator(".delivery-list li")).toContainText("4201");

    await page.locator("[data-deliver]").click();
    await expect(page.locator("#pending-count")).toHaveText("0");
    await expect(page.locator("#pending-deliveries")).toContainText("沒有待交付");

    const state = await readState(page);
    const entry = state.rewards.ledger.find(item => item.rewardId === "m01");
    expect(entry.delivered).toBe(true);
    expect(entry.deliveredAt).toBeTruthy();
  });

  test("可調整庫存，也可改為不限量", async ({ page }) => {
    await openRewards(page);
    await page.locator('[data-stock-reward="m01"]').click();
    await page.locator('.modal [name="stock"]').fill("7");
    await page.locator(".modal form button.btn-primary").click();
    await expect(page.locator('.reward-catalog-item:has-text("科學貼紙") .prize-stock')).toHaveText("剩 7 份");

    await page.locator('[data-stock-reward="m01"]').click();
    await page.locator('.modal [name="unlimited"]').check();
    await page.locator(".modal form button.btn-primary").click();
    await expect(page.locator('.reward-catalog-item:has-text("科學貼紙") .prize-stock')).toHaveText("不限量");

    const state = await readState(page);
    expect(state.rewards.menu.find(item => item.id === "m01").stock).toBeNull();
  });

  test("舊資料沒有庫存與交付欄位時不會誤判", async ({ page }) => {
    await isolate(page);
    await seedState(page, buildState({
      rewards: {
        menu: [{ id: "m01", name: "舊獎品", cost: 5, type: "科學小物", icon: "舊", note: "" }],
        ledger: [
          { id: "p1", studentId: "stu-4201", category: "探究精神", value: 20, note: "", createdAt: "2026-08-01T00:00:00Z" },
          { id: "old", studentId: "stu-4201", category: "獎勵兌換", value: -5, note: "舊獎品", createdAt: "2026-08-02T00:00:00Z" }
        ]
      }
    }));
    await page.goto("rewards.html");

    // 沒有 stock 欄位視為不限量，否則舊資料一載入就全部變成已兌完。
    await expect(page.locator('.reward-catalog-item:has-text("舊獎品") .prize-stock')).toHaveText("不限量");
    // 舊的兌換紀錄視為已交付，不該突然全部跳成待交付。
    await expect(page.locator("#pending-count")).toHaveText("0");
  });
});
