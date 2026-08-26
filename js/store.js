const STORAGE_KEY = "nature-classroom-hub:v1";

const todayKey = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

export const classDefinitions = [
  { id: "c402", code: "402", name: "402 班", grade: "四年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c403", code: "403", name: "403 班", grade: "四年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c601", code: "601", name: "601 班", grade: "六年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c602", code: "602", name: "602 班", grade: "六年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c603", code: "603", name: "603 班", grade: "六年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c608", code: "608", name: "608 班", grade: "六年級", subject: "自然科學", schoolYear: "115 學年度" }
];

/** 舊的五年級班級對應到現在的六年級班級；載入舊資料時自動轉換並重新編號。 */
const CLASS_MIGRATION = { c501: "c601", c502: "c602", c503: "c603", c508: "c608" };
const GRADE_MIGRATION = { 五年級: "六年級" };

/** 資源庫的適用範圍：通用資源在所有班級都看得到，年級資源只在該年級的班級出現。 */
export const RESOURCE_SCOPE_ALL = "通用";
export const resourceScopes = [RESOURCE_SCOPE_ALL, ...[...new Set(classDefinitions.map(item => item.grade))]];

const defaultLesson = () => ({ topic: "水溶液的酸鹼性", session: "第 3 節", task: "指示劑觀察與紀錄", startedAt: null });

export function studentNumberFor(classCode, seat) {
  const classNumber = Number(String(classCode).slice(1));
  return `${String(classCode)[0]}${classNumber}${String(Number(seat)).padStart(2, "0")}`;
}

const buildStudents = () => classDefinitions.flatMap(classInfo => Array.from({ length: 30 }, (_, index) => {
  const seat = index + 1;
  const number = studentNumberFor(classInfo.code, seat);
  return {
    id: `stu-${number}`,
    number,
    seat,
    name: `學生 ${number}`,
    classId: classInfo.id,
    tags: [],
    note: "",
    active: true,
    createdAt: nowIso()
  };
}));

const initialAssessments = [
  { id: "a01", name: "觀察紀錄單", type: "形成性", maxScore: 20, weight: 15, date: "2026-08-07" },
  { id: "a02", name: "實驗操作", type: "實作", maxScore: 25, weight: 25, date: "2026-08-14" },
  { id: "a03", name: "單元小測", type: "總結性", maxScore: 100, weight: 35, date: "2026-08-19" },
  { id: "a04", name: "探究發表", type: "形成性", maxScore: 20, weight: 25, date: "2026-08-22" }
];

const buildScores = students => Object.fromEntries(students.map((student, index) => [student.id, {
  a01: Math.max(12, 20 - (index % 7)),
  a02: Math.max(15, 25 - (index % 8)),
  a03: Math.max(62, 93 - ((index * 7) % 28)),
  a04: index % 30 > 25 ? null : Math.max(12, 20 - (index % 6))
}]));

const buildLedger = students => students.filter(student => student.classId === "c402").slice(0, 14).map((student, index) => ({
  id: `r${index + 1}`,
  studentId: student.id,
  category: ["探究精神", "合作學習", "安全操作", "清楚表達"][index % 4],
  value: index % 4 === 0 ? 2 : 1,
  note: index % 3 === 0 ? "小組實驗時主動協助整理證據" : "課堂即時回饋",
  createdAt: new Date(Date.now() - index * 7_200_000).toISOString()
}));

const defaultRewardMenu = [
  { id: "m01", name: "優先選擇實驗角色", cost: 12, type: "學習特權", icon: "選", note: "下次實驗可優先選擇分工" },
  { id: "m02", name: "自然小博士貼紙", cost: 18, type: "科學小物", icon: "貼", note: "自然科主題貼紙一張" },
  { id: "m03", name: "推薦今日科學影片", cost: 25, type: "學習特權", icon: "影", note: "推薦一段 5 分鐘內的科學影片" },
  { id: "m04", name: "科學文具小禮", cost: 30, type: "科學小物", icon: "筆", note: "科學圖案鉛筆、尺或橡皮擦" },
  { id: "m05", name: "科學驚喜盲盒", cost: 40, type: "驚喜盲盒", icon: "盲", note: "教師準備的化石、礦石、模型或科學小物隨機一件" },
  { id: "m06", name: "3D 列印編號牌", cost: 55, type: "3D 列印", icon: "3D", note: "從指定樣式選擇學生編號牌或鑰匙圈" },
  { id: "m07", name: "迷你科學玩具", cost: 70, type: "科學玩具", icon: "玩", note: "如陀螺、磁力、光學或簡易組裝玩具" },
  { id: "m08", name: "客製 3D 列印模型", cost: 100, type: "3D 列印", icon: "造", note: "在尺寸與材料範圍內選擇一件科學模型" }
];

function normalizeRewardMenu(menu = []) {
  const currentMenu = Array.isArray(menu) ? menu : [];
  const currentIds = new Set(currentMenu.map(item => item.id));
  const defaultsById = new Map(defaultRewardMenu.map(item => [item.id, item]));
  return currentMenu
    .map(item => ({ ...(defaultsById.get(item.id) || {}), ...item }))
    .concat(defaultRewardMenu.filter(item => !currentIds.has(item.id)).map(item => ({ ...item })))
    // 舊資料沒有庫存欄位，一律視為不限量，才不會突然變成「已兌完」。
    .map(item => ({ ...item, stock: item.stock === null || item.stock === undefined ? null : Math.max(0, Number(item.stock) || 0) }));
}

/**
 * 把所有以 student.id 為鍵的資料一起改名。
 * 學生編號一改，id 也要跟著改，但成績、出席、點數、觀察與各式紀錄
 * 全都用 id 當外鍵，漏掉任何一處資料就會斷開，因此集中在這裡處理。
 */
function remapStudentIds(target, idMap) {
  if (!idMap.size) return;
  const swap = id => idMap.get(id) || id;
  const rekey = source => Object.fromEntries(Object.entries(source || {}).map(([id, value]) => [swap(id), value]));

  target.students = (target.students || []).map(student => (idMap.has(student.id) ? { ...student, id: swap(student.id) } : student));
  target.scores = rekey(target.scores);
  target.scoreStatus = rekey(target.scoreStatus);
  Object.keys(target.attendance || {}).forEach(date => { target.attendance[date] = rekey(target.attendance[date]); });
  ["observations", "attendanceLog", "transferLog"].forEach(key => {
    target[key] = (target[key] || []).map(item => (idMap.has(item.studentId) ? { ...item, studentId: swap(item.studentId) } : item));
  });
  if (target.rewards?.ledger) target.rewards.ledger = target.rewards.ledger.map(item => (idMap.has(item.studentId) ? { ...item, studentId: swap(item.studentId) } : item));
  if (target.toolHistory?.recentlyPicked) target.toolHistory.recentlyPicked = target.toolHistory.recentlyPicked.map(swap);
}

function normalizeState(nextState) {
  nextState.version = 2;
  nextState.classes = classDefinitions.map(item => ({ ...item }));

  // 五年級改制為六年級：舊班級 id 先轉成新的，之後編號才會跟著重算。
  if (CLASS_MIGRATION[nextState.activeClassId]) nextState.activeClassId = CLASS_MIGRATION[nextState.activeClassId];
  if (nextState.lessons) {
    Object.entries(CLASS_MIGRATION).forEach(([oldId, newId]) => {
      if (nextState.lessons[oldId] && !nextState.lessons[newId]) nextState.lessons[newId] = nextState.lessons[oldId];
      delete nextState.lessons[oldId];
    });
  }
  (nextState.transferLog || []).forEach(entry => {
    entry.fromClassId = CLASS_MIGRATION[entry.fromClassId] || entry.fromClassId;
    entry.toClassId = CLASS_MIGRATION[entry.toClassId] || entry.toClassId;
  });
  (nextState.resources || []).forEach(item => { if (GRADE_MIGRATION[item.grade]) item.grade = GRADE_MIGRATION[item.grade]; });

  if (!classDefinitions.some(item => item.id === nextState.activeClassId)) nextState.activeClassId = "c402";

  // 課程單元依班級各自獨立；1.3.0 以前只有單一 lesson，載入時複製給每個班級當起點。
  const legacyLesson = nextState.lesson && typeof nextState.lesson === "object" ? nextState.lesson : null;
  const lessons = nextState.lessons && typeof nextState.lessons === "object" ? nextState.lessons : {};
  nextState.lessons = Object.fromEntries(classDefinitions.map(classInfo => {
    const existing = lessons[classInfo.id];
    const source = existing || legacyLesson || defaultLesson();
    return [classInfo.id, { ...defaultLesson(), ...source }];
  }));
  delete nextState.lesson;

  // 資源庫依年級分類；沒有標記的舊資料一律視為通用。
  nextState.resources = (nextState.resources || []).map(item => ({
    ...item,
    grade: resourceScopes.includes(item.grade) ? item.grade : RESOURCE_SCOPE_ALL
  }));
  // 轉制的學生要重新編號（5101 → 6101），id 也跟著改成 stu-6101；
  // 先把所有以舊 id 為外鍵的資料一起改名，成績與出席才不會斷開。
  const idMap = new Map();
  (nextState.students || []).forEach(student => {
    const migratedClassId = CLASS_MIGRATION[student.classId];
    if (!migratedClassId) return;
    const classInfo = classDefinitions.find(item => item.id === migratedClassId);
    const nextId = `stu-${studentNumberFor(classInfo.code, student.seat)}`;
    if (student.id !== nextId) idMap.set(student.id, nextId);
  });
  remapStudentIds(nextState, idMap);

  nextState.students = (nextState.students || []).map(student => {
    const migratedClassId = CLASS_MIGRATION[student.classId];
    const classInfo = classDefinitions.find(item => item.id === (migratedClassId || student.classId)) || classDefinitions[0];
    const number = migratedClassId ? studentNumberFor(classInfo.code, student.seat) : (student.number || studentNumberFor(classInfo.code, student.seat));
    return { ...student, id: student.id || `stu-${number}`, number, name: `學生 ${number}`, classId: classInfo.id };
  });
  nextState.rewards ||= { ledger: [], menu: [] };
  nextState.rewards.ledger ||= [];
  // 兌換紀錄補上交付狀態；舊紀錄視為已交付，避免歷史資料全部跳成待交付。
  nextState.rewards.ledger = nextState.rewards.ledger.map(entry => (
    entry.value < 0 && entry.delivered === undefined ? { ...entry, delivered: true, deliveredAt: entry.createdAt } : entry
  ));
  nextState.rewards.menu = normalizeRewardMenu(nextState.rewards.menu);
  nextState.scores ||= {};
  nextState.scoreStatus ||= {};
  nextState.attendance ||= {};
  nextState.attendanceLog ||= [];
  nextState.transferLog ||= [];
  nextState.observations ||= [];
  return nextState;
}

function migrateLegacyState(legacy) {
  const next = createDemoState();
  const legacyStudents = Array.isArray(legacy.students) ? legacy.students : [];
  const idMap = new Map();
  legacyStudents.forEach(student => {
    const seat = Number(student.seat);
    if (seat < 1 || seat > 30) return;
    const target = next.students.find(item => item.classId === "c402" && item.seat === seat);
    if (!target) return;
    idMap.set(student.id, target.id);
    target.tags = Array.isArray(student.tags) ? student.tags : [];
    target.note = student.note || "";
    if (legacy.scores?.[student.id]) next.scores[target.id] = structuredClone(legacy.scores[student.id]);
  });
  Object.entries(legacy.attendance || {}).forEach(([date, day]) => {
    next.attendance[date] ||= {};
    Object.entries(day || {}).forEach(([oldId, status]) => {
      const newId = idMap.get(oldId);
      if (newId) next.attendance[date][newId] = status;
    });
  });
  next.rewards.ledger = (legacy.rewards?.ledger || []).flatMap(entry => {
    const studentId = idMap.get(entry.studentId);
    return studentId ? [{ ...entry, studentId }] : [];
  });
  next.rewards.menu = normalizeRewardMenu(legacy.rewards?.menu);
  next.observations = (legacy.observations || []).flatMap(item => {
    const studentId = idMap.get(item.studentId);
    return studentId ? [{ ...item, studentId }] : [];
  });
  next.assessments = Array.isArray(legacy.assessments) ? legacy.assessments : next.assessments;
  next.resources = Array.isArray(legacy.resources) ? legacy.resources : next.resources;
  next.settings = { ...next.settings, ...(legacy.settings || {}) };
  if (legacy.lesson) next.lesson = { ...defaultLesson(), ...legacy.lesson };
  next.toolHistory = legacy.toolHistory || next.toolHistory;
  return normalizeState(next);
}

export const createDemoState = () => {
  const students = buildStudents();
  return {
    version: 2,
    classes: classDefinitions.map(item => ({ ...item })),
    activeClassId: "c402",
    lessons: Object.fromEntries(classDefinitions.map(classInfo => [classInfo.id, defaultLesson()])),
    students,
    attendance: {
      [todayKey()]: Object.fromEntries(students.map(student => [student.id, student.seat === 15 ? "late" : student.seat === 17 ? "absent" : "present"]))
    },
    scoreStatus: {},
    attendanceLog: [],
    transferLog: [],
    observations: [],
    rewards: { ledger: buildLedger(students), menu: defaultRewardMenu.map(item => ({ ...item })) },
    assessments: initialAssessments,
    scores: buildScores(students),
    resources: [
      { id: "link-phet", name: "PhET 互動式模擬", category: "連結", type: "link", url: "https://phet.colorado.edu/zh_TW/", size: 0, grade: RESOURCE_SCOPE_ALL, createdAt: nowIso(), tags: ["模擬", "外部資源"] },
      { id: "link-junyi", name: "均一教育平台", category: "連結", type: "link", url: "https://www.junyiacademy.org/", size: 0, grade: RESOURCE_SCOPE_ALL, createdAt: nowIso(), tags: ["任務", "學習資源"] }
    ],
    toolHistory: { recentlyPicked: [] },
    settings: { appsScriptUrl: "", lastSyncAt: null, cloudSyncedAt: null, privateObservations: true, positiveOnly: true, confirmDelete: true },
    updatedAt: nowIso()
  };
};

let state;
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDemoState();
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2) {
      const normalized = normalizeState(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    }
    if (parsed?.version === 1) {
      const migrated = migrateLegacyState(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return createDemoState();
  } catch (error) {
    console.warn("無法讀取本機資料，已載入匿名示範資料。", error);
    return createDemoState();
  }
}

state = load();

function persist() {
  state.updatedAt = nowIso();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach(listener => listener(state));
}

export const store = {
  get: () => state,
  update(mutator) {
    const clone = structuredClone(state);
    mutator(clone);
    state = normalizeState(clone);
    persist();
    return state;
  },
  replace(nextState) {
    if (!nextState || ![1, 2].includes(nextState.version) || !Array.isArray(nextState.students)) throw new Error("備份格式不正確或版本不支援。");
    state = nextState.version === 1 ? migrateLegacyState(nextState) : normalizeState(structuredClone(nextState));
    persist();
  },
  reset() {
    state = createDemoState();
    persist();
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

export function activeClass(current = state) {
  return current.classes.find(item => item.id === current.activeClassId) || current.classes[0];
}

/** 目前班級的課程單元。每個班級各自獨立，切換班級即切換單元。 */
export function activeLesson(current = state) {
  current.lessons ||= {};
  current.lessons[current.activeClassId] ||= defaultLesson();
  return current.lessons[current.activeClassId];
}

export function activeGrade(current = state) {
  return activeClass(current)?.grade || "";
}

/** 目前班級看得到的教學資源：通用資源加上該年級的資源。 */
export function visibleResources(current = state) {
  const grade = activeGrade(current);
  return (current.resources || []).filter(item => item.grade === RESOURCE_SCOPE_ALL || item.grade === grade);
}

/** 目前班級的在籍學生：排除已停用與已刪除者。 */
export function activeStudents(current = state) {
  return current.students.filter(student => student.classId === current.activeClassId && student.active !== false && !student.deletedAt);
}

/** 目前班級被停用的學生（保留歷史，不列入當前名單）。 */
export function inactiveStudents(current = state) {
  return current.students.filter(student => student.classId === current.activeClassId && student.active === false && !student.deletedAt);
}

/** 回收筒：所有班級被軟刪除的學生，最近刪除的排前面。 */
export function deletedStudents(current = state) {
  return current.students
    .filter(student => student.deletedAt)
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

/** 座號上限。預設一班 30 人，但轉入會讓班級暫時超過，所以留出餘裕。 */
export const SEAT_LIMIT = 45;

/** 該班已被占用的座號（含停用學生，避免號碼撞號）。 */
export function occupiedSeats(classId, current = state, exceptStudentId = "") {
  return new Set(current.students
    .filter(student => student.classId === classId && !student.deletedAt && student.id !== exceptStudentId)
    .map(student => Number(student.seat)));
}

/** 該班還空著的座號。滿 30 人時會往上開放 31 號以後，讓轉入不會卡死。 */
export function freeSeats(classId, current = state, exceptStudentId = "") {
  const taken = occupiedSeats(classId, current, exceptStudentId);
  return Array.from({ length: SEAT_LIMIT }, (_, index) => index + 1).filter(seat => !taken.has(seat));
}

/**
 * 轉班：學生本人與其所有紀錄一起搬到新班級，並改用新班級的編號。
 * 成績、出席、點數與觀察都以 student.id 為鍵，因此不需搬動即自動跟隨。
 */
export function transferStudent(draft, studentId, toClassId, toSeat) {
  const student = draft.students.find(item => item.id === studentId);
  const target = classDefinitions.find(item => item.id === toClassId);
  if (!student || !target) return null;
  const fromClassId = student.classId;
  const fromNumber = student.number;
  const moved = setStudentSeat(draft, studentId, toClassId, toSeat);
  if (!moved) return null;
  draft.transferLog ||= [];
  draft.transferLog.unshift({ id: uniqueId("mv"), studentId: moved.studentId, fromClassId, toClassId, fromNumber, toNumber: moved.number, at: nowIso() });
  return { fromNumber, toNumber: moved.number, studentId: moved.studentId };
}

/**
 * 調整學生的班級與座號，並讓編號與 id 一起跟上（id 恆為 stu-<編號>）。
 * 回傳異動後的 id 與編號。
 */
export function setStudentSeat(draft, studentId, classId, seat) {
  const student = draft.students.find(item => item.id === studentId);
  const target = classDefinitions.find(item => item.id === classId);
  if (!student || !target) return null;
  const number = studentNumberFor(target.code, seat);
  student.classId = target.id;
  student.seat = Number(seat);
  student.number = number;

  // 回收筒裡的學生也占著 id，撞到時加上後綴避免覆蓋別人的成績。
  let nextId = `stu-${number}`;
  if (nextId !== studentId && draft.students.some(item => item.id === nextId)) nextId = `${nextId}-${Math.random().toString(36).slice(2, 6)}`;
  if (nextId !== studentId) remapStudentIds(draft, new Map([[studentId, nextId]]));
  return { studentId: nextId, number };
}

export function getTodayAttendance(current = state) {
  const key = todayKey();
  current.attendance[key] ||= {};
  activeStudents(current).forEach(student => {
    if (!current.attendance[key][student.id]) current.attendance[key][student.id] = "present";
  });
  return current.attendance[key];
}

/** 目前班級在指定日期有紀錄的出席狀態；不會像 getTodayAttendance 那樣補上預設值。 */
export function attendanceOn(date, current = state) {
  const day = current.attendance[date] || {};
  return Object.fromEntries(activeStudents(current)
    .filter(student => day[student.id])
    .map(student => [student.id, day[student.id]]));
}

/** 目前班級在指定月份（YYYY-MM）有出席紀錄的日期，由舊到新。 */
export function attendanceDatesInMonth(month, current = state) {
  const ids = new Set(activeStudents(current).map(student => student.id));
  return Object.keys(current.attendance)
    .filter(date => date.startsWith(`${month}-`))
    .filter(date => Object.keys(current.attendance[date] || {}).some(id => ids.has(id)))
    .sort();
}

/**
 * 設定出席狀態，回傳實際變更筆數。
 * 只有「補改過去日期」才會留下稽核紀錄——當天的即時點名屬於正常作業，
 * 每次切換都記錄會把紀錄淹掉，也不是使用者想追的東西。
 */
export function setAttendance(draft, date, studentId, status) {
  draft.attendance[date] ||= {};
  const previous = draft.attendance[date][studentId] || "";
  if (previous === status) return 0;
  draft.attendance[date][studentId] = status;
  if (date === todayKey()) return 1;
  draft.attendanceLog ||= [];
  draft.attendanceLog.unshift({
    id: uniqueId("att"),
    date,
    studentId,
    from: previous,
    to: status,
    at: nowIso()
  });
  return 1;
}

/** 指定日期是否被事後調整過。 */
export function attendanceAdjustedOn(date, current = state) {
  return (current.attendanceLog || []).some(entry => entry.date === date);
}

/** 獎品剩餘數量；null 代表不限量。 */
export function prizeStock(prizeId, current = state) {
  const prize = current.rewards.menu.find(item => item.id === prizeId);
  return prize ? (prize.stock === null || prize.stock === undefined ? null : Number(prize.stock)) : null;
}

export function prizeSoldOut(prizeId, current = state) {
  return prizeStock(prizeId, current) === 0;
}

/** 已兌換但尚未交付的紀錄，最近的排前面。 */
export function pendingDeliveries(current = state) {
  const ids = new Set(activeStudents(current).map(student => student.id));
  return current.rewards.ledger
    .filter(entry => entry.value < 0 && entry.delivered === false && ids.has(entry.studentId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function studentPoints(studentId, current = state) {
  return current.rewards.ledger.filter(entry => entry.studentId === studentId).reduce((total, entry) => total + Number(entry.value || 0), 0);
}

/* -------------------------------------------------------------- 成績與缺考 */

/** 缺考扣分：以實際應考同學的平均再減 5 分。 */
export const ABSENT_PENALTY = 5;

export function scoreStatusOf(studentId, assessmentId, current = state) {
  return current.scoreStatus?.[studentId]?.[assessmentId] || "";
}

export function isAbsentExam(studentId, assessmentId, current = state) {
  return scoreStatusOf(studentId, assessmentId, current) === "absent";
}

/**
 * 該評量「實際應考學生」的平均原始分數。
 * 刻意排除缺考者與未輸入者，否則缺考推算出來的分數會回頭影響平均。
 */
export function assessmentRawMean(assessmentId, current = state) {
  const values = activeStudents(current)
    .filter(student => !isAbsentExam(student.id, assessmentId, current))
    .map(student => current.scores[student.id]?.[assessmentId])
    .filter(value => value !== null && value !== undefined && value !== "")
    .map(Number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** 缺考學生的推算分數；沒有任何人有成績時回傳 null。 */
export function absentExamScore(assessmentId, current = state) {
  const assessment = current.assessments.find(item => item.id === assessmentId);
  const mean = assessmentRawMean(assessmentId, current);
  if (!assessment || mean === null) return null;
  return Math.min(assessment.maxScore, Math.max(0, Number((mean - ABSENT_PENALTY).toFixed(1))));
}

/**
 * 計分時實際採用的分數。
 * 缺考且教師未手動填分時採「應考平均 −5」，會隨其他人成績變動自動重算；
 * 只要教師填了分數就以填入的為準（等同補考登記）。
 */
export function effectiveScore(studentId, assessmentId, current = state) {
  const raw = current.scores[studentId]?.[assessmentId];
  if (raw !== null && raw !== undefined && raw !== "") return Number(raw);
  if (isAbsentExam(studentId, assessmentId, current)) return absentExamScore(assessmentId, current);
  return null;
}

export function setScoreStatus(draft, studentId, assessmentId, status) {
  draft.scoreStatus ||= {};
  draft.scoreStatus[studentId] ||= {};
  if (status) draft.scoreStatus[studentId][assessmentId] = status;
  else delete draft.scoreStatus[studentId][assessmentId];
}

export function studentAverage(studentId, current = state) {
  let weighted = 0;
  let totalWeight = 0;
  current.assessments.forEach(assessment => {
    const score = effectiveScore(studentId, assessment.id, current);
    if (score === null || score === undefined) return;
    weighted += (Number(score) / assessment.maxScore) * assessment.weight;
    totalWeight += assessment.weight;
  });
  return totalWeight ? (weighted / totalWeight) * 100 : null;
}

export function classAverage(current = state) {
  const values = activeStudents(current).map(student => studentAverage(student.id, current)).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/** 該評量的班級平均百分比，以實際應考學生計算。 */
export function assessmentAverage(assessmentId, current = state) {
  const assessment = current.assessments.find(item => item.id === assessmentId);
  const mean = assessmentRawMean(assessmentId, current);
  return assessment && mean !== null ? mean / assessment.maxScore * 100 : 0;
}

/** 權重總和，用於提醒教師是否湊滿 100%。 */
export function totalWeight(current = state) {
  return (current.assessments || []).reduce((sum, item) => sum + Number(item.weight || 0), 0);
}

export function uniqueId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function dateKey() { return todayKey(); }
