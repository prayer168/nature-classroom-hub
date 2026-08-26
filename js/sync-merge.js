/**
 * 雲端同步的合併核心。
 *
 * 這裡刻意不引用 Firebase 或 DOM，全部是純函式，才能單獨測試。
 *
 * 做的是三方合併（base / local / remote）：
 * base 是「這台裝置上次成功同步時的內容」。有了 base 才分得出
 * 「對方改了」和「我刪掉了」——只比對 local 與 remote 兩份，
 * 無法判斷差異是新增還是刪除，結果不是把刪掉的資料復活，
 * 就是把對方新增的東西吃掉。
 */

/** 鍵排序後再序列化，兩台裝置產生的物件鍵順序不同也不會被誤判為有差異。 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

const same = (a, b) => stableStringify(a) === stableStringify(b);
const missing = value => value === undefined;

/**
 * 以 id 為鍵的清單三方合併。
 * 只有一邊相對 base 有變動就採用那一邊；兩邊都改同一筆才算衝突。
 * 衝突時保留本機的版本，並回報讓使用者知道有東西被蓋掉。
 */
export function mergeList(base, local, remote, idKey = "id") {
  const index = items => new Map((items || []).map(item => [item[idKey], item]));
  const baseMap = index(base);
  const localMap = index(local);
  const remoteMap = index(remote);
  const conflicts = [];
  const merged = [];
  const seen = new Set();

  // 以本機順序為主、再接上遠端新增的，避免每次同步整份重排。
  const order = [...(local || []).map(item => item[idKey]), ...(remote || []).map(item => item[idKey])];
  order.forEach(id => {
    if (seen.has(id)) return;
    seen.add(id);
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    const picked = pickValue(b, l, r, conflicts, id);
    if (!missing(picked) && picked !== null) merged.push(picked);
  });
  return { value: merged, conflicts };
}

/** 巢狀物件（例如 scores[studentId][assessmentId]）逐葉節點合併。 */
export function mergeNested(base, local, remote, path = []) {
  const conflicts = [];
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {}), ...Object.keys(base || {})]);
  const merged = {};
  keys.forEach(key => {
    const b = base?.[key];
    const l = local?.[key];
    const r = remote?.[key];
    const isBranch = [b, l, r].some(value => value && typeof value === "object" && !Array.isArray(value));
    if (isBranch) {
      const nested = mergeNested(b || {}, l || {}, r || {}, [...path, key]);
      conflicts.push(...nested.conflicts);
      if (Object.keys(nested.value).length) merged[key] = nested.value;
      return;
    }
    const picked = pickValue(b, l, r, conflicts, [...path, key].join("/"));
    if (!missing(picked)) merged[key] = picked;
  });
  return { value: merged, conflicts };
}

/** 不可逐筆合併的整段值（例如設定），兩邊都改就以本機為準並回報。 */
export function mergeValue(base, local, remote, label = "value") {
  const conflicts = [];
  const picked = pickValue(base, local, remote, conflicts, label);
  return { value: missing(picked) ? local : picked, conflicts };
}

function pickValue(b, l, r, conflicts, id) {
  if (same(l, r)) return l;
  if (same(l, b)) return r;   // 只有遠端動過
  if (same(r, b)) return l;   // 只有本機動過
  conflicts.push({ id, local: l, remote: r });
  return l;                   // 真衝突：留本機，並回報被蓋掉的遠端版本
}

/**
 * 各區段怎麼從 state 取出、怎麼寫回、用哪種合併方式。
 * 出席另外依月份分片，不在這裡列出。
 */
export const SECTIONS = {
  lessons: {
    kind: "nested",
    read: state => state.lessons || {},
    write: (state, value) => { state.lessons = value; }
  },
  students: {
    kind: "list",
    read: state => state.students || [],
    write: (state, value) => { state.students = value; }
  },
  assessments: {
    kind: "list",
    read: state => state.assessments || [],
    write: (state, value) => { state.assessments = value; }
  },
  scores: {
    kind: "nested",
    read: state => state.scores || {},
    write: (state, value) => { state.scores = value; }
  },
  scoreStatus: {
    kind: "nested",
    read: state => state.scoreStatus || {},
    write: (state, value) => { state.scoreStatus = value; }
  },
  rewardsLedger: {
    kind: "list",
    read: state => state.rewards?.ledger || [],
    write: (state, value) => { state.rewards = { ...(state.rewards || {}), ledger: value }; }
  },
  rewardsMenu: {
    kind: "list",
    read: state => state.rewards?.menu || [],
    write: (state, value) => { state.rewards = { ...(state.rewards || {}), menu: value }; }
  },
  observations: {
    kind: "list",
    read: state => state.observations || [],
    write: (state, value) => { state.observations = value; }
  },
  resources: {
    kind: "list",
    read: state => state.resources || [],
    write: (state, value) => { state.resources = value; }
  },
  attendanceLog: {
    kind: "list",
    read: state => state.attendanceLog || [],
    write: (state, value) => { state.attendanceLog = value; }
  },
  transferLog: {
    kind: "list",
    read: state => state.transferLog || [],
    write: (state, value) => { state.transferLog = value; }
  },
  meta: {
    kind: "value",
    read: state => ({
      version: state.version,
      activeClassId: state.activeClassId,
      settings: state.settings,
      toolHistory: state.toolHistory
    }),
    write: (state, value) => { Object.assign(state, value || {}); }
  }
};

export const ATTENDANCE_PREFIX = "attendance:";

/** 出席依月份切片，避免整學年擠在同一份文件。 */
export function attendanceSections(state) {
  const grouped = {};
  Object.entries(state.attendance || {}).forEach(([date, day]) => {
    const month = String(date).slice(0, 7);
    grouped[`${ATTENDANCE_PREFIX}${month}`] ||= {};
    grouped[`${ATTENDANCE_PREFIX}${month}`][date] = day;
  });
  return grouped;
}

export function isAttendanceSection(name) {
  return name.startsWith(ATTENDANCE_PREFIX);
}

/** 依區段種類挑合併方式；出席分片一律是巢狀。 */
export function mergeSection(name, base, local, remote) {
  if (isAttendanceSection(name)) return mergeNested(base || {}, local || {}, remote || {}, [name]);
  const spec = SECTIONS[name];
  if (!spec) return mergeValue(base, local, remote, name);
  if (spec.kind === "list") return mergeList(base, local, remote);
  if (spec.kind === "nested") return mergeNested(base || {}, local || {}, remote || {}, [name]);
  return mergeValue(base, local, remote, name);
}

/** 把某個區段的合併結果寫回 state（會就地修改傳入的物件）。 */
export function applySection(state, name, value) {
  if (isAttendanceSection(name)) {
    state.attendance ||= {};
    Object.assign(state.attendance, value || {});
    return;
  }
  SECTIONS[name]?.write(state, value);
}

/** 取出某個區段目前的內容。 */
export function readSection(state, name) {
  if (isAttendanceSection(name)) return attendanceSections(state)[name] || {};
  return SECTIONS[name]?.read(state);
}

/** 這份 state 目前有哪些區段（固定區段 + 有資料的出席月份）。 */
export function sectionNames(state) {
  return [...Object.keys(SECTIONS), ...Object.keys(attendanceSections(state))];
}
