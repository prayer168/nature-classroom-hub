import { test, expect } from "@playwright/test";
import { isolate, seedState, buildState } from "./helpers.js";

/** 兩次評量、兩個月出席、有加點與兌換、兩筆觀察，涵蓋面板四個區塊。 */
function detailState() {
  return buildState({
    assessments: [
      { id: "a01", name: "觀察紀錄單", type: "形成性", maxScore: 20, weight: 50, date: "2026-07-10" },
      { id: "a02", name: "單元小測", type: "總結性", maxScore: 100, weight: 50, date: "2026-08-19" }
    ],
    scores: {
      "stu-4201": { a01: 10, a02: 90 },
      "stu-4202": { a01: 20, a02: 50 }
    },
    // 刻意用過去的月份：目前月份會被今日自動點名多加一筆，斷言會不穩。
    attendance: {
      "2026-05-10": { "stu-4201": "present" },
      "2026-06-19": { "stu-4201": "absent" },
      "2026-06-20": { "stu-4201": "late" }
    },
    rewards: {
      menu: [{ id: "m01", name: "科學貼紙", cost: 5, type: "科學小物", icon: "貼", note: "", stock: null }],
      ledger: [
        { id: "l1", studentId: "stu-4201", category: "探究精神", value: 8, note: "主動整理證據", createdAt: "2026-08-01T00:00:00Z" },
        { id: "l2", studentId: "stu-4201", rewardId: "m01", category: "獎勵兌換", value: -5, note: "科學貼紙", delivered: true, deliveredAt: "2026-08-05T00:00:00Z", createdAt: "2026-08-05T00:00:00Z" }
      ]
    },
    observations: [
      { id: "o1", studentId: "stu-4201", category: "探究精神", level: "positive", note: "提出可檢驗的問題", lesson: "水溶液", createdAt: "2026-08-01T00:00:00Z" },
      { id: "o2", studentId: "stu-4201", category: "需要支持", level: "support", note: "器材收拾需提醒", lesson: "水溶液", createdAt: "2026-08-02T00:00:00Z" },
      { id: "o3", studentId: "stu-4202", category: "合作學習", level: "positive", note: "別人的紀錄", lesson: "", createdAt: "2026-08-03T00:00:00Z" }
    ]
  });
}

test.describe("學生個人趨勢面板", () => {
  test("從學生名單點開，四個區塊都有內容", async ({ page }) => {
    await isolate(page);
    await seedState(page, detailState());
    await page.goto("students.html");
    await page.locator('[data-detail-student="stu-4201"]').click();

    const modal = page.locator(".modal");
    await expect(modal.locator("#modal-title")).toHaveText("學生 4201");
    await expect(modal.locator(".modal-head p")).toContainText("402 班");
    // 加權平均：10/20 與 90/100 各佔一半 → 70.0
    await expect(modal.locator(".modal-head p")).toContainText("70.0");
    // 8 點加點扣掉 5 點兌換 → 3
    await expect(modal.locator(".modal-head p")).toContainText("3 點");

    await expect(modal.locator(".student-detail section")).toHaveCount(4);
    await expect(modal.locator(".student-detail")).toContainText("成績逐次評量趨勢");
    await expect(modal.locator(".student-detail")).toContainText("出席逐月統計");
    await expect(modal.locator(".student-detail")).toContainText("點數累積");
    await expect(modal.locator(".student-detail")).toContainText("觀察紀錄");
  });

  test("成績趨勢依日期排序，並附上班級平均對照", async ({ page }) => {
    await isolate(page);
    await seedState(page, detailState());
    await page.goto("students.html");
    await page.locator('[data-detail-student="stu-4201"]').click();

    const chart = page.locator(".student-detail section").first().locator(".mini-bar-group");
    await expect(chart).toHaveCount(2);
    // 7 月的觀察紀錄單在前、8 月的單元小測在後。
    await expect(chart.nth(0)).toContainText("50%");
    await expect(chart.nth(1)).toContainText("90%");
    // 對照線代表班級平均，兩次評量都要畫出來。
    await expect(chart.nth(0).locator(".mini-reference")).toBeVisible();
    await expect(chart.nth(1).locator(".mini-reference")).toBeVisible();
  });

  test("出席逐月統計只算該生，缺席會壓低當月出席率", async ({ page }) => {
    await isolate(page);
    await seedState(page, detailState());
    await page.goto("students.html");
    await page.locator('[data-detail-student="stu-4201"]').click();

    const months = page.locator(".student-detail section").nth(1).locator(".mini-bar-group");
    // 兩個植入的月份，加上今日自動點名產生的當月。
    await expect(months.nth(0)).toContainText("100%");
    // 6 月：一次缺席、一次遲到，遲到仍計入出席 → 50%
    await expect(months.nth(1)).toContainText("50%");
    await expect(months.nth(1)).toHaveAttribute("title", /缺席 1/);
  });

  test("點數累積顯示兌換扣點，並以淡色標示", async ({ page }) => {
    await isolate(page);
    await seedState(page, detailState());
    await page.goto("students.html");
    await page.locator('[data-detail-student="stu-4201"]').click();

    const bars = page.locator(".student-detail section").nth(2).locator(".mini-bar-group");
    await expect(bars).toHaveCount(2);
    await expect(bars.nth(0)).toContainText("8");
    await expect(bars.nth(1)).toContainText("3");
    await expect(bars.nth(1).locator(".mini-bar")).toHaveClass(/is-muted/);
  });

  test("觀察紀錄只顯示該生，需要支持另以顏色區分", async ({ page }) => {
    await isolate(page);
    await seedState(page, detailState());
    await page.goto("students.html");
    await page.locator('[data-detail-student="stu-4201"]').click();

    const items = page.locator(".observation-timeline li");
    await expect(items).toHaveCount(2);
    await expect(page.locator(".observation-timeline")).not.toContainText("別人的紀錄");
    await expect(page.locator(".observation-timeline li.level-support")).toHaveCount(1);
  });

  test("成績簿也可以點學生開啟同一個面板", async ({ page }) => {
    await isolate(page);
    await seedState(page, detailState());
    await page.goto("grades.html");
    await page.locator('[data-detail-student="stu-4201"]').click();

    await expect(page.locator("#modal-title")).toHaveText("學生 4201");
    await expect(page.locator(".student-detail")).toBeVisible();
  });

  test("沒有任何紀錄的學生也能開啟，顯示尚無資料", async ({ page }) => {
    await isolate(page);
    await seedState(page, buildState({ assessments: [] }));
    await page.goto("students.html");
    await page.locator('[data-detail-student="stu-4203"]').click();

    await expect(page.locator("#modal-title")).toHaveText("學生 4203");
    await expect(page.locator(".student-detail")).toContainText("尚無資料");
    await expect(page.locator(".student-detail")).toContainText("尚無點數紀錄");
    await expect(page.locator(".student-detail")).toContainText("尚無觀察紀錄");
  });
});
