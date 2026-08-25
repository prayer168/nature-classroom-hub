const STORAGE_KEY = "nature-classroom-hub:v1";

const todayKey = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

export const classDefinitions = [
  { id: "c402", code: "402", name: "402 班", grade: "四年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c403", code: "403", name: "403 班", grade: "四年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c501", code: "501", name: "501 班", grade: "五年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c502", code: "502", name: "502 班", grade: "五年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c503", code: "503", name: "503 班", grade: "五年級", subject: "自然科學", schoolYear: "115 學年度" },
  { id: "c508", code: "508", name: "508 班", grade: "五年級", subject: "自然科學", schoolYear: "115 學年度" }
];

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
    .concat(defaultRewardMenu.filter(item => !currentIds.has(item.id)).map(item => ({ ...item })));
}

function normalizeState(nextState) {
  nextState.version = 2;
  nextState.classes = classDefinitions.map(item => ({ ...item }));
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
  nextState.students = (nextState.students || []).map(student => {
    const classInfo = classDefinitions.find(item => item.id === student.classId) || classDefinitions[0];
    const number = student.number || studentNumberFor(classInfo.code, student.seat);
    return { ...student, id: student.id || `stu-${number}`, number, name: `學生 ${number}`, classId: classInfo.id };
  });
  nextState.rewards ||= { ledger: [], menu: [] };
  nextState.rewards.ledger ||= [];
  nextState.rewards.menu = normalizeRewardMenu(nextState.rewards.menu);
  nextState.scores ||= {};
  nextState.attendance ||= {};
  nextState.attendanceLog ||= [];
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
    attendanceLog: [],
    observations: [],
    rewards: { ledger: buildLedger(students), menu: defaultRewardMenu.map(item => ({ ...item })) },
    assessments: initialAssessments,
    scores: buildScores(students),
    resources: [
      { id: "link-phet", name: "PhET 互動式模擬", category: "連結", type: "link", url: "https://phet.colorado.edu/zh_TW/", size: 0, grade: RESOURCE_SCOPE_ALL, createdAt: nowIso(), tags: ["模擬", "外部資源"] },
      { id: "link-junyi", name: "均一教育平台", category: "連結", type: "link", url: "https://www.junyiacademy.org/", size: 0, grade: RESOURCE_SCOPE_ALL, createdAt: nowIso(), tags: ["任務", "學習資源"] }
    ],
    toolHistory: { recentlyPicked: [] },
    settings: { appsScriptUrl: "", lastSyncAt: null, privateObservations: true, positiveOnly: true, confirmDelete: true },
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

export function activeStudents(current = state) {
  return current.students.filter(student => student.classId === current.activeClassId && student.active !== false);
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

export function studentPoints(studentId, current = state) {
  return current.rewards.ledger.filter(entry => entry.studentId === studentId).reduce((total, entry) => total + Number(entry.value || 0), 0);
}

export function studentAverage(studentId, current = state) {
  const scoreMap = current.scores[studentId] || {};
  let weighted = 0;
  let totalWeight = 0;
  current.assessments.forEach(assessment => {
    const score = scoreMap[assessment.id];
    if (score === null || score === undefined || score === "") return;
    weighted += (Number(score) / assessment.maxScore) * assessment.weight;
    totalWeight += assessment.weight;
  });
  return totalWeight ? (weighted / totalWeight) * 100 : null;
}

export function classAverage(current = state) {
  const values = activeStudents(current).map(student => studentAverage(student.id, current)).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function assessmentAverage(assessmentId, current = state) {
  const assessment = current.assessments.find(item => item.id === assessmentId);
  if (!assessment) return 0;
  const values = activeStudents(current).map(student => current.scores[student.id]?.[assessmentId]).filter(value => value !== null && value !== undefined && value !== "");
  return values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length / assessment.maxScore * 100 : 0;
}

export function uniqueId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function dateKey() { return todayKey(); }
