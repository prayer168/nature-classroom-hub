const STORAGE_KEY = "nature-classroom-hub:v1";

const todayKey = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

const names = [
  "王語晴", "李承恩", "林子宸", "張若妍", "陳品叡", "黃于庭",
  "吳柏翰", "劉欣妤", "蔡宥辰", "楊晨希", "許家睿", "鄭羽彤",
  "謝明軒", "洪詠心", "邱冠宇", "曾苡安", "賴彥廷", "徐樂歆"
];

const buildStudents = () => names.map((name, index) => ({
  id: `s${String(index + 1).padStart(2, "0")}`,
  seat: index + 1,
  name,
  classId: "c01",
  tags: index % 6 === 0 ? ["器材長"] : index % 5 === 0 ? ["需留意視力"] : [],
  note: "",
  active: true,
  createdAt: nowIso()
}));

const initialAssessments = [
  { id: "a01", name: "觀察紀錄單", type: "形成性", maxScore: 20, weight: 15, date: "2026-08-07" },
  { id: "a02", name: "實驗操作", type: "實作", maxScore: 25, weight: 25, date: "2026-08-14" },
  { id: "a03", name: "單元小測", type: "總結性", maxScore: 100, weight: 35, date: "2026-08-19" },
  { id: "a04", name: "探究發表", type: "形成性", maxScore: 20, weight: 25, date: "2026-08-22" }
];

const buildScores = () => {
  const scores = {};
  names.forEach((_, index) => {
    const studentId = `s${String(index + 1).padStart(2, "0")}`;
    scores[studentId] = {
      a01: Math.max(12, 20 - (index % 7)),
      a02: Math.max(15, 25 - (index % 8)),
      a03: Math.max(62, 93 - ((index * 7) % 28)),
      a04: index > 15 ? null : Math.max(12, 20 - (index % 6))
    };
  });
  return scores;
};

const buildLedger = () => {
  const categories = ["探究精神", "合作學習", "安全操作", "清楚表達"];
  return names.slice(0, 14).map((name, index) => ({
    id: `r${index + 1}`,
    studentId: `s${String((index % 12) + 1).padStart(2, "0")}`,
    category: categories[index % categories.length],
    value: index % 4 === 0 ? 2 : 1,
    note: index % 3 === 0 ? "小組實驗時主動協助整理證據" : "課堂即時回饋",
    createdAt: new Date(Date.now() - index * 7_200_000).toISOString()
  }));
};

export const createDemoState = () => ({
  version: 1,
  classes: [{ id: "c01", name: "六年甲班", grade: "六年級", subject: "自然科學", schoolYear: "115 學年度" }],
  activeClassId: "c01",
  lesson: { topic: "水溶液的酸鹼性", session: "第 3 節", task: "指示劑觀察與紀錄", startedAt: null },
  students: buildStudents(),
  attendance: {
    [todayKey()]: Object.fromEntries(names.map((_, index) => [`s${String(index + 1).padStart(2, "0")}`, index === 14 ? "late" : index === 16 ? "absent" : "present"]))
  },
  observations: [],
  rewards: {
    ledger: buildLedger(),
    menu: [
      { id: "m01", name: "優先選擇實驗角色", cost: 12, note: "下次實驗可優先選擇分工" },
      { id: "m02", name: "自然小博士貼紙", cost: 18, note: "實體貼紙一張" },
      { id: "m03", name: "推薦今日科學影片", cost: 25, note: "片長 5 分鐘內" }
    ]
  },
  assessments: initialAssessments,
  scores: buildScores(),
  resources: [
    { id: "link-phet", name: "PhET 互動式模擬", category: "連結", type: "link", url: "https://phet.colorado.edu/zh_TW/", size: 0, createdAt: nowIso(), tags: ["模擬", "外部資源"] },
    { id: "link-junyi", name: "均一教育平台", category: "連結", type: "link", url: "https://www.junyiacademy.org/", size: 0, createdAt: nowIso(), tags: ["任務", "學習資源"] }
  ],
  toolHistory: { recentlyPicked: [] },
  settings: {
    appsScriptUrl: "",
    lastSyncAt: null,
    privateObservations: true,
    positiveOnly: true,
    confirmDelete: true
  },
  updatedAt: nowIso()
});

let state;
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDemoState();
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 ? parsed : createDemoState();
  } catch (error) {
    console.warn("無法讀取本機資料，已載入示範資料。", error);
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
    state = clone;
    persist();
    return state;
  },
  replace(nextState) {
    if (!nextState || nextState.version !== 1 || !Array.isArray(nextState.students)) {
      throw new Error("備份格式不正確或版本不支援。");
    }
    state = structuredClone(nextState);
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

export function getTodayAttendance(current = state) {
  const key = todayKey();
  if (!current.attendance[key]) {
    current.attendance[key] = Object.fromEntries(current.students.map(student => [student.id, "present"]));
  }
  return current.attendance[key];
}

export function studentPoints(studentId, current = state) {
  return current.rewards.ledger
    .filter(entry => entry.studentId === studentId)
    .reduce((total, entry) => total + Number(entry.value || 0), 0);
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
  const values = current.students.map(student => studentAverage(student.id, current)).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function assessmentAverage(assessmentId, current = state) {
  const assessment = current.assessments.find(item => item.id === assessmentId);
  if (!assessment) return 0;
  const values = current.students.map(student => current.scores[student.id]?.[assessmentId]).filter(value => value !== null && value !== undefined && value !== "");
  return values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length / assessment.maxScore * 100 : 0;
}

export function uniqueId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function dateKey() { return todayKey(); }
