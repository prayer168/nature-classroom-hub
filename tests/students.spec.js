import { test, expect } from "@playwright/test";
import { isolate, seedState, readState, buildState } from "./helpers.js";

async function openStudents(page, overrides = {}) {
  await isolate(page);
  await seedState(page, buildState(overrides));
  await page.goto("students.html");
  await expect(page.locator("#student-table-body tr").first()).toBeVisible();
}

test.describe("學生管理", () => {
  test("停用後移出名單，勾選顯示停用學生才看得到，可再恢復", async ({ page }) => {
    await openStudents(page);
    await expect(page.locator("#student-table-body tr")).toHaveCount(30);

    await page.locator("[data-toggle-active]").first().click();
    await expect(page.locator("#student-table-body tr")).toHaveCount(29);

    await page.locator("#show-inactive").check();
    await expect(page.locator("#student-table-body tr")).toHaveCount(30);
    await expect(page.locator("tr.is-inactive")).toHaveCount(1);
    await expect(page.locator("tr.is-inactive")).toContainText("已停用");

    await page.locator("tr.is-inactive [data-toggle-active]").click();
    await expect(page.locator("tr.is-inactive")).toHaveCount(0);
  });

  test("刪除進回收筒且保留成績出席，還原後完整回來", async ({ page }) => {
    await openStudents(page, {
      scores: { "stu-4201": { a01: 88 } },
      attendance: { "2026-08-20": { "stu-4201": "present" } }
    });
    page.on("dialog", dialog => dialog.accept());

    await page.locator("[data-delete-student]").first().click();
    await expect(page.locator("#student-table-body tr")).toHaveCount(29);
    await expect(page.locator("#trash-count")).toHaveText("1");

    const afterDelete = await readState(page);
    const trashed = afterDelete.students.find(student => student.id === "stu-4201");
    expect(trashed.deletedAt).toBeTruthy();
    // 軟刪除的重點：關聯資料原封不動，才有辦法真的還原。
    expect(afterDelete.scores["stu-4201"]).toEqual({ a01: 88 });
    expect(afterDelete.attendance["2026-08-20"]["stu-4201"]).toBe("present");

    await page.locator('[data-action="open-trash"]').click();
    await expect(page.locator(".modal")).toContainText("4201");
    await page.locator(".modal [data-restore]").click();
    await expect(page.locator(".modal")).toContainText("回收筒是空的");
    await page.locator(".modal [data-close]").click();

    await expect(page.locator("#student-table-body tr")).toHaveCount(30);
    const restored = await readState(page);
    expect(restored.students.find(student => student.id === "stu-4201").deletedAt).toBeUndefined();
  });

  test("徹底刪除會清掉學生的所有關聯紀錄", async ({ page }) => {
    await openStudents(page, {
      scores: { "stu-4201": { a01: 88 } },
      scoreStatus: { "stu-4201": { a01: "absent" } },
      attendance: { "2026-08-20": { "stu-4201": "present" } },
      rewards: { ledger: [{ id: "r1", studentId: "stu-4201", category: "合作學習", value: 2, note: "", createdAt: "2026-08-01T00:00:00Z" }], menu: [] },
      observations: [{ id: "o1", studentId: "stu-4201", category: "探究精神", level: "positive", note: "", lesson: "", createdAt: "2026-08-01T00:00:00Z" }]
    });
    page.on("dialog", dialog => dialog.accept());

    await page.locator("[data-delete-student]").first().click();
    await page.locator('[data-action="open-trash"]').click();
    await page.locator(".modal [data-purge]").click();
    await expect(page.locator(".modal")).toContainText("回收筒是空的");
    await page.locator(".modal [data-close]").click();

    const state = await readState(page);
    expect(state.students.find(student => student.id === "stu-4201")).toBeUndefined();
    expect(state.scores["stu-4201"]).toBeUndefined();
    expect(state.scoreStatus["stu-4201"]).toBeUndefined();
    expect(state.attendance["2026-08-20"]["stu-4201"]).toBeUndefined();
    expect(state.rewards.ledger).toEqual([]);
    expect(state.observations).toEqual([]);
  });

  test("轉班會改編號與 id，成績與點數一起跟著走", async ({ page }) => {
    await openStudents(page, {
      scores: { "stu-4201": { a01: 88 } },
      rewards: { ledger: [{ id: "r1", studentId: "stu-4201", category: "合作學習", value: 3, note: "", createdAt: "2026-08-01T00:00:00Z" }], menu: [] }
    });

    await page.locator("[data-transfer-student]").first().click();
    await page.locator('.modal [name="toClassId"]').selectOption("c601");
    // 六班都滿 30 人，轉入必須開放 31 號以後的加號座位，否則轉班會卡死。
    await expect(page.locator("#transfer-preview")).toContainText("6131");
    await page.locator(".modal form button.btn-primary").click();

    await expect(page.locator("#student-table-body tr")).toHaveCount(29);
    const state = await readState(page);
    expect(state.students.find(student => student.id === "stu-4201")).toBeUndefined();
    const moved = state.students.find(student => student.id === "stu-6131");
    expect(moved).toMatchObject({ classId: "c601", seat: 31, number: "6131" });
    expect(state.scores["stu-6131"]).toEqual({ a01: 88 });
    expect(state.rewards.ledger[0].studentId).toBe("stu-6131");
    expect(state.transferLog[0]).toMatchObject({ fromNumber: "4201", toNumber: "6131", toClassId: "c601" });
  });
});
