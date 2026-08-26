import { expect } from "@playwright/test";

export const STORAGE_KEY = "nature-classroom-hub:v1";
export const PAGES = [
  ["index.html", "今日課堂"],
  ["classroom.html", "教室座位圖"],
  ["students.html", "學生與班級"],
  ["attendance.html", "出席紀錄"],
  ["rewards.html", "正向獎勵"],
  ["grades.html", "成績與評量"],
  ["tools.html", "課堂工具"],
  ["resources.html", "教學資料庫"],
  ["reports.html", "統計報表"],
  ["settings.html", "串接與設定"]
];

/**
 * 每個測試都在乾淨環境開始，並且不讓測試打到真的 Firebase。
 * 雲端模組只在設定頁或登入過的裝置才載入，這裡一併把外部請求換成空回應，
 * 避免測試結果受網路狀況影響（用 abort 會在 console 留下 ERR_FAILED，
 * 跟「頁面不該有腳本錯誤」的斷言互相干擾）。
 */
export async function isolate(page) {
  await runOncePerTab(page, "cleared", () => { localStorage.clear(); });
  await page.route(/(googleapis|firebaseapp|google\.com|gstatic)/, route =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "" }));
}

/** 在頁面載入前植入指定狀態，用來測資料遷移與各種既有資料情境。 */
export async function seedState(page, state) {
  await runOncePerTab(page, "seeded", value => { localStorage.setItem("nature-classroom-hub:v1", value); }, JSON.stringify(state));
}

/**
 * 植入腳本在每次導覽都會重跑，而切換班級會整頁重載。
 * 用 sessionStorage 當旗標，確保每個步驟只在該分頁的第一次載入執行，
 * 否則測試過程中的操作結果會被洗掉。清空與植入各有自己的旗標，
 * 共用同一個會讓先執行的那個把後面的擋掉。
 */
async function runOncePerTab(page, name, action, payload = null) {
  await page.addInitScript(([flag, fn, value]) => {
    try {
      if (sessionStorage.getItem(flag)) return;
      sessionStorage.setItem(flag, "1");
      // eslint-disable-next-line no-new-func
      new Function("value", `(${fn})(value)`)(value);
    } catch { /* 無痕或封鎖儲存時忽略 */ }
  }, [`nature-hub-test-${name}`, action.toString(), payload]);
}

export async function readState(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null"), STORAGE_KEY);
}

/** 讓狀態確實寫進 localStorage：示範資料要等第一次變更才會落地。 */
export async function gotoAndSettle(page, path) {
  await page.goto(path);
  await expect(page.locator("main h1")).toBeVisible();
}

export async function switchClass(page, classId) {
  await page.selectOption(".class-switcher select", classId);
  await page.waitForLoadState("load");
}

/** 收集 console 錯誤，供測試斷言頁面沒有腳本錯誤。 */
export function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  return errors;
}

/** 整頁不應該可以左右捲動；表格等寬內容必須自己在容器內捲。 */
export async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.body).toBeLessThanOrEqual(overflow.client + 1);
}

/** 六班各 30 人的基礎資料，可用 overrides 覆寫成特定情境。 */
export function buildState(overrides = {}) {
  const classes = [
    ["c402", "402"], ["c403", "403"], ["c601", "601"],
    ["c602", "602"], ["c603", "603"], ["c608", "608"]
  ];
  const students = [];
  classes.forEach(([classId, code]) => {
    for (let seat = 1; seat <= 30; seat += 1) {
      const number = `${code[0]}${Number(code.slice(1))}${String(seat).padStart(2, "0")}`;
      students.push({
        id: `stu-${number}`, number, seat, name: `學生 ${number}`, classId,
        tags: [], note: "", active: true, createdAt: "2026-01-01T00:00:00Z"
      });
    }
  });
  return {
    version: 2,
    activeClassId: "c402",
    classes: [],
    lessons: {},
    students,
    attendance: {},
    attendanceLog: [],
    transferLog: [],
    observations: [],
    rewards: { ledger: [], menu: [] },
    assessments: [{ id: "a01", name: "單元小測", type: "總結性", maxScore: 100, weight: 100, date: "2026-08-01" }],
    scores: {},
    scoreStatus: {},
    resources: [],
    toolHistory: { recentlyPicked: [] },
    settings: {},
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides
  };
}
