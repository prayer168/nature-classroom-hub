import { test, expect } from "@playwright/test";
import { isolate, seedState, readState, buildState } from "./helpers.js";

test.describe("舊資料遷移", () => {
  test("1.x 含真實姓名的資料載入後立即匿名化", async ({ page }) => {
    await isolate(page);
    await seedState(page, {
      version: 1,
      students: [
        { id: "old-1", seat: 1, name: "王小明", tags: ["幹部"], note: "自然小老師" },
        { id: "old-2", seat: 2, name: "李小華", tags: [], note: "" }
      ],
      scores: { "old-1": { a01: 88 } },
      attendance: { "2026-08-20": { "old-1": "present" } },
      rewards: { ledger: [{ id: "r1", studentId: "old-1", category: "合作學習", value: 2, note: "", createdAt: "2026-08-01T00:00:00Z" }] },
      observations: [],
      settings: {}
    });
    await page.goto("students.html");
    await expect(page.locator("#student-table-body tr").first()).toBeVisible();

    const state = await readState(page);
    const names = state.students.map(student => student.name);
    expect(names.some(name => /王小明|李小華/.test(name))).toBe(false);
    expect(names.every(name => /^學生 \d+$/.test(name))).toBe(true);
    // 標籤與備註屬於教學紀錄，遷移時要保留下來。
    const migrated = state.students.find(student => student.seat === 1 && student.classId === "c402");
    expect(migrated.tags).toEqual(["幹部"]);
    expect(migrated.note).toBe("自然小老師");
    await expect(page.locator("#student-table-body")).not.toContainText("王小明");
  });

  test("五年級舊制轉為六年級並重新編號，關聯紀錄全部跟著改名", async ({ page }) => {
    await isolate(page);
    const legacy = buildState();
    // 把六年級四班改回舊制，模擬 1.6.0 以前的資料。
    const remap = { c601: ["c501", "501"], c602: ["c502", "502"], c603: ["c503", "503"], c608: ["c508", "508"] };
    legacy.students = legacy.students.map(student => {
      const mapped = remap[student.classId];
      if (!mapped) return student;
      const [oldClassId, code] = mapped;
      const number = `${code[0]}${Number(code.slice(1))}${String(student.seat).padStart(2, "0")}`;
      return { ...student, classId: oldClassId, number, id: `stu-${number}` };
    });
    legacy.activeClassId = "c503";
    legacy.lessons = { c503: { topic: "503 專屬單元", session: "第 9 節", task: "舊制任務", startedAt: null } };
    legacy.scores = { "stu-5301": { a01: 88 } };
    legacy.scoreStatus = { "stu-5302": { a01: "absent" } };
    legacy.attendance = { "2026-08-20": { "stu-5301": "present", "stu-4201": "late" } };
    legacy.attendanceLog = [{ id: "al1", date: "2026-08-20", studentId: "stu-5301", from: "absent", to: "present", at: "2026-08-21T00:00:00Z" }];
    legacy.transferLog = [{ id: "mv1", studentId: "stu-5101", fromClassId: "c402", toClassId: "c501", fromNumber: "4201", toNumber: "5101", at: "2026-08-01T00:00:00Z" }];
    legacy.observations = [{ id: "o1", studentId: "stu-5301", category: "探究精神", level: "positive", note: "很棒", lesson: "單元", createdAt: "2026-08-01T00:00:00Z" }];
    legacy.rewards = { ledger: [{ id: "r1", studentId: "stu-5301", category: "合作學習", value: 3, note: "", createdAt: "2026-08-01T00:00:00Z" }], menu: [] };
    legacy.resources = [{ id: "r1", name: "五年級教材", category: "教材", type: "file", size: 1, grade: "五年級", createdAt: "2026-01-01T00:00:00Z", tags: [] }];
    legacy.toolHistory = { recentlyPicked: ["stu-5301", "stu-4201"] };
    await seedState(page, legacy);

    await page.goto("students.html");
    await expect(page.locator("#student-table-body tr").first()).toBeVisible();
    const state = await readState(page);

    expect(state.activeClassId).toBe("c603");
    expect(state.students.filter(student => student.classId === "c603")).toHaveLength(30);
    expect(state.students.find(student => student.id === "stu-5301")).toBeUndefined();
    expect(state.students.find(student => student.id === "stu-6301").number).toBe("6301");
    // id 與編號必須永遠一致，否則同步與匯出都會對不起來。
    expect(state.students.filter(student => student.id !== `stu-${student.number}`)).toEqual([]);

    // 八個以 id 為外鍵的結構都要一起改名，漏掉任何一個就等於資料斷開。
    expect(state.scores["stu-6301"]).toEqual({ a01: 88 });
    expect(state.scoreStatus["stu-6302"]).toEqual({ a01: "absent" });
    expect(state.attendance["2026-08-20"]["stu-6301"]).toBe("present");
    expect(state.attendance["2026-08-20"]["stu-4201"]).toBe("late");
    expect(state.attendanceLog[0].studentId).toBe("stu-6301");
    expect(state.transferLog[0].studentId).toBe("stu-6101");
    expect(state.observations[0].studentId).toBe("stu-6301");
    expect(state.rewards.ledger[0].studentId).toBe("stu-6301");
    expect(state.toolHistory.recentlyPicked).toEqual(["stu-6301", "stu-4201"]);

    expect(state.lessons.c603.topic).toBe("503 專屬單元");
    expect(state.lessons.c501).toBeUndefined();
    expect(state.resources[0].grade).toBe("六年級");
    // 轉班紀錄保留當時的編號，那是歷史事實，不該被改寫。
    expect(state.transferLog[0].toNumber).toBe("5101");
    expect(state.transferLog[0].toClassId).toBe("c601");
  });
});
