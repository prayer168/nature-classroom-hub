import { test, expect } from "@playwright/test";
import { isolate, seedState, readState, buildState } from "./helpers.js";

/** 三位學生有成績、其餘留空，方便驗算「應考平均 −5」。 */
function gradesState(overrides = {}) {
  return buildState({
    assessments: [{ id: "a01", name: "單元小測", type: "總結性", maxScore: 100, weight: 100, date: "2026-08-01" }],
    scores: { "stu-4201": { a01: 80 }, "stu-4202": { a01: 70 }, "stu-4203": { a01: 60 } },
    ...overrides
  });
}

async function openGrades(page, overrides = {}) {
  await isolate(page);
  await seedState(page, gradesState(overrides));
  await page.goto("grades.html");
  await expect(page.locator("#gradebook-body tr").first()).toBeVisible();
}

test.describe("成績與評量", () => {
  test("缺考未補分時採應考平均 −5，補考填分後以填入值為準", async ({ page }) => {
    await openGrades(page);
    page.on("dialog", dialog => dialog.accept());

    const firstRow = page.locator("#gradebook-body tr").first();
    await expect(firstRow.locator(".score-average")).toHaveText("80.0");

    await firstRow.locator(".absent-toggle").click();
    // 剩下 70 與 60 的平均是 65，扣 5 分後為 60。
    await expect(firstRow.locator(".score-input")).toHaveAttribute("placeholder", "60");
    await expect(firstRow.locator(".score-input")).toHaveValue("");
    await expect(firstRow.locator(".score-average")).toHaveText("60.0");

    await firstRow.locator(".score-input").fill("75");
    await firstRow.locator(".score-input").press("Enter");
    await expect(firstRow.locator(".score-average")).toHaveText("75.0");
    // 標記留著當作補考註記，但計分以填入的分數為準。
    await expect(firstRow.locator(".absent-toggle")).toHaveClass(/is-on/);
  });

  test("權重總和不是 100% 時顯示提醒", async ({ page }) => {
    await openGrades(page);
    await expect(page.locator("#weight-warning")).toBeHidden();

    await page.locator("[data-edit-assessment]").first().click();
    await page.locator('.modal [name="weight"]').fill("60");
    await page.locator(".modal form button.btn-primary").click();

    await expect(page.locator("#weight-warning")).toBeVisible();
    await expect(page.locator("#weight-warning")).toContainText("60%");
  });

  test("複製評量會多一欄且成績留空，刪除評量不留孤兒成績", async ({ page }) => {
    await openGrades(page);
    page.on("dialog", dialog => dialog.accept());

    await page.locator("[data-duplicate-assessment]").first().click();
    await expect(page.locator(".assessment-name")).toHaveCount(2);
    await expect(page.locator(".assessment-name").nth(1)).toContainText("複製");
    await expect(page.locator("#gradebook-body tr").first().locator(".score-input").nth(1)).toHaveValue("");

    await page.locator("[data-delete-assessment]").nth(1).click();
    await expect(page.locator(".assessment-name")).toHaveCount(1);

    const state = await readState(page);
    const ids = new Set(state.assessments.map(item => item.id));
    const orphans = Object.values(state.scores).flatMap(map => Object.keys(map)).filter(key => !ids.has(key));
    expect(orphans).toEqual([]);
  });

  test("匯入預覽逐列判定狀態，可排除問題列並在確認後復原", async ({ page }) => {
    await openGrades(page);
    const csv = ["座號,分數", "1,90", "2,缺考", "3,abc", "4,999", "31,10", ",12", "1,55", "5,"].join("\n");

    await page.locator('[data-action="import-scores"]').click();
    await page.locator('#score-import-form input[type="file"]').setInputFiles({
      name: "scores.csv", mimeType: "text/csv", buffer: Buffer.from(`\ufeff${csv}`, "utf-8")
    });
    await page.locator("#score-import-form button.btn-primary").click();

    const rows = page.locator("#import-rows tr");
    await expect(rows).toHaveCount(8);
    await expect(rows.nth(0)).toContainText("覆蓋");
    await expect(rows.nth(1)).toContainText("缺考");
    await expect(rows.nth(2)).toContainText("非數值");
    await expect(rows.nth(3)).toContainText("超出 0–100");
    await expect(rows.nth(4)).toContainText("找不到座號 31");
    await expect(rows.nth(5)).toContainText("缺少座號");
    await expect(rows.nth(6)).toContainText("座號重複");
    await expect(rows.nth(7)).toContainText("略過");
    await expect(page.locator("#import-summary")).toContainText("將覆蓋 1 筆已輸入的成績");

    // 排除唯一一筆覆蓋，覆蓋數應立刻歸零。
    await page.locator("#import-rows [data-row]").first().uncheck();
    await expect(page.locator("#import-summary")).not.toContainText("將覆蓋");
    await page.locator("#import-rows [data-row]").first().check();

    await page.locator("[data-confirm-import]").click();
    let state = await readState(page);
    expect(state.scores["stu-4201"].a01).toBe(90);
    expect(state.scores["stu-4202"].a01).toBeNull();
    expect(state.scoreStatus["stu-4202"].a01).toBe("absent");
    expect(state.scores["stu-4203"].a01).toBe(60);

    await expect(page.locator("#import-undo")).toBeVisible();
    await page.locator('[data-action="undo-import"]').click();
    await expect(page.locator("#import-undo")).toBeHidden();

    state = await readState(page);
    expect(state.scores["stu-4201"].a01).toBe(80);
    expect(state.scores["stu-4202"].a01).toBe(70);
    expect(state.scoreStatus["stu-4202"]?.a01).toBeUndefined();
  });
});
