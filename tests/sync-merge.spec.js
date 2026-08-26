import { test, expect } from "@playwright/test";
import { mergeList, mergeNested, mergeValue, mergeSection, applySection, readSection, attendanceSections, stableStringify } from "../js/sync-merge.js";

test.describe("三方合併：以 id 為鍵的清單", () => {
  const base = [{ id: "a", v: 1 }, { id: "b", v: 1 }];

  test("只有遠端改動時採用遠端", () => {
    const result = mergeList(base, base, [{ id: "a", v: 1 }, { id: "b", v: 2 }]);
    expect(result.value).toEqual([{ id: "a", v: 1 }, { id: "b", v: 2 }]);
    expect(result.conflicts).toEqual([]);
  });

  test("只有本機改動時採用本機", () => {
    const result = mergeList(base, [{ id: "a", v: 9 }, { id: "b", v: 1 }], base);
    expect(result.value).toEqual([{ id: "a", v: 9 }, { id: "b", v: 1 }]);
    expect(result.conflicts).toEqual([]);
  });

  test("兩邊各改不同筆時都保留", () => {
    const result = mergeList(base, [{ id: "a", v: 9 }, { id: "b", v: 1 }], [{ id: "a", v: 1 }, { id: "b", v: 8 }]);
    expect(result.value).toEqual([{ id: "a", v: 9 }, { id: "b", v: 8 }]);
    expect(result.conflicts).toEqual([]);
  });

  test("兩邊改同一筆才算衝突，保留本機並回報", () => {
    const result = mergeList(base, [{ id: "a", v: 9 }], [{ id: "a", v: 8 }, { id: "b", v: 1 }]);
    expect(result.value).toContainEqual({ id: "a", v: 9 });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ id: "a", local: { id: "a", v: 9 }, remote: { id: "a", v: 8 } });
  });

  test("遠端新增的項目會被帶進來", () => {
    const result = mergeList(base, base, [...base, { id: "c", v: 1 }]);
    expect(result.value).toHaveLength(3);
    expect(result.value).toContainEqual({ id: "c", v: 1 });
  });

  test("本機刪除且遠端沒動時，刪除生效而不會復活", () => {
    const result = mergeList(base, [{ id: "a", v: 1 }], base);
    expect(result.value).toEqual([{ id: "a", v: 1 }]);
    expect(result.conflicts).toEqual([]);
  });

  test("本機刪除但遠端同時改了那筆，視為衝突且不強行復活", () => {
    const result = mergeList(base, [{ id: "a", v: 1 }], [{ id: "a", v: 1 }, { id: "b", v: 5 }]);
    expect(result.value).toEqual([{ id: "a", v: 1 }]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].id).toBe("b");
  });

  test("鍵順序不同不算差異", () => {
    const result = mergeList(
      [{ id: "a", x: 1, y: 2 }],
      [{ id: "a", y: 2, x: 1 }],
      [{ id: "a", x: 1, y: 2 }]
    );
    expect(result.conflicts).toEqual([]);
  });
});

test.describe("三方合併：巢狀資料", () => {
  const base = { s1: { a01: 80 }, s2: { a01: 70 } };

  test("兩位學生分別在不同裝置改分數都會保留", () => {
    const local = { s1: { a01: 90 }, s2: { a01: 70 } };
    const remote = { s1: { a01: 80 }, s2: { a01: 60 } };
    const result = mergeNested(base, local, remote);
    expect(result.value).toEqual({ s1: { a01: 90 }, s2: { a01: 60 } });
    expect(result.conflicts).toEqual([]);
  });

  test("同一位學生同一項評量兩邊都改才算衝突", () => {
    const result = mergeNested(base, { s1: { a01: 90 } }, { s1: { a01: 95 }, s2: { a01: 70 } });
    expect(result.value.s1.a01).toBe(90);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].id).toContain("s1/a01");
  });

  test("同一位學生的不同評量各自保留", () => {
    const localBase = { s1: { a01: 80, a02: 10 } };
    const result = mergeNested(localBase, { s1: { a01: 90, a02: 10 } }, { s1: { a01: 80, a02: 20 } });
    expect(result.value.s1).toEqual({ a01: 90, a02: 20 });
    expect(result.conflicts).toEqual([]);
  });

  test("本機清掉的分數不會被遠端舊值復活", () => {
    const result = mergeNested(base, { s1: {}, s2: { a01: 70 } }, base);
    expect(result.value.s1).toBeUndefined();
    expect(result.value.s2).toEqual({ a01: 70 });
  });
});

test.describe("整段值合併", () => {
  test("兩邊都改設定時保留本機並回報", () => {
    const result = mergeValue({ a: 1 }, { a: 2 }, { a: 3 }, "meta");
    expect(result.value).toEqual({ a: 2 });
    expect(result.conflicts).toHaveLength(1);
  });

  test("只有遠端改時採用遠端", () => {
    const result = mergeValue({ a: 1 }, { a: 1 }, { a: 3 }, "meta");
    expect(result.value).toEqual({ a: 3 });
    expect(result.conflicts).toEqual([]);
  });
});

test.describe("區段讀寫", () => {
  const state = () => ({
    version: 2,
    activeClassId: "c402",
    settings: { confirmDelete: true },
    toolHistory: { recentlyPicked: [] },
    lessons: { c402: { topic: "光" } },
    students: [{ id: "stu-4201", number: "4201" }],
    assessments: [{ id: "a01", name: "小測" }],
    scores: { "stu-4201": { a01: 88 } },
    scoreStatus: {},
    rewards: { ledger: [{ id: "l1", value: 2 }], menu: [{ id: "m1", cost: 5 }] },
    observations: [{ id: "o1" }],
    resources: [{ id: "r1" }],
    attendanceLog: [{ id: "al1" }],
    transferLog: [{ id: "mv1" }],
    attendance: { "2026-08-03": { "stu-4201": "present" }, "2026-07-10": { "stu-4201": "late" } }
  });

  test("出席依月份切成不同區段", () => {
    const sections = attendanceSections(state());
    expect(Object.keys(sections).sort()).toEqual(["attendance:2026-07", "attendance:2026-08"]);
    expect(sections["attendance:2026-08"]).toEqual({ "2026-08-03": { "stu-4201": "present" } });
  });

  test("讀出的區段寫回後內容相同", () => {
    const source = state();
    const target = state();
    ["students", "scores", "rewardsLedger", "rewardsMenu", "meta"].forEach(name => {
      applySection(target, name, readSection(source, name));
      expect(stableStringify(readSection(target, name))).toBe(stableStringify(readSection(source, name)));
    });
  });

  test("出席區段合併只影響該月份", () => {
    const merged = mergeSection(
      "attendance:2026-08",
      { "2026-08-03": { "stu-4201": "present" } },
      { "2026-08-03": { "stu-4201": "absent" } },
      { "2026-08-03": { "stu-4201": "present" }, "2026-08-04": { "stu-4201": "late" } }
    );
    expect(merged.value).toEqual({
      "2026-08-03": { "stu-4201": "absent" },
      "2026-08-04": { "stu-4201": "late" }
    });
    expect(merged.conflicts).toEqual([]);

    const target = state();
    applySection(target, "attendance:2026-08", merged.value);
    expect(target.attendance["2026-08-04"]).toEqual({ "stu-4201": "late" });
    // 其他月份不受影響。
    expect(target.attendance["2026-07-10"]).toEqual({ "stu-4201": "late" });
  });
});
