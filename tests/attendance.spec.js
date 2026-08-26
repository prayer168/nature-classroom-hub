import { test, expect } from "@playwright/test";
import { isolate, seedState, readState, buildState } from "./helpers.js";

const DAYS = ["2026-08-03", "2026-08-04", "2026-08-05"];

/** 402 班三天出席，其中 17 號全缺席，用來驗統計與需關注名單。 */
function attendanceState() {
  const state = buildState();
  const class402 = state.students.filter(student => student.classId === "c402");
  state.attendance = {};
  DAYS.forEach(date => {
    state.attendance[date] = {};
    class402.forEach((student, index) => {
      state.attendance[date][student.id] = index === 16 ? "absent" : index === 9 ? "late" : "present";
    });
  });
  // 601 班只有一天，用來確認班級隔離。
  state.attendance["2026-08-05"] = { ...state.attendance["2026-08-05"] };
  state.students.filter(student => student.classId === "c601").forEach(student => {
    state.attendance["2026-08-05"][student.id] = "present";
  });
  return state;
}

test.describe("出席紀錄", () => {
  test("月曆顯示有紀錄的日期與當月統計", async ({ page }) => {
    await isolate(page);
    await seedState(page, attendanceState());
    await page.goto("attendance.html");

    await expect(page.locator("#month-subtitle")).toContainText("402 班");
    const recorded = page.locator("#calendar-grid .calendar-cell:not(.is-blank):not(.s-none)");
    await expect(recorded).toHaveCount(DAYS.length);
    // 30 人中 1 人缺席，出席率 29/30 ≈ 97%。
    await expect(recorded.first()).toContainText("97%");
    await expect(page.locator("#attendance-stats")).toContainText("3");
    await expect(page.locator(".trend-row")).toHaveCount(DAYS.length);
  });

  test("補改過去日期會留稽核紀錄並標示已調整", async ({ page }) => {
    await isolate(page);
    await seedState(page, attendanceState());
    await page.goto("attendance.html");

    await page.locator('[data-date="2026-08-03"]').click();
    await expect(page.locator("#day-title")).toHaveText("2026-08-03");

    const chip = page.locator("#day-roster .student-chip").nth(16);
    await expect(chip).toContainText("缺席");
    await chip.click();
    await expect(page.locator("#day-roster .student-chip").nth(16)).toContainText("到課");
    await expect(page.locator("#day-title")).toContainText("已調整");

    const state = await readState(page);
    expect(state.attendanceLog).toHaveLength(1);
    expect(state.attendanceLog[0]).toMatchObject({ date: "2026-08-03", studentId: "stu-4217", from: "absent", to: "present" });

    await page.locator('[data-action="attendance-log"]').click();
    await expect(page.locator(".modal")).toContainText("2026-08-03");
    await expect(page.locator(".modal")).toContainText("4217");
  });

  test("需關注名單標出連續缺席的學生", async ({ page }) => {
    await isolate(page);
    await seedState(page, attendanceState());
    await page.goto("attendance.html");

    await expect(page.locator("#attendance-watchlist")).toContainText("4217");
    await expect(page.locator("#attendance-watchlist")).toContainText("當月缺席 3 次");
  });

  test("切換班級後只看得到該班的出席", async ({ page }) => {
    await isolate(page);
    await seedState(page, attendanceState());
    await page.goto("attendance.html");
    await expect(page.locator("#calendar-grid .calendar-cell:not(.is-blank):not(.s-none)")).toHaveCount(3);

    await page.selectOption(".class-switcher select", "c601");
    await page.waitForLoadState("load");
    await expect(page.locator("#month-subtitle")).toContainText("601 班");
    await expect(page.locator("#calendar-grid .calendar-cell:not(.is-blank):not(.s-none)")).toHaveCount(1);
  });
});
