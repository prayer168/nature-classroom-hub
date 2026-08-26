import { renderChrome } from "./chrome.js";
import { store, activeClass, activeStudents, inactiveStudents, deletedStudents, occupiedSeats, freeSeats, transferStudent, setStudentSeat, prizeStock, prizeSoldOut, pendingDeliveries, activeLesson, activeGrade, visibleResources, resourceScopes, RESOURCE_SCOPE_ALL, studentNumberFor, getTodayAttendance, attendanceDatesInMonth, attendanceAdjustedOn, setAttendance, studentPoints, studentAverage, classAverage, assessmentAverage, totalWeight, effectiveScore, isAbsentExam, absentExamScore, scoreStatusOf, setScoreStatus, ABSENT_PENALTY, uniqueId, dateKey } from "./store.js";
import { saveFile, getFile, deleteFile } from "./resource-db.js";
import QRCode from "qrcode";
import { isFirebaseConfigured } from "./firebase-config.js";
import { pingGoogle, syncToGoogle, fetchGoogleBackup, uploadFileToGoogle, createGoogleDocReport, createStudentGoogleDocReport, diagnoseGoogle, selfTestGoogle, isValidAppsScriptUrl, compareScriptVersion, EXPECTED_SCRIPT_VERSION } from "./google-bridge.js";

const page = document.body.dataset.page;
const classroomReferenceUrl = new URL("../assets/images/classroom-layout-reference.jpg", import.meta.url).href;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const formatDate = value => new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const formatDay = value => new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(value);
const statusLabel = { present: "到課", absent: "缺席", late: "遲到" };

renderChrome();

/**
 * Firebase SDK 有 200 KB 以上（gzip），每頁都載入太重。
 * 只在「設定頁」或「這台裝置登入過」時才動態載入雲端模組。
 */
const CLOUD_ACTIVE_KEY = "nature-classroom-hub:cloud-active";
let cloudModulePromise = null;
function loadCloud() {
  cloudModulePromise ||= import("./cloud.js");
  return cloudModulePromise;
}
if (isFirebaseConfigured && (page === "settings" || localStorage.getItem(CLOUD_ACTIVE_KEY) === "1")) {
  loadCloud().then(cloud => cloud.initCloud()).catch(error => console.warn("無法載入雲端模組", error));
}

function toast(message, type = "success") {
  const region = $("#toast-region");
  if (!region) return;
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`;
  node.textContent = message;
  region.append(node);
  setTimeout(() => node.remove(), 3200);
}

function openModal({ title, subtitle = "", body = "", className = "", onReady }) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop" role="presentation"><section class="modal ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="modal-close" aria-label="關閉">×</button></header>${body}</section></div>`;
  const close = () => { root.innerHTML = ""; };
  root.querySelector(".modal-close").addEventListener("click", close);
  root.querySelector(".modal-backdrop").addEventListener("click", event => { if (event.target === event.currentTarget) close(); });
  const onEscape = event => { if (event.key === "Escape") { close(); document.removeEventListener("keydown", onEscape); } };
  document.addEventListener("keydown", onEscape);
  root.querySelector("input, select, textarea, button")?.focus();
  onReady?.(root.querySelector(".modal"), close);
  return close;
}

function statCard(label, value, foot, icon = "•") {
  return `<article class="stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${esc(icon)}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-foot">${foot}</div></article>`;
}

function download(name, content, type = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvEscape(value) {
  const string = String(value ?? "");
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function studentPicker({ multiple = true } = {}) {
  const state = store.get();
  return `<div class="student-picker">${activeStudents(state).map(student => `<label><input type="${multiple ? "checkbox" : "radio"}" name="studentIds" value="${student.id}"><span>${student.seat}. ${esc(student.number)}</span></label>`).join("")}</div>`;
}

function selectedStudentIds(modal) {
  return [...modal.querySelectorAll('[name="studentIds"]:checked')].map(input => input.value);
}

function showPointModal(defaultCategory = "探究精神", defaultValue = 1, supportMode = false) {
  openModal({
    title: supportMode ? "記錄需要支持" : "給予正向點數",
    subtitle: supportMode ? "這筆觀察預設只供教師查看，不會扣點。" : "可同時選擇多位學生。",
    body: `<form id="point-form"><div class="form-grid"><label class="field full-field">選擇學生${studentPicker()}</label><label class="field">回饋類型<input name="category" value="${esc(defaultCategory)}" required></label><label class="field">點數<input name="value" type="number" min="0" max="10" value="${supportMode ? 0 : Number(defaultValue)}" ${supportMode ? "readonly" : ""} required></label><label class="field full-field">觀察備註<textarea name="note" rows="3" placeholder="例如：能主動比較兩組實驗結果"></textarea></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">儲存紀錄</button></div></form>`,
    onReady(modal, close) {
      modal.querySelector("[data-close]").addEventListener("click", close);
      modal.querySelector("form").addEventListener("submit", event => {
        event.preventDefault();
        const ids = selectedStudentIds(modal);
        if (!ids.length) return toast("請至少選擇一位學生。", "error");
        const data = new FormData(event.currentTarget);
        const category = String(data.get("category"));
        const value = supportMode ? 0 : Number(data.get("value"));
        const note = String(data.get("note") || "");
        store.update(draft => {
          ids.forEach(studentId => {
            draft.rewards.ledger.unshift({ id: uniqueId("reward"), studentId, category, value, note, createdAt: new Date().toISOString() });
            draft.observations.unshift({ id: uniqueId("obs"), studentId, category, level: supportMode ? "support" : "positive", note, lesson: activeLesson(draft).topic, createdAt: new Date().toISOString() });
          });
        });
        close();
        initPage();
        toast(`已為 ${ids.length} 位學生儲存${supportMode ? "觀察" : "點數"}。`);
      });
    }
  });
}

function initDashboard() {
  const state = store.get();
  const students = activeStudents(state);
  const studentIds = new Set(students.map(student => student.id));
  const attendance = getTodayAttendance(state);
  const present = students.filter(student => attendance[student.id] === "present").length;
  const todayRewards = state.rewards.ledger.filter(entry => studentIds.has(entry.studentId) && entry.createdAt.slice(0, 10) === dateKey()).length;
  $("#today-label").textContent = formatDay(new Date());
  $("#dashboard-stats").innerHTML = [
    statCard("今日到課", `${present}/${students.length}`, `<strong>${students.length ? Math.round(present / students.length * 100) : 0}%</strong> 到課率`, "到"),
    statCard("今日正向回饋", todayRewards, "持續看見具體行為", "＋"),
    statCard("班級學業平均", `${classAverage(state).toFixed(1)}`, "依目前有成績項目計算", "分"),
    statCard("待補交", students.filter(student => Object.values(state.scores[student.id] || {}).some(value => value === null)).length, "點擊成績簿查看名單", "待")
  ].join("");
  $("#quick-attendance").innerHTML = students.map(student => `<button class="student-chip" data-student-id="${student.id}" data-status="${attendance[student.id] || "present"}" aria-label="學生 ${esc(student.number)}，${statusLabel[attendance[student.id]] || "到課"}"><span class="seat">${student.seat} 號</span><strong>${esc(student.number)}</strong></button>`).join("");
  $("#sync-pill").textContent = state.settings.appsScriptUrl ? "Google 待同步" : "本機模式";
  $("#sync-pill").className = `status-pill ${state.settings.appsScriptUrl ? "status-connected" : "status-local"}`;
  const lesson = activeLesson(state);
  $("#lesson-topic").textContent = lesson.topic;
  $("#lesson-session").textContent = lesson.session || "—";
  $("#lesson-task").textContent = lesson.task || "—";
  const weekly = [{ day: "一", a: 92, p: 73 }, { day: "二", a: 96, p: 78 }, { day: "三", a: 96, p: 84 }, { day: "四", a: 100, p: 82 }, { day: "五", a: 94, p: 88 }];
  $("#pulse-chart").innerHTML = weekly.map(item => `<div class="bar-group"><i class="bar" style="height:${item.a}%" title="出席 ${item.a}%"></i><i class="bar secondary" style="height:${item.p}%" title="參與 ${item.p}%"></i><label>週${item.day}</label></div>`).join("");
  $("#pulse-summary").innerHTML = `<strong>本週亮點：</strong> 合作學習回饋比上週增加，探究發表的完成度也正在上升。`;
  $("#follow-up-list").innerHTML = `<li><span class="task-badge">${students.filter(student => state.scores[student.id]?.a04 === null).length}</span><div><strong>探究發表待補交</strong><small>建議下節課安排 8 分鐘完成</small></div><a href="grades.html">查看</a></li><li><span class="task-badge">${students.filter(student => attendance[student.id] === "absent").length}</span><div><strong>今日缺席學生</strong><small>補發實驗安全與紀錄單</small></div><a href="students.html">查看</a></li><li><span class="task-badge">3</span><div><strong>教材尚未備份</strong><small>離線檔案建議同步到 Drive</small></div><a href="settings.html">設定</a></li>`;

  $$(".student-chip").forEach(button => button.addEventListener("click", () => {
    const order = ["present", "late", "absent"];
    const next = order[(order.indexOf(button.dataset.status) + 1) % order.length];
    store.update(draft => { getTodayAttendance(draft); setAttendance(draft, dateKey(), button.dataset.studentId, next); });
    initDashboard();
    toast(`已更新為「${statusLabel[next]}」。`);
  }));
  $$('[data-quick-point]').forEach(button => button.addEventListener("click", () => showPointModal(button.dataset.quickPoint, Number(button.dataset.value), button.dataset.quickPoint === "需要支持")));
  $('[data-action="all-present"]').onclick = () => { store.update(draft => activeStudents(draft).forEach(student => { getTodayAttendance(draft)[student.id] = "present"; })); initDashboard(); toast("已將全班標記為到課。"); };
  $('[data-action="start-class"]').onclick = () => { store.update(draft => { activeLesson(draft).startedAt = new Date().toISOString(); }); toast(`${activeClass(store.get()).name}課堂已開始，祝今天探究順利！`); };
  $('[data-action="edit-lesson"]').onclick = () => openLessonModal();
}

function openLessonModal() {
  const state = store.get();
  const lesson = activeLesson(state);
  const className = activeClass(state).name;
  openModal({ title: "編輯今日課堂", subtitle: `目前只會更新${className}的課程單元，其他班級不受影響。`, body: `<form id="lesson-form"><div class="form-grid"><label class="field full-field">單元主題<input name="topic" value="${esc(lesson.topic)}" required></label><label class="field">課次<input name="session" value="${esc(lesson.session)}"></label><label class="field">今日任務<input name="task" value="${esc(lesson.task)}"></label></div><div class="modal-actions"><button class="btn btn-light" type="button" data-close>取消</button><button class="btn btn-primary">儲存</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); store.update(draft => { const target = activeLesson(draft); target.topic = String(data.get("topic")); target.session = String(data.get("session")); target.task = String(data.get("task")); }); close(); initDashboard(); toast(`${className}的課堂資訊已更新。`); };
  }});
}

const classroomTables = {
  A: { label: "第一組", seats: [7, 22, 2, 17, 27, 12] },
  B: { label: "第二組", seats: [6, 21, 1, 16, 26, 11] },
  C: { label: "第三組", seats: [9, 24, 4, 19, 29, 14] },
  D: { label: "第四組", seats: [8, 23, 3, 18, 28, 13] },
  E: { label: "第五組", seats: [10, 25, 5, 20, 30, 15] }
};

const zoneDetails = {
  "教師角": { use: "課堂中控、實物投影、教材與教學紀錄管理。", reminder: "投影前先切換投影模式，避免顯示個別學生資料。" },
  "魚菜共生系統": { use: "觀察水循環、生物交互作用、水質與植物生長。", reminder: "每日確認水位、魚隻狀態與電源；學生操作後要洗手。" },
  "自然教具區": { use: "地球科學、昆蟲、礦物與生物模型的觀察與分類。", reminder: "標本與模型使用後依標籤歸位，易碎教具由教師或器材長取放。" },
  "新興科技工作坊": { use: "3D 列印、雷射切割、數位製造與工程設計。", reminder: "高溫與運轉設備需由教師監督，啟動前確認護具與通風。" },
  "自然教具展示區": { use: "顯微鏡、玻璃器材、岩礦、標本與人體／地科模型展示。", reminder: "長走道保持淨空；玻璃器材與藥品不得放在展示區邊緣。" }
};

function initClassroom() {
  const state = store.get();
  const students = activeStudents(state);
  const attendance = getTodayAttendance(state);
  const assigned = students.filter(student => student.seat >= 1 && student.seat <= 30).length;
  const present = students.filter(student => attendance[student.id] === "present").length;
  const late = students.filter(student => attendance[student.id] === "late").length;
  const absent = students.filter(student => attendance[student.id] === "absent").length;
  $("#classroom-topic").textContent = activeLesson(state).topic;
  $("#classroom-summary").innerHTML = [
    ["配置座位", `${assigned}/30`], ["今日到課", present], ["今日遲到", late], ["今日缺席", absent]
  ].map(([label, value]) => `<article class="classroom-summary-card"><span>${label}</span><strong>${value}</strong></article>`).join("");

  Object.entries(classroomTables).forEach(([tableId, table]) => {
    const tableNode = document.querySelector(`[data-table="${tableId}"]`);
    tableNode.dataset.groupLabel = table.label;
    tableNode.innerHTML = table.seats.map(seat => {
      const student = students.find(item => Number(item.seat) === seat);
      const status = student ? attendance[student.id] || "present" : "empty";
      const label = student ? `${seat} 號學生 ${student.number}，${statusLabel[status]}` : `${seat} 號空位`;
      return `<button class="seat-button" data-seat="${seat}" data-student-id="${student?.id || ""}" data-status="${status}" aria-label="${esc(label)}"><span class="seat-number">${seat}</span><span class="seat-name">${esc(student?.number || "空位")}</span></button>`;
    }).join("");
  });

  $$(".seat-button").forEach(button => button.onclick = () => showSeatModal(Number(button.dataset.seat), button.dataset.studentId || null));
  $$("[data-zone]").forEach(button => button.onclick = () => showZoneModal(button.dataset.zone));
  $('[data-action="show-layout-reference"]').onclick = showLayoutReference;
  $('[data-action="group-points"]').onclick = showGroupPointModal;
  $('[data-action="classroom-project"]').onclick = () => {
    document.body.classList.toggle("classroom-projecting");
    const projecting = document.body.classList.contains("classroom-projecting");
    $('[data-action="classroom-project"]').textContent = projecting ? "離開投影模式" : "進入投影模式";
    toast(projecting ? "已隱藏學生編號與個別狀態。" : "已返回教師操作模式。");
  };
}

function showSeatModal(seat, studentId) {
  if (!studentId) {
    openModal({ title: `${seat} 號座位`, subtitle: "這個座位目前尚未安排學生。", body: `<div class="notice"><strong>空位</strong><span>可到學生與班級頁新增學生，並將座號設為 ${seat}。</span></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>關閉</button><a class="btn btn-primary" href="students.html">前往安排</a></div>`, onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; } });
    return;
  }
  const state = store.get();
  const student = state.students.find(item => item.id === studentId);
  const currentStatus = getTodayAttendance(state)[studentId] || "present";
  const average = studentAverage(studentId, state);
  openModal({
    title: `${seat} 號 · ${student.name}`,
    subtitle: `目前狀態：${statusLabel[currentStatus]}`,
    body: `<div class="stats-grid"><article class="stat-card"><div class="stat-top"><span>獎勵點數</span></div><div class="stat-value">${studentPoints(studentId, state)}</div><div class="stat-foot">本期可用點數</div></article><article class="stat-card"><div class="stat-top"><span>學業平均</span></div><div class="stat-value">${average?.toFixed(1) || "—"}</div><div class="stat-foot">依目前評量權重</div></article></div><div class="form-grid"><label class="field full-field">更新今日狀態<select id="seat-status"><option value="present" ${currentStatus === "present" ? "selected" : ""}>到課</option><option value="late" ${currentStatus === "late" ? "selected" : ""}>遲到</option><option value="absent" ${currentStatus === "absent" ? "selected" : ""}>缺席</option></select></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>關閉</button><button type="button" class="btn btn-secondary" data-seat-point>給予點數</button><button type="button" class="btn btn-primary" data-save-status>儲存狀態</button></div>`,
    onReady(modal, close) {
      modal.querySelector("[data-close]").onclick = close;
      modal.querySelector("[data-seat-point]").onclick = () => { close(); showPointModalForOne(studentId); };
      modal.querySelector("[data-save-status]").onclick = () => {
        const status = modal.querySelector("#seat-status").value;
        store.update(draft => { getTodayAttendance(draft)[studentId] = status; });
        close(); initClassroom(); toast(`${student.name} 已更新為「${statusLabel[status]}」。`);
      };
    }
  });
}

function showZoneModal(zone) {
  const detail = zoneDetails[zone];
  openModal({ title: zone, subtitle: "自然教室場域說明", body: `<div class="zone-details"><div class="notice"><strong>教學用途</strong><span>${esc(detail.use)}</span></div><div class="notice privacy-notice"><strong>使用提醒</strong><span>${esc(detail.reminder)}</span></div></div><div class="modal-actions"><button type="button" class="btn btn-primary" data-close>知道了</button></div>`, onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; } });
}

function showLayoutReference() {
  openModal({ title: "自然教室一 · 原配置圖", subtitle: "由教師提供，互動座位圖依此配置製作。", className: "large", body: `<img class="reference-image" src="${classroomReferenceUrl}" alt="自然教室一配置圖，包含教師角、白板、講桌、魚菜共生系統、自然教具區、新興科技工作坊與五張實驗桌。"><div class="modal-actions"><button type="button" class="btn btn-primary" data-close>關閉</button></div>`, onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; } });
}

function initStudents() {
  const render = () => {
    const state = store.get();
    const currentClass = activeClass(state);
    const query = $("#student-search").value.trim().toLowerCase();
    const filter = $("#student-status-filter").value;
    const sort = $("#student-sort").value;
    const attendance = getTodayAttendance(state);
    const showInactive = $("#show-inactive").checked;
    const pool = showInactive ? [...activeStudents(state), ...inactiveStudents(state)] : activeStudents(state);
    const students = pool.filter(student => {
      const matchesText = `${student.number} ${student.seat} ${student.tags.join(" ")}`.toLowerCase().includes(query);
      return matchesText && (filter === "all" || attendance[student.id] === filter);
    });
    const compareValue = (student, metric) => metric === "points" ? studentPoints(student.id, state) : studentAverage(student.id, state);
    const [sortMetric, direction] = sort.split("-");
    students.sort((a, b) => {
      if (sortMetric === "seat") return (a.seat - b.seat) * (direction === "desc" ? -1 : 1);
      const metric = sortMetric === "grade" ? "grade" : "points";
      const aValue = compareValue(a, metric), bValue = compareValue(b, metric);
      if (aValue === null && bValue !== null) return 1;
      if (bValue === null && aValue !== null) return -1;
      return ((aValue ?? 0) - (bValue ?? 0)) * (direction === "desc" ? -1 : 1) || a.seat - b.seat;
    });
    $("#student-table-body").innerHTML = students.map(student => {
      const status = attendance[student.id] || "present";
      const average = studentAverage(student.id, state);
      const inactive = student.active === false;
      return `<tr class="${inactive ? "is-inactive" : ""}"><td><button class="student-cell as-link" data-detail-student="${student.id}" title="查看個人趨勢"><span class="avatar">${student.seat}</span><div><strong>${esc(student.number)}</strong><small>${esc(currentClass.name)} · ${student.seat} 號${inactive ? " · 已停用" : ""}</small></div></button></td><td>${inactive ? '<span class="badge">停用</span>' : `<span class="badge ${status}">${statusLabel[status]}</span>`}</td><td><strong>${studentPoints(student.id, state)}</strong> 點</td><td>${average === null ? "—" : `<strong>${average.toFixed(1)}</strong>`}</td><td>${student.tags.length ? student.tags.map(tag => `<span class="tag">${esc(tag)}</span>`).join("") : '<span class="muted">—</span>'}</td><td><div class="row-actions"><button data-edit-student="${student.id}">編輯</button><button data-student-point="${student.id}">加點</button><button data-transfer-student="${student.id}">轉班</button><button data-toggle-active="${student.id}">${inactive ? "恢復" : "停用"}</button><button class="danger" data-delete-student="${student.id}">刪除</button></div></td></tr>`;
    }).join("");
    $("#student-empty").hidden = students.length > 0;
    $$('[data-detail-student]').forEach(button => button.onclick = () => showStudentDetail(button.dataset.detailStudent));
    $$('[data-edit-student]').forEach(button => button.onclick = () => showStudentModal(button.dataset.editStudent));
    $$('[data-student-point]').forEach(button => button.onclick = () => showPointModalForOne(button.dataset.studentPoint));
    $$('[data-transfer-student]').forEach(button => button.onclick = () => showTransferModal(button.dataset.transferStudent));
    $$('[data-toggle-active]').forEach(button => button.onclick = () => toggleStudentActive(button.dataset.toggleActive));
    $$('[data-delete-student]').forEach(button => button.onclick = () => deleteStudent(button.dataset.deleteStudent));
    const trashed = deletedStudents(state).length;
    $("#trash-count").hidden = !trashed;
    $("#trash-count").textContent = trashed;
    renderStudentAnalytics(state);
  };
  studentsRender = render;
  $("#student-search").oninput = render;
  $("#student-status-filter").onchange = render;
  $("#student-sort").onchange = render;
  $("#student-chart-metric").onchange = render;
  $("#show-inactive").onchange = render;
  $('[data-action="open-trash"]').onclick = showTrashModal;
  $('[data-action="add-student"]').onclick = () => showStudentModal();
  $('[data-action="export-students"]').onclick = exportStudents;
  $('[data-action="import-students"]').onclick = importStudents;
  $('[data-action="student-template"]').onclick = downloadStudentTemplate;
  render();
}

function renderStudentAnalytics(state) {
  const students = activeStudents(state);
  const currentClass = activeClass(state);
  const gradeValues = students.map(student => studentAverage(student.id, state)).filter(value => value !== null).sort((a, b) => a - b);
  const pointValues = students.map(student => studentPoints(student.id, state));
  const median = gradeValues.length ? (gradeValues[Math.floor((gradeValues.length - 1) / 2)] + gradeValues[Math.ceil((gradeValues.length - 1) / 2)]) / 2 : null;
  const averagePoints = pointValues.length ? pointValues.reduce((sum, value) => sum + value, 0) / pointValues.length : 0;
  $("#student-analytics-stats").innerHTML = [
    statCard("學生人數", students.length, `${currentClass.name}匿名名冊`, "人"),
    statCard("班級平均", gradeValues.length ? classAverage(state).toFixed(1) : "—", "學業成績（滿分 100）", "分"),
    statCard("成績中位數", median === null ? "—" : median.toFixed(1), "降低極端值干擾", "中"),
    statCard("平均獎勵點數", averagePoints.toFixed(1), "點數與成績分開計算", "點")
  ].join("");
  const metric = $("#student-chart-metric").value;
  const unit = metric === "grade" ? "分" : "點";
  const label = metric === "grade" ? "學業平均" : "獎勵點數";
  const ranked = students.map(student => ({ student, value: metric === "grade" ? studentAverage(student.id, state) : studentPoints(student.id, state) })).filter(item => item.value !== null).sort((a, b) => b.value - a.value || a.student.seat - b.student.seat).slice(0, 10);
  const max = metric === "grade" ? 100 : Math.max(1, ...ranked.map(item => Math.max(0, item.value)));
  $("#student-chart-subtitle").textContent = `${currentClass.name}前 ${ranked.length} 名 · ${label}（${unit}）· 橫軸從 0 起算`;
  const chart = $("#student-comparison-chart");
  chart.setAttribute("aria-label", `${currentClass.name}${label}前 ${ranked.length} 名：${ranked.map(item => `學生 ${item.student.number} ${Number(item.value).toFixed(metric === "grade" ? 1 : 0)}${unit}`).join("，") || "尚無資料"}`);
  chart.innerHTML = ranked.length ? ranked.map(item => `<div class="ranking-row"><span class="ranking-label">${esc(item.student.number)}</span><span class="ranking-track"><i class="ranking-bar" style="width:${Math.max(0, item.value) / max * 100}%"></i></span><strong class="ranking-value">${Number(item.value).toFixed(metric === "grade" ? 1 : 0)} ${unit}</strong></div>`).join("") : '<div class="empty-state"><p>尚無可視覺化的資料。</p></div>';
}


/* ------------------------------------------------------- 學生個人趨勢面板 */

/** 依評量日期排序後的個人得分與班級平均對照。 */
function scoreTrend(studentId, state) {
  return [...state.assessments]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(item => {
      const raw = effectiveScore(studentId, item.id, state);
      return {
        name: item.name,
        date: item.date,
        percent: raw === null ? null : Number(raw) / item.maxScore * 100,
        classPercent: assessmentAverage(item.id, state),
        absent: isAbsentExam(studentId, item.id, state)
      };
    });
}

/** 逐月出席統計，由舊到新。 */
function attendanceTrend(studentId, state) {
  const months = new Map();
  Object.entries(state.attendance || {}).forEach(([date, day]) => {
    const status = day?.[studentId];
    if (!status) return;
    const month = date.slice(0, 7);
    const bucket = months.get(month) || { month, present: 0, late: 0, absent: 0 };
    if (bucket[status] !== undefined) bucket[status] += 1;
    months.set(month, bucket);
  });
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(item => {
      const recorded = item.present + item.late + item.absent;
      return { ...item, recorded, rate: recorded ? (item.present + item.late) / recorded * 100 : 0 };
    });
}

/** 點數累積曲線；兌換會讓累積往下掉，順便標出來。 */
function pointsTrend(studentId, state) {
  const entries = state.rewards.ledger
    .filter(entry => entry.studentId === studentId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let running = 0;
  return entries.map(entry => {
    running += Number(entry.value || 0);
    return { at: entry.createdAt, value: Number(entry.value || 0), total: running, note: entry.note, category: entry.category };
  });
}

/** 共用的迷你長條圖：零基線、可標對照線、可淡化特殊資料點。 */
function miniChart(points, { max = 100, formatter = value => String(Math.round(value)) } = {}) {
  if (!points.length) return '<p class="muted">尚無資料。</p>';
  const ceiling = Math.max(max, ...points.map(point => point.value || 0)) || 1;
  return `<div class="mini-chart">${points.map(point => {
    const height = point.value === null ? 0 : Math.max(2, (point.value / ceiling) * 100);
    const reference = point.reference === undefined || point.reference === null
      ? ""
      : `<i class="mini-reference" style="bottom:${Math.min(100, (point.reference / ceiling) * 100)}%"></i>`;
    return `<div class="mini-bar-group"${point.title ? ` title="${esc(point.title)}"` : ""}><span class="mini-value">${point.value === null ? "—" : formatter(point.value)}</span><span class="mini-track"><i class="mini-bar${point.muted ? " is-muted" : ""}" style="height:${height}%"></i>${reference}</span><label>${esc(point.label)}</label></div>`;
  }).join("")}</div>`;
}

function showStudentDetail(studentId) {
  const state = store.get();
  const student = state.students.find(item => item.id === studentId);
  if (!student) return;
  const className = state.classes.find(item => item.id === student.classId)?.name || "";
  const average = studentAverage(studentId, state);
  const points = studentPoints(studentId, state);

  const scores = scoreTrend(studentId, state);
  const attendance = attendanceTrend(studentId, state);
  const ledger = pointsTrend(studentId, state);
  const observations = state.observations.filter(item => item.studentId === studentId).slice(0, 12);

  const scoreChart = miniChart(scores.map(item => ({
    label: item.name.length > 4 ? `${item.name.slice(0, 4)}…` : item.name,
    value: item.percent,
    reference: item.classPercent,
    muted: item.absent,
    title: `${item.name}（${item.date}）｜個人 ${item.percent === null ? "未評量" : `${item.percent.toFixed(0)}%`}／班級平均 ${item.classPercent.toFixed(0)}%${item.absent ? "｜缺考" : ""}`
  })), { formatter: value => `${value.toFixed(0)}%` });

  const attendanceChart = miniChart(attendance.map(item => ({
    label: item.month.slice(5),
    value: item.rate,
    title: `${item.month}｜到課 ${item.present}、遲到 ${item.late}、缺席 ${item.absent}`
  })), { formatter: value => `${value.toFixed(0)}%` });

  const pointsChart = ledger.length
    ? miniChart(ledger.slice(-12).map(item => ({
      label: formatDate(item.at).slice(0, 5),
      value: Math.max(0, item.total),
      muted: item.value < 0,
      title: `${formatDate(item.at)}｜${item.category}${item.note ? `：${item.note}` : ""}（${item.value > 0 ? "+" : ""}${item.value}）累積 ${item.total}`
    })), { max: Math.max(10, ...ledger.map(item => item.total)), formatter: value => String(value) })
    : '<p class="muted">尚無點數紀錄。</p>';

  const timeline = observations.length
    ? `<ol class="observation-timeline">${observations.map(item => `<li class="level-${esc(item.level || "positive")}"><div><strong>${esc(item.category)}</strong><small>${formatDate(item.createdAt)}${item.lesson ? ` · ${esc(item.lesson)}` : ""}</small></div>${item.note ? `<p>${esc(item.note)}</p>` : ""}</li>`).join("")}</ol>`
    : '<p class="muted">尚無觀察紀錄。</p>';

  openModal({
    title: `學生 ${student.number}`,
    subtitle: `${className}｜${student.seat} 號｜加權平均 ${average === null ? "—" : average.toFixed(1)}｜目前 ${points} 點`,
    className: "large",
    body: `<div class="student-detail" id="student-detail">
      <section><h3>成績逐次評量趨勢</h3>${scoreChart}<p class="table-help">灰線是該次評量的班級平均；淡色柱代表缺考、以推算分數計算。</p></section>
      <section><h3>出席逐月統計</h3>${attendanceChart}</section>
      <section><h3>點數累積</h3>${pointsChart}<p class="table-help">淡色柱代表該筆是兌換扣點。</p></section>
      <section><h3>觀察紀錄</h3>${timeline}</section>
    </div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>關閉</button></div>`,
    onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; }
  });
}

function showStudentModal(studentId = null) {
  const state = store.get();
  const current = state.students.find(student => student.id === studentId);
  const currentClass = activeClass(state);
  const occupied = new Set(activeStudents(state).filter(student => student.id !== studentId).map(student => Number(student.seat)));
  const availableSeats = Array.from({ length: 30 }, (_, index) => index + 1).filter(seat => !occupied.has(seat));
  const defaultSeat = current?.seat ?? availableSeats[0];
  if (!current && !defaultSeat) return toast("目前班級 30 個座號皆已建立。", "error");
  openModal({ title: current ? "編輯學生資料" : "新增匿名學生", subtitle: `${currentClass.name}只使用學生編號，不輸入真實姓名。`, body: `<form><div class="form-grid"><label class="field">座號<select name="seat" ${current ? "disabled" : ""}>${(current ? [current.seat] : availableSeats).map(seat => `<option value="${seat}" ${seat === defaultSeat ? "selected" : ""}>${seat} 號</option>`).join("")}</select></label><label class="field">學生編號<input value="${esc(current?.number || studentNumberFor(currentClass.code, defaultSeat))}" readonly></label><label class="field full-field">標籤（以逗號分隔）<input name="tags" value="${esc(current?.tags?.join(", ") || "")}" placeholder="例如：器材長, 需留意視力"></label><label class="field full-field">教師私密備註<textarea name="note" rows="3">${esc(current?.note || "")}</textarea></label></div><div class="notice privacy-notice"><strong>匿名原則</strong><span>系統會以「學生編號」識別學生；即使匯入檔含姓名欄，也不會儲存姓名。</span></div><div class="modal-actions">${current ? '<button class="btn btn-danger-quiet" type="button" data-delete>刪除</button>' : ""}<button class="btn btn-light" type="button" data-close>取消</button><button class="btn btn-primary">儲存</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector('[name="seat"]')?.addEventListener("change", event => { modal.querySelector('input[readonly]').value = studentNumberFor(currentClass.code, Number(event.target.value)); });
    modal.querySelector("form").onsubmit = event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      store.update(draft => {
        const seat = current?.seat ?? Number(data.get("seat"));
        const number = studentNumberFor(currentClass.code, seat);
        const payload = { seat, number, name: `學生 ${number}`, tags: String(data.get("tags") || "").split(/[,，]/).map(item => item.trim()).filter(Boolean), note: String(data.get("note") || "") };
        if (current) Object.assign(draft.students.find(item => item.id === current.id), payload);
        else { const id = `stu-${number}`; draft.students.push({ id, classId: draft.activeClassId, active: true, createdAt: new Date().toISOString(), ...payload }); draft.scores[id] = {}; getTodayAttendance(draft)[id] = "present"; }
      });
      close(); initStudents(); toast(current ? "學生資料已更新。" : "已新增匿名學生。");
    };
    modal.querySelector("[data-delete]")?.addEventListener("click", () => { close(); deleteStudent(current.id); });
  }});
}

let studentsRender = () => {};

/** 軟刪除：移進回收筒，相關紀錄原封不動保留，可隨時還原。 */
function deleteStudent(studentId) {
  const student = store.get().students.find(item => item.id === studentId);
  if (!student) return;
  if (store.get().settings.confirmDelete && !confirm(`確定把學生 ${student.number} 移到回收筒？\n成績、點數、出席與觀察紀錄都會保留，可隨時還原。`)) return;
  store.update(draft => {
    const target = draft.students.find(item => item.id === studentId);
    if (target) target.deletedAt = new Date().toISOString();
  });
  studentsRender();
  toast(`學生 ${student.number} 已移到回收筒，可在回收筒還原。`);
}

function toggleStudentActive(studentId) {
  const student = store.get().students.find(item => item.id === studentId);
  if (!student) return;
  const nextActive = student.active === false;
  store.update(draft => {
    const target = draft.students.find(item => item.id === studentId);
    if (target) target.active = nextActive;
  });
  studentsRender();
  toast(nextActive ? `已恢復 ${student.number}，重新列入班級名單。` : `已停用 ${student.number}，歷史紀錄保留但不列入名單與統計。`);
}

function showTransferModal(studentId) {
  const state = store.get();
  const student = state.students.find(item => item.id === studentId);
  if (!student) return;
  const targets = state.classes.filter(item => item.id !== student.classId);
  const seatOptionsFor = classId => {
    const free = freeSeats(classId, state, studentId);
    return free.length
      ? free.map(seat => `<option value="${seat}"${seat === Number(student.seat) ? " selected" : ""}>${seat} 號${seat > 30 ? "（加號）" : ""}</option>`).join("")
      : '<option value="">（此班座號已滿）</option>';
  };
  openModal({
    title: "轉班",
    subtitle: `${student.number}｜成績、出席、點數與觀察紀錄都會一起轉移。`,
    body: `<form><div class="form-grid"><label class="field">轉入班級<select name="toClassId">${targets.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select></label><label class="field">新座號<select name="toSeat">${seatOptionsFor(targets[0]?.id)}</select></label></div><p class="muted" id="transfer-preview"></p><div class="notice privacy-notice"><strong>學生編號會改成新班級的編號</strong><span>原編號會記錄在轉班紀錄中，方便日後查證。</span></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">確認轉班</button></div></form>`,
    onReady(modal, close) {
      const classSelect = modal.querySelector('[name="toClassId"]');
      const seatSelect = modal.querySelector('[name="toSeat"]');
      const preview = modal.querySelector("#transfer-preview");
      const refresh = () => {
        const target = state.classes.find(item => item.id === classSelect.value);
        const seat = seatSelect.value;
        preview.textContent = seat ? `編號將由 ${student.number} 改為 ${studentNumberFor(target.code, seat)}。` : "此班座號已滿，請先停用或轉出其他學生。";
      };
      classSelect.onchange = () => { seatSelect.innerHTML = seatOptionsFor(classSelect.value); refresh(); };
      seatSelect.onchange = refresh;
      refresh();
      modal.querySelector("[data-close]").onclick = close;
      modal.querySelector("form").onsubmit = event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const toClassId = String(data.get("toClassId"));
        const toSeat = String(data.get("toSeat"));
        if (!toSeat) return toast("該班座號已滿，無法轉入。", "error");
        let result = null;
        store.update(draft => { result = transferStudent(draft, studentId, toClassId, toSeat); });
        close();
        studentsRender();
        toast(result ? `已轉班：${result.fromNumber} → ${result.toNumber}。` : "轉班失敗。", result ? "success" : "error");
      };
    }
  });
}

function showTrashModal() {
  const state = store.get();
  const trashed = deletedStudents(state);
  const classNameOf = classId => state.classes.find(item => item.id === classId)?.name || "—";
  const body = trashed.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>學生編號</th><th>原班級</th><th>刪除時間</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${trashed.map(student => `<tr><td><strong>${esc(student.number)}</strong><small class="muted"> · ${student.seat} 號</small></td><td>${esc(classNameOf(student.classId))}</td><td>${formatDate(student.deletedAt)}</td><td><div class="row-actions"><button data-restore="${student.id}">還原</button><button class="danger" data-purge="${student.id}">徹底刪除</button></div></td></tr>`).join("")}</tbody></table></div>`
    : '<p class="muted">回收筒是空的。</p>';
  openModal({
    title: "回收筒",
    subtitle: "刪除的學生會一直保留在這裡，直到你選擇徹底刪除。",
    className: "large",
    body: `${body}<div class="modal-actions"><button type="button" class="btn btn-light" data-close>關閉</button></div>`,
    onReady(modal, close) {
      modal.querySelector("[data-close]").onclick = close;
      modal.querySelectorAll("[data-restore]").forEach(button => button.onclick = () => { restoreStudent(button.dataset.restore); close(); showTrashModal(); });
      modal.querySelectorAll("[data-purge]").forEach(button => button.onclick = () => { if (purgeStudent(button.dataset.purge)) { close(); showTrashModal(); } });
    }
  });
}

function restoreStudent(studentId) {
  const state = store.get();
  const student = state.students.find(item => item.id === studentId);
  if (!student) return;
  // 座號可能在這段期間被別人占走，還原時自動挪到空號並告知。
  const taken = occupiedSeats(student.classId, state, studentId);
  let seat = Number(student.seat);
  let moved = false;
  if (taken.has(seat)) {
    const free = freeSeats(student.classId, state, studentId)[0];
    if (!free) return toast("原班級座號已滿，請先停用或轉出其他學生再還原。", "error");
    seat = free;
    moved = true;
  }
  const currentClass = state.classes.find(item => item.id === student.classId);
  const number = studentNumberFor(currentClass.code, seat);
  store.update(draft => {
    const target = draft.students.find(item => item.id === studentId);
    if (!target) return;
    delete target.deletedAt;
    target.active = true;
    setStudentSeat(draft, studentId, target.classId, seat);
  });
  studentsRender();
  toast(moved ? `已還原，因原座號被占用，改為 ${seat} 號（編號 ${number}）。` : `已還原學生 ${number}。`);
}

function purgeStudent(studentId) {
  const student = store.get().students.find(item => item.id === studentId);
  if (!student) return false;
  if (!confirm(`確定徹底刪除 ${student.number}？\n成績、點數、出席與觀察紀錄將永久移除，無法復原。`)) return false;
  store.update(draft => {
    draft.students = draft.students.filter(item => item.id !== studentId);
    delete draft.scores[studentId];
    delete draft.scoreStatus?.[studentId];
    Object.values(draft.attendance).forEach(day => delete day[studentId]);
    draft.attendanceLog = (draft.attendanceLog || []).filter(item => item.studentId !== studentId);
    draft.transferLog = (draft.transferLog || []).filter(item => item.studentId !== studentId);
    draft.rewards.ledger = draft.rewards.ledger.filter(item => item.studentId !== studentId);
    draft.observations = draft.observations.filter(item => item.studentId !== studentId);
  });
  studentsRender();
  toast(`學生 ${student.number} 的資料已永久刪除。`);
  return true;
}

function showPointModalForOne(studentId) {
  const student = store.get().students.find(item => item.id === studentId);
  openModal({ title: `給 ${student.name} 點數`, body: `<form><div class="form-grid"><label class="field">回饋類型<select name="category"><option>探究精神</option><option>合作學習</option><option>安全操作</option><option>清楚表達</option></select></label><label class="field">點數<input name="value" type="number" min="1" max="10" value="1"></label><label class="field full-field">備註<textarea name="note" rows="3"></textarea></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">儲存</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); store.update(draft => draft.rewards.ledger.unshift({ id: uniqueId("reward"), studentId, category: String(data.get("category")), value: Number(data.get("value")), note: String(data.get("note") || ""), createdAt: new Date().toISOString() })); close(); initStudents(); toast("點數已儲存。"); };
  }});
}

function showGroupPointModal() {
  const state = store.get();
  openModal({
    title: "實驗桌小組加點",
    subtitle: "依自然教室實際座位配置，同步為該桌已安排的學生加點。",
    body: `<form><div class="form-grid"><label class="field full-field">選擇實驗桌<select name="tableId">${Object.entries(classroomTables).map(([id, table]) => `<option value="${id}">${table.label}（座號 ${table.seats.join("、")}）</option>`).join("")}</select></label><label class="field">回饋類型<select name="category"><option>合作學習</option><option>探究精神</option><option>安全操作</option><option>清楚表達</option></select></label><label class="field">每人點數<input name="value" type="number" min="1" max="10" value="1" required></label><label class="field full-field">具體行為<textarea name="note" rows="3" placeholder="例如：分工清楚，能共同檢查實驗紀錄"></textarea></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">全組加點</button></div></form>`,
    onReady(modal, close) {
      modal.querySelector("[data-close]").onclick = close;
      modal.querySelector("form").onsubmit = event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const table = classroomTables[String(data.get("tableId"))];
        const students = activeStudents(state).filter(student => table.seats.includes(Number(student.seat)));
        if (!students.length) return toast("這張實驗桌目前沒有已安排的學生。", "error");
        const category = String(data.get("category"));
        const value = Number(data.get("value"));
        const note = String(data.get("note") || "");
        store.update(draft => students.forEach(student => {
          draft.rewards.ledger.unshift({ id: uniqueId("reward"), studentId: student.id, category, value, note: `${table.label}｜${note}`.replace(/｜$/, ""), createdAt: new Date().toISOString() });
          draft.observations.unshift({ id: uniqueId("obs"), studentId: student.id, category, level: "positive", note, lesson: activeLesson(draft).topic, createdAt: new Date().toISOString() });
        }));
        close();
        initClassroom();
        toast(`${table.label}共 ${students.length} 位學生，各獲得 ${value} 點。`);
      };
    }
  });
}

function exportStudents() {
  const state = store.get(); const attendance = getTodayAttendance(state); const currentClass = activeClass(state);
  const rows = [["學生編號", "座號", "今日狀態", "點數", "學業平均", "標籤", "教師備註"], ...activeStudents(state).sort((a, b) => a.seat - b.seat).map(student => [student.number, student.seat, statusLabel[attendance[student.id]], studentPoints(student.id, state), studentAverage(student.id, state)?.toFixed(1) || "", student.tags.join(";"), student.note || ""])];
  download(`${currentClass.code}-匿名學生名冊-${dateKey()}.csv`, "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8");
  toast("學生名冊已匯出。");
}

function downloadStudentTemplate() {
  const state = store.get(); const currentClass = activeClass(state);
  const rows = [["學生編號", "座號", "標籤", "教師備註"], ...Array.from({ length: 30 }, (_, index) => { const seat = index + 1; return [studentNumberFor(currentClass.code, seat), seat, "", ""]; })];
  download(`${currentClass.code}-學生匯入範本.csv`, "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8");
  toast("匿名學生 CSV 範本已下載。");
}

function importStudents() {
  const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,text/csv"; input.hidden = true; document.body.append(input);
  input.onchange = async () => {
    const file = input.files[0]; if (!file) { input.remove(); return; }
    const text = await file.text(); const rows = parseCsv(text); if (!rows.length) { input.remove(); return toast("CSV 沒有可讀資料。", "error"); }
    const header = rows[0].map(item => item.replace(/^\ufeff/, "").trim().toLowerCase());
    const findColumn = aliases => header.findIndex(item => aliases.includes(item));
    const numberIndex = findColumn(["學生編號", "編號", "studentid", "student id", "id"]), seatIndex = findColumn(["座號", "seat", "number"]), tagsIndex = findColumn(["標籤", "tags", "tag"]), noteIndex = findColumn(["教師備註", "備註", "note", "notes"]);
    if (numberIndex < 0 && seatIndex < 0) { input.remove(); return toast("CSV 至少需要「學生編號」或「座號」欄位。", "error"); }
    let added = 0, updated = 0, skipped = 0;
    store.update(draft => {
      const currentClass = activeClass(draft);
      rows.slice(1).forEach(row => {
        const importedNumber = numberIndex >= 0 ? String(row[numberIndex] || "").trim() : "";
        const seat = seatIndex >= 0 ? Number(row[seatIndex]) : Number(importedNumber.slice(-2));
        const expectedNumber = Number.isInteger(seat) && seat >= 1 && seat <= 30 ? studentNumberFor(currentClass.code, seat) : "";
        if (!expectedNumber || (importedNumber && importedNumber !== expectedNumber)) { skipped++; return; }
        const tags = tagsIndex >= 0 ? String(row[tagsIndex] || "").split(/[;,，]/).map(item => item.trim()).filter(Boolean) : [];
        const note = noteIndex >= 0 ? String(row[noteIndex] || "").trim() : "";
        const existing = draft.students.find(item => item.classId === draft.activeClassId && (item.number === expectedNumber || Number(item.seat) === seat));
        if (existing) { existing.number = expectedNumber; existing.name = `學生 ${expectedNumber}`; existing.tags = tags; existing.note = note; updated++; return; }
        const id = `stu-${expectedNumber}`;
        draft.students.push({ id, classId: draft.activeClassId, seat, number: expectedNumber, name: `學生 ${expectedNumber}`, tags, note, active: true, createdAt: new Date().toISOString() });
        draft.scores[id] = {}; getTodayAttendance(draft)[id] = "present"; added++;
      });
    });
    input.remove(); initStudents(); toast(`匯入完成：新增 ${added} 筆、更新 ${updated} 筆、略過 ${skipped} 筆。`);
  };
  input.click();
}

const rewardRuleDefinitions = [
  { icon: "發", category: "發表次數", value: 1, title: "主動發表", detail: "舉手分享觀察、答案或想法，每次 +1；有證據的完整說明可由教師調整為 +2。" },
  { icon: "序", category: "上課秩序", value: 1, title: "上課秩序", detail: "準時就位、專心傾聽、依指示操作，一節課表現穩定 +1。" },
  { icon: "友", category: "友愛同學", value: 2, title: "友愛同學", detail: "主動協助、耐心傾聽或鼓勵同學完成任務，每次 +2。" },
  { icon: "掃", category: "認真打掃", value: 2, title: "認真打掃", detail: "完成責任區、主動整理公共區域或協助垃圾分類，每次 +2。" },
  { icon: "記", category: "優良筆記", value: 3, title: "優良筆記", detail: "紀錄完整、圖表清楚，並能寫出觀察證據或結論，每份 +3。" },
  { icon: "安", category: "安全操作", value: 2, title: "實驗安全", detail: "正確使用器材、主動提醒安全並完成復原整理，每次 +2。" }
];

const rewardLevelDefinitions = [
  { range: "10–19 點", title: "基礎小獎", detail: "貼紙、科學卡或課堂小特權" },
  { range: "20–39 點", title: "學習選擇", detail: "科學文具、影片推薦或角色優先" },
  { range: "40–69 點", title: "科學驚喜", detail: "科學盲盒或 3D 列印小物" },
  { range: "70 點以上", title: "進階科學獎", detail: "科學玩具或客製 3D 列印作品" }
];

function initRewards() {
  const render = () => {
    const state = store.get(); const query = $("#reward-search")?.value.trim().toLowerCase() || "";
    const students = activeStudents(state); const studentIds = new Set(students.map(student => student.id)); const ledger = state.rewards.ledger.filter(entry => studentIds.has(entry.studentId));
    const total = ledger.filter(entry => entry.value > 0).reduce((sum, entry) => sum + entry.value, 0);
    const redeemed = Math.abs(ledger.filter(entry => entry.value < 0).reduce((sum, entry) => sum + entry.value, 0));
    $("#reward-stats").innerHTML = [statCard("本期正向點數", total, "包含個人與小組回饋", "＋"), statCard("獲得回饋學生", new Set(ledger.filter(entry => entry.value > 0).map(entry => entry.studentId)).size, "持續讓每位學生被看見", "人"), statCard("已兌換點數", redeemed, "兌換後保留完整流水帳", "換"), statCard("最常見回饋", topCategory(state), "依本期點數事件統計", "類")].join("");
    $("#reward-rule-grid").innerHTML = rewardRuleDefinitions.map(rule => `<article class="reward-rule"><span class="reward-rule-icon">${esc(rule.icon)}</span><div><strong>${esc(rule.title)}</strong><p>${esc(rule.detail)}</p></div><button class="btn btn-light" data-rule-category="${esc(rule.category)}" data-rule-value="${rule.value}">＋${rule.value} 加點</button></article>`).join("");
    $("#reward-levels").innerHTML = rewardLevelDefinitions.map(level => `<div class="reward-level"><strong>${esc(level.range)}</strong><span>${esc(level.title)}</span><small>${esc(level.detail)}</small></div>`).join("");
    $("#reward-student-grid").innerHTML = students.filter(student => `${student.number} ${student.seat}`.includes(query)).map(student => `<article class="reward-person"><span class="avatar">${student.seat}</span><div><strong>${esc(student.number)}</strong><small>${student.seat} 號 · 本期累積</small></div><span class="points">${studentPoints(student.id, state)}</span></article>`).join("");
    $("#reward-menu").innerHTML = [...state.rewards.menu].sort((a, b) => a.cost - b.cost).map(item => {
      const stock = prizeStock(item.id, state);
      const soldOut = stock === 0;
      const stockLabel = stock === null ? "不限量" : soldOut ? "已兌完" : `剩 ${stock} 份`;
      return `<article class="reward-catalog-item${soldOut ? " is-sold-out" : ""}"><div class="reward-prize-icon" aria-hidden="true">${esc(item.icon || "獎")}</div><div class="reward-prize-copy"><span class="reward-type">${esc(item.type || "班級獎品")}</span><h3>${esc(item.name)}</h3><p>${esc(item.note)}</p><span class="prize-stock${soldOut ? " is-out" : stock === null ? " is-unlimited" : ""}">${stockLabel}</span></div><div class="reward-prize-action"><strong>${item.cost} 點</strong><button class="btn btn-secondary" data-redeem-reward="${item.id}"${soldOut ? " disabled" : ""}>${soldOut ? "已兌完" : "選擇兌換"}</button><button class="btn btn-quiet" data-stock-reward="${item.id}">調整庫存</button></div></article>`;
    }).join("");
    renderPendingDeliveries(state);
    $("#ledger-body").innerHTML = ledger.slice(0, 80).map(entry => { const student = state.students.find(item => item.id === entry.studentId); return `<tr><td>${formatDate(entry.createdAt)}</td><td>${esc(student?.number || "已刪除")}</td><td>${esc(entry.category)}</td><td><span class="delta ${entry.value >= 0 ? "positive" : "negative"}">${entry.value > 0 ? "+" : ""}${entry.value}</span></td><td>${esc(entry.note || "—")}</td></tr>`; }).join("");
    $$('[data-rule-category]').forEach(button => button.onclick = () => showPointModal(button.dataset.ruleCategory, Number(button.dataset.ruleValue)));
    $$('[data-redeem-reward]').forEach(button => button.onclick = () => showRedeemModal(button.dataset.redeemReward));
    $$('[data-stock-reward]').forEach(button => button.onclick = () => showStockModal(button.dataset.stockReward));
  };
  $('[data-action="give-points"]').onclick = () => showPointModal();
  $('[data-action="redeem"]').onclick = () => showRedeemModal();
  $('[data-action="export-ledger"]').onclick = exportLedger;
  $('[data-action="edit-reward-menu"]').onclick = editRewardMenu;
  $("#reward-search").oninput = render;
  render();
}

function topCategory(state) {
  const studentIds = new Set(activeStudents(state).map(student => student.id));
  const counts = {}; state.rewards.ledger.filter(item => item.value > 0 && studentIds.has(item.studentId)).forEach(item => counts[item.category] = (counts[item.category] || 0) + 1);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
}

function renderPendingDeliveries(state) {
  const list = $("#pending-deliveries");
  if (!list) return;
  const pending = pendingDeliveries(state);
  $("#pending-count").textContent = pending.length;
  if (!pending.length) {
    list.innerHTML = '<p class="muted">目前沒有待交付的獎品。</p>';
    return;
  }
  list.innerHTML = `<ul class="delivery-list">${pending.map(entry => {
    const student = state.students.find(item => item.id === entry.studentId);
    return `<li><div><strong>${esc(entry.note || "獎品")}</strong><small>${esc(student?.number || "已刪除")} · ${formatDate(entry.createdAt)}</small></div><button class="btn btn-light" data-deliver="${entry.id}">標記已交付</button></li>`;
  }).join("")}</ul>`;
  $$("[data-deliver]").forEach(button => button.onclick = () => {
    store.update(draft => {
      const entry = draft.rewards.ledger.find(item => item.id === button.dataset.deliver);
      if (entry) { entry.delivered = true; entry.deliveredAt = new Date().toISOString(); }
    });
    initRewards();
    toast("已標記為交付完成。");
  });
}

function showStockModal(prizeId) {
  const state = store.get();
  const prize = state.rewards.menu.find(item => item.id === prizeId);
  if (!prize) return;
  const stock = prizeStock(prizeId, state);
  openModal({
    title: "調整庫存",
    subtitle: prize.name,
    body: `<form><label class="switch-row"><input type="checkbox" name="unlimited"${stock === null ? " checked" : ""}><span><strong>不限量</strong><small>像「優先選擇實驗角色」這種特權不需要管數量</small></span></label><label class="field">剩餘數量<input name="stock" type="number" min="0" value="${stock ?? 0}"${stock === null ? " disabled" : ""}></label><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">儲存</button></div></form>`,
    onReady(modal, close) {
      const unlimited = modal.querySelector('[name="unlimited"]');
      const input = modal.querySelector('[name="stock"]');
      unlimited.onchange = () => { input.disabled = unlimited.checked; };
      modal.querySelector("[data-close]").onclick = close;
      modal.querySelector("form").onsubmit = event => {
        event.preventDefault();
        const next = unlimited.checked ? null : Math.max(0, Number(input.value) || 0);
        store.update(draft => {
          const target = draft.rewards.menu.find(item => item.id === prizeId);
          if (target) target.stock = next;
        });
        close();
        initRewards();
        toast(next === null ? `「${prize.name}」已設為不限量。` : `「${prize.name}」剩餘數量已更新為 ${next} 份。`);
      };
    }
  });
}

function showRedeemModal(defaultRewardId = "") {
  const state = store.get();
  openModal({ title: "兌換獎勵", subtitle: "兌換會扣除點數並保留流水帳；獎勵點數不影響學業成績。", body: `<form><div class="form-grid"><label class="field full-field">學生<select name="studentId">${activeStudents(state).map(student => `<option value="${student.id}">${student.seat} 號 · ${esc(student.number)}（可用 ${studentPoints(student.id, state)} 點）</option>`).join("")}</select></label><label class="field full-field">獎品<select name="rewardId">${[...state.rewards.menu].sort((a,b) => a.cost-b.cost).map(item => `<option value="${item.id}" ${item.id === defaultRewardId ? "selected" : ""}>${esc(item.name)}（${item.cost} 點）</option>`).join("")}</select></label></div><div class="notice"><strong>兌換提醒</strong><span>教師確認獎品庫存與交付時間後再完成兌換；系統會自動留下扣點紀錄。</span></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">確認兌換</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const studentId = String(data.get("studentId"));
      const reward = state.rewards.menu.find(item => item.id === data.get("rewardId"));
      if (!reward) return toast("找不到這項獎品。", "error");
      if (prizeSoldOut(reward.id, store.get())) return toast(`「${reward.name}」已經兌完，請先補貨或選擇其他獎品。`, "error");
      const available = studentPoints(studentId, store.get());
      if (available < reward.cost) return toast(`點數不足：目前 ${available} 點，還需要 ${reward.cost - available} 點。`, "error");
      store.update(draft => {
        draft.rewards.ledger.unshift({ id: uniqueId("redeem"), studentId, rewardId: reward.id, category: "獎勵兌換", value: -reward.cost, note: reward.name, delivered: false, deliveredAt: null, createdAt: new Date().toISOString() });
        const prize = draft.rewards.menu.find(item => item.id === reward.id);
        if (prize && prize.stock !== null && prize.stock !== undefined) prize.stock = Math.max(0, Number(prize.stock) - 1);
      });
      close();
      initRewards();
      toast(`已兌換「${reward.name}」，扣除 ${reward.cost} 點，待交付清單已更新。`);
    };
  }});
}

function editRewardMenu() {
  openModal({ title: "新增兌換獎品", subtitle: "可依班級預算、器材與學生年齡調整。", body: `<form><div class="form-grid"><label class="field">獎品名稱<input name="name" required placeholder="例如：自製太陽系模型"></label><label class="field">所需點數<input name="cost" type="number" min="1" value="20" required></label><label class="field">獎品類型<select name="type"><option>科學小物</option><option>科學玩具</option><option>3D 列印</option><option>驚喜盲盒</option><option>學習特權</option><option>其他</option></select></label><label class="field">圖示文字<input name="icon" maxlength="2" value="獎"></label><label class="field full-field">獎品說明<input name="note" placeholder="內容、尺寸或兌換限制"></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">新增獎品</button></div></form>`, onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); store.update(draft => draft.rewards.menu.push({ id: uniqueId("menu"), name: String(data.get("name")), cost: Number(data.get("cost")), type: String(data.get("type")), icon: String(data.get("icon") || "獎"), note: String(data.get("note") || "") })); close(); initRewards(); toast("兌換獎品已新增。"); }; }});
}

function exportLedger() {
  const state = store.get(); const currentClass = activeClass(state); const studentIds = new Set(activeStudents(state).map(student => student.id)); const rows = [["時間", "學生編號", "類型", "點數", "備註"], ...state.rewards.ledger.filter(entry => studentIds.has(entry.studentId)).map(entry => [entry.createdAt, state.students.find(item => item.id === entry.studentId)?.number || "", entry.category, entry.value, entry.note])]; download(`${currentClass.code}-自然課點數流水帳-${dateKey()}.csv`, "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8"); toast("流水帳已匯出。");
}

function initGrades() {
  const state = store.get();
  const students = activeStudents(state);
  const pending = students.filter(student => state.assessments.some(item => effectiveScore(student.id, item.id, state) === null)).length;
  const best = [...state.assessments].sort((a, b) => assessmentAverage(b.id, state) - assessmentAverage(a.id, state))[0];
  const absentCount = students.reduce((sum, student) => sum + state.assessments.filter(item => isAbsentExam(student.id, item.id, state)).length, 0);
  const weight = totalWeight(state);
  $("#gradebook-title").textContent = `${activeClass(state).name}成績簿`;
  $("#grade-stats").innerHTML = [
    statCard("班級平均", classAverage(state).toFixed(1), "依評量權重自動換算", "均"),
    statCard("目前評量", state.assessments.length, `總權重 ${weight}%`, "項"),
    statCard("待補成績", pending, "至少一項尚未輸入", "待"),
    statCard("缺考標記", absentCount, `未補分時以應考平均 −${ABSENT_PENALTY}`, "缺")
  ].join("");

  const warning = $("#weight-warning");
  warning.hidden = weight === 100 || !state.assessments.length;
  if (!warning.hidden) warning.innerHTML = `<strong>權重總和為 ${weight}%</strong><span>加權平均會以實際有成績的項目換算，但建議把總和調整為 100% 以免解讀混淆。</span>`;

  $("#gradebook-head").innerHTML = `<tr><th>學生</th>${state.assessments.map(item => `<th><div class="assessment-head"><button class="assessment-name" data-edit-assessment="${item.id}" title="編輯評量">${esc(item.name)}</button><small>${item.maxScore} 分 · 權重 ${item.weight}%</small><span class="assessment-tools"><button data-duplicate-assessment="${item.id}" title="複製評量">複製</button><button data-delete-assessment="${item.id}" title="刪除評量">刪除</button></span></div></th>`).join("")}<th>加權平均</th></tr>`;
  $("#gradebook-body").innerHTML = students.map(student => `<tr><td><button class="student-cell as-link" data-detail-student="${student.id}" title="查看個人趨勢"><span class="avatar">${student.seat}</span><div><strong>${esc(student.number)}</strong><small>${student.seat} 號</small></div></button></td>${state.assessments.map(item => {
    const raw = state.scores[student.id]?.[item.id];
    const absent = isAbsentExam(student.id, item.id, state);
    const imputed = absent && (raw === null || raw === undefined || raw === "");
    return `<td class="score-cell${absent ? " is-absent" : ""}"><input class="score-input" data-student="${student.id}" data-assessment="${item.id}" data-max="${item.maxScore}" type="number" min="0" max="${item.maxScore}" value="${raw ?? ""}" placeholder="${imputed ? (absentExamScore(item.id, state) ?? "—") : ""}" aria-label="學生 ${esc(student.number)} ${esc(item.name)}分數"><button class="absent-toggle${absent ? " is-on" : ""}" data-absent="${student.id}|${item.id}" title="${absent ? "取消缺考標記" : "標記缺考"}" aria-pressed="${absent}">缺</button></td>`;
  }).join("")}<td><span class="score-average">${studentAverage(student.id, state)?.toFixed(1) || "—"}</span></td></tr>`).join("");

  $$('[data-detail-student]').forEach(button => button.onclick = () => showStudentDetail(button.dataset.detailStudent));
  $$(".score-input").forEach(input => {
    input.onchange = () => {
      const value = input.value === "" ? null : Number(input.value);
      if (value !== null && (Number.isNaN(value) || value < 0 || value > Number(input.dataset.max))) { input.classList.add("invalid"); return toast(`分數需介於 0 到 ${input.dataset.max}。`, "error"); }
      input.classList.remove("invalid");
      store.update(draft => { draft.scores[input.dataset.student] ||= {}; draft.scores[input.dataset.student][input.dataset.assessment] = value; });
      initGrades();
      toast(value === null ? "成績已清除。" : "成績已儲存。");
    };
    input.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); input.onchange(); } };
  });
  $$("[data-absent]").forEach(button => button.onclick = () => {
    const [studentId, assessmentId] = button.dataset.absent.split("|");
    const current = store.get();
    const turningOn = !isAbsentExam(studentId, assessmentId, current);
    const existing = current.scores[studentId]?.[assessmentId];
    const hasScore = existing !== null && existing !== undefined && existing !== "";
    // 留著舊分數會讓「缺考」標記名不副實：畫面說缺考，計分卻仍用舊分。
    if (turningOn && hasScore && !confirm(`標記缺考會清除目前的 ${existing} 分，改以應考平均 −${ABSENT_PENALTY} 計算。\n之後補考時直接填入分數即可覆蓋。確定嗎？`)) return;
    store.update(draft => {
      setScoreStatus(draft, studentId, assessmentId, turningOn ? "absent" : "");
      if (turningOn) { draft.scores[studentId] ||= {}; draft.scores[studentId][assessmentId] = null; }
    });
    initGrades();
    toast(turningOn ? "已標記缺考，未補分時以應考平均計算。" : "已取消缺考標記。");
  });
  $$("[data-edit-assessment]").forEach(button => button.onclick = () => showAssessmentModal(button.dataset.editAssessment));
  $$("[data-duplicate-assessment]").forEach(button => button.onclick = () => duplicateAssessment(button.dataset.duplicateAssessment));
  $$("[data-delete-assessment]").forEach(button => button.onclick = () => deleteAssessment(button.dataset.deleteAssessment));

  $('[data-action="add-assessment"]').onclick = () => showAssessmentModal();
  $('[data-action="export-grades"]').onclick = exportGrades;
  $('[data-action="score-template"]').onclick = downloadScoreTemplate;
  $('[data-action="import-scores"]').onclick = showScoreImportModal;
  renderImportUndo();
}

function showAssessmentModal(assessmentId = "") {
  const state = store.get();
  const existing = state.assessments.find(item => item.id === assessmentId);
  const types = ["形成性", "實作", "總結性"];
  openModal({
    title: existing ? "編輯評量" : "新增評量",
    subtitle: existing ? "調整滿分不會換算既有成績，超過滿分的分數會被標示為異常。" : "評量權重用來換算學期表現，可稍後調整。",
    body: `<form><div class="form-grid"><label class="field full-field">評量名稱<input name="name" required placeholder="例如：酸鹼指示劑實驗" value="${esc(existing?.name || "")}"></label><label class="field">類型<select name="type">${types.map(type => `<option${type === (existing?.type || "形成性") ? " selected" : ""}>${type}</option>`).join("")}</select></label><label class="field">日期<input name="date" type="date" value="${esc(existing?.date || dateKey())}"></label><label class="field">滿分<input name="maxScore" type="number" min="1" value="${existing?.maxScore ?? 20}" required></label><label class="field">權重（%）<input name="weight" type="number" min="0" max="100" value="${existing?.weight ?? 10}" required></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">${existing ? "儲存變更" : "建立評量"}</button></div></form>`,
    onReady(modal, close) {
      modal.querySelector("[data-close]").onclick = close;
      modal.querySelector("form").onsubmit = event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const fields = { name: String(data.get("name")), type: String(data.get("type")), date: String(data.get("date")), maxScore: Number(data.get("maxScore")), weight: Number(data.get("weight")) };
        store.update(draft => {
          if (existing) {
            Object.assign(draft.assessments.find(item => item.id === assessmentId), fields);
            return;
          }
          const id = uniqueId("assessment");
          draft.assessments.push({ id, ...fields });
          activeStudents(draft).forEach(student => { draft.scores[student.id] ||= {}; draft.scores[student.id][id] = null; });
        });
        close();
        initGrades();
        toast(existing ? "評量已更新。" : "評量已建立，可直接輸入成績。");
      };
    }
  });
}

function duplicateAssessment(assessmentId) {
  const source = store.get().assessments.find(item => item.id === assessmentId);
  if (!source) return;
  const id = uniqueId("assessment");
  store.update(draft => {
    const index = draft.assessments.findIndex(item => item.id === assessmentId);
    draft.assessments.splice(index + 1, 0, { ...source, id, name: `${source.name}（複製）`, date: dateKey() });
    activeStudents(draft).forEach(student => { draft.scores[student.id] ||= {}; draft.scores[student.id][id] = null; });
  });
  initGrades();
  toast("已複製評量設定，成績留空待輸入。");
}

function deleteAssessment(assessmentId) {
  const state = store.get();
  const assessment = state.assessments.find(item => item.id === assessmentId);
  if (!assessment) return;
  const withScores = state.students.filter(student => {
    const value = state.scores[student.id]?.[assessmentId];
    return value !== null && value !== undefined && value !== "";
  }).length;
  if (!confirm(`確定刪除「${assessment.name}」？\n這會一併清除全部班級共 ${withScores} 筆已輸入的成績，且無法復原。`)) return;
  store.update(draft => {
    draft.assessments = draft.assessments.filter(item => item.id !== assessmentId);
    Object.values(draft.scores).forEach(map => delete map[assessmentId]);
    Object.values(draft.scoreStatus || {}).forEach(map => delete map[assessmentId]);
  });
  initGrades();
  toast("評量與相關成績已刪除。");
}

/* ------------------------------------------------------------- 成績匯入 */

let lastScoreImport = null;

function downloadScoreTemplate() {
  const state = store.get();
  const rows = [["座號", "分數"], ...activeStudents(state).map(student => [student.seat, ""])];
  download(`${activeClass(state).code}-成績匯入範本.csv`, `﻿${rows.map(row => row.map(csvEscape).join(",")).join("\n")}`, "text/csv;charset=utf-8");
  toast("匯入範本已下載，填好分數再匯入即可。");
}

/** 從 CSV 解析出「座號 → 分數」的原始列，容許有無標題列與常見欄名。 */
function parseScoreRows(text) {
  const table = parseCsv(text).filter(row => row.some(cell => String(cell).trim() !== ""));
  if (!table.length) return [];
  const header = table[0].map(cell => String(cell).trim());
  const looksLikeHeader = header.some(cell => /座號|seat|號碼|分數|score|成績/i.test(cell)) && !/^\d+$/.test(header[0]);
  const body = looksLikeHeader ? table.slice(1) : table;
  let seatIndex = 0;
  let scoreIndex = 1;
  if (looksLikeHeader) {
    const found = header.findIndex(cell => /座號|seat|號碼/i.test(cell));
    const foundScore = header.findIndex(cell => /分數|score|成績/i.test(cell));
    if (found >= 0) seatIndex = found;
    if (foundScore >= 0) scoreIndex = foundScore;
  }
  return body.map((row, index) => ({ line: index + (looksLikeHeader ? 2 : 1), seat: String(row[seatIndex] ?? "").trim(), score: String(row[scoreIndex] ?? "").trim() }));
}

/** 把原始列比對到目前班級的學生，並判定每一列的狀態。 */
function buildImportPlan(rows, assessment, state) {
  const students = activeStudents(state);
  const bySeat = new Map(students.map(student => [String(student.seat), student]));
  const seenSeats = new Set();
  return rows.map(row => {
    const student = bySeat.get(String(Number(row.seat)));
    const current = state.scores[student?.id]?.[assessment.id];
    const hasCurrent = current !== null && current !== undefined && current !== "";
    const item = { ...row, student, current: hasCurrent ? Number(current) : null, value: null, status: "", note: "", include: true };
    if (!row.seat) { item.status = "invalid"; item.note = "缺少座號"; item.include = false; return item; }
    if (!student) { item.status = "invalid"; item.note = `找不到座號 ${row.seat}`; item.include = false; return item; }
    if (seenSeats.has(String(student.seat))) { item.status = "invalid"; item.note = "座號重複，僅保留第一筆"; item.include = false; return item; }
    seenSeats.add(String(student.seat));
    if (row.score === "") { item.status = "blank"; item.note = "未填分數，略過"; item.include = false; return item; }
    if (/^(缺考|缺|absent)$/i.test(row.score)) { item.status = "absent"; item.note = "標記為缺考"; return item; }
    const value = Number(row.score);
    if (Number.isNaN(value)) { item.status = "invalid"; item.note = `非數值：${row.score}`; item.include = false; return item; }
    if (value < 0 || value > assessment.maxScore) { item.status = "invalid"; item.note = `超出 0–${assessment.maxScore}`; item.include = false; return item; }
    item.value = value;
    if (!hasCurrent) item.status = "new";
    else if (Number(current) === value) { item.status = "same"; item.note = "與目前相同"; }
    else item.status = "overwrite";
    return item;
  });
}

function showScoreImportModal() {
  const state = store.get();
  if (!state.assessments.length) return toast("請先建立至少一項評量。", "error");
  const options = state.assessments.map(item => `<option value="${item.id}">${esc(item.name)}（滿分 ${item.maxScore}）</option>`).join("");
  openModal({
    title: "匯入成績",
    subtitle: `以座號對應 ${activeClass(state).name} 的學生；匯入前會先顯示比對結果。`,
    className: "large",
    body: `<form id="score-import-form"><div class="form-grid"><label class="field full-field">匯入到哪一項評量<select name="assessmentId">${options}</select></label><label class="field full-field">CSV 檔案<input name="file" type="file" accept=".csv,text/csv" required></label></div><p class="muted">欄位為「座號, 分數」；分數填「缺考」可直接標記缺考。可先下載匯入範本。</p><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">讀取並預覽</button></div></form>`,
    onReady(modal, close) {
      modal.querySelector("[data-close]").onclick = close;
      modal.querySelector("form").onsubmit = async event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const assessmentId = String(data.get("assessmentId"));
        const file = data.get("file");
        if (!file || !file.size) return toast("請選擇 CSV 檔案。", "error");
        try {
          const rows = parseScoreRows(await file.text());
          if (!rows.length) return toast("檔案沒有可讀取的資料列。", "error");
          close();
          showImportPreview(assessmentId, rows);
        } catch (error) {
          toast(error.message || "無法讀取檔案。", "error");
        }
      };
    }
  });
}

function showImportPreview(assessmentId, rows) {
  const state = store.get();
  const assessment = state.assessments.find(item => item.id === assessmentId);
  const plan = buildImportPlan(rows, assessment, state);
  const labels = { new: "新增", overwrite: "覆蓋", same: "不變", absent: "缺考", blank: "略過", invalid: "問題" };

  const summaryOf = current => {
    const included = current.filter(item => item.include);
    return {
      matched: current.filter(item => item.student).length,
      willWrite: included.length,
      overwrite: included.filter(item => item.status === "overwrite").length,
      invalid: current.filter(item => item.status === "invalid").length,
      absent: included.filter(item => item.status === "absent").length
    };
  };

  const renderSummary = current => {
    const sum = summaryOf(current);
    return `<div class="import-summary"><span><strong>${sum.matched}</strong>筆對應到學生</span><span><strong>${sum.willWrite}</strong>筆將寫入</span><span class="${sum.overwrite ? "is-warn" : ""}"><strong>${sum.overwrite}</strong>筆覆蓋既有成績</span><span class="${sum.invalid ? "is-bad" : ""}"><strong>${sum.invalid}</strong>筆有問題</span><span><strong>${sum.absent}</strong>筆標記缺考</span></div>${sum.overwrite ? `<div class="notice import-warn"><strong>將覆蓋 ${sum.overwrite} 筆已輸入的成績</strong><span>確認後可用「復原這次匯入」退回。</span></div>` : ""}`;
  };

  const renderRows = current => current.map((item, index) => `<tr class="is-${item.status}"><td>${item.status === "invalid" || item.status === "blank" ? "" : `<input type="checkbox" data-row="${index}" ${item.include ? "checked" : ""} aria-label="是否匯入第 ${item.line} 列">`}</td><td>${esc(item.seat || "—")}</td><td>${esc(item.student?.number || "—")}</td><td>${item.current ?? "—"}</td><td>${item.status === "absent" ? "缺考" : item.value ?? "—"}</td><td><span class="import-tag t-${item.status}">${labels[item.status]}</span>${item.note ? `<small>${esc(item.note)}</small>` : ""}</td></tr>`).join("");

  openModal({
    title: "匯入預覽",
    subtitle: `${assessment.name}（滿分 ${assessment.maxScore}）｜${activeClass(state).name}`,
    className: "large",
    body: `<div id="import-summary">${renderSummary(plan)}</div><div class="table-wrap import-table"><table class="data-table"><thead><tr><th>匯入</th><th>座號</th><th>學生編號</th><th>目前</th><th>檔案</th><th>狀態</th></tr></thead><tbody id="import-rows">${renderRows(plan)}</tbody></table></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button type="button" class="btn btn-primary" data-confirm-import>確認匯入</button></div>`,
    onReady(modal, close) {
      const refresh = () => { modal.querySelector("#import-summary").innerHTML = renderSummary(plan); };
      modal.querySelector("[data-close]").onclick = close;
      modal.querySelectorAll("[data-row]").forEach(box => box.onchange = () => { plan[Number(box.dataset.row)].include = box.checked; refresh(); });
      modal.querySelector("[data-confirm-import]").onclick = () => {
        const applied = plan.filter(item => item.include && item.student);
        if (!applied.length) return toast("沒有可匯入的資料列。", "error");
        applyScoreImport(assessmentId, applied);
        close();
      };
    }
  });
}

function applyScoreImport(assessmentId, applied) {
  const state = store.get();
  const undo = applied.map(item => ({
    studentId: item.student.id,
    score: state.scores[item.student.id]?.[assessmentId] ?? null,
    status: scoreStatusOf(item.student.id, assessmentId, state)
  }));
  store.update(draft => {
    applied.forEach(item => {
      draft.scores[item.student.id] ||= {};
      if (item.status === "absent") {
        draft.scores[item.student.id][assessmentId] = null;
        setScoreStatus(draft, item.student.id, assessmentId, "absent");
        return;
      }
      draft.scores[item.student.id][assessmentId] = item.value;
      setScoreStatus(draft, item.student.id, assessmentId, "");
    });
  });
  const assessment = store.get().assessments.find(item => item.id === assessmentId);
  lastScoreImport = { assessmentId, name: assessment?.name || "", at: new Date().toISOString(), undo };
  initGrades();
  toast(`已匯入 ${applied.length} 筆成績到「${assessment?.name}」。`);
}

function renderImportUndo() {
  const banner = $("#import-undo");
  if (!banner) return;
  banner.hidden = !lastScoreImport;
  if (!lastScoreImport) return;
  banner.innerHTML = `<strong>已匯入 ${lastScoreImport.undo.length} 筆到「${esc(lastScoreImport.name)}」</strong><span>如果匯錯了可以退回匯入前的狀態。</span><button class="btn btn-light" data-action="undo-import">復原這次匯入</button>`;
  banner.querySelector('[data-action="undo-import"]').onclick = () => {
    const snapshot = lastScoreImport;
    store.update(draft => {
      snapshot.undo.forEach(entry => {
        draft.scores[entry.studentId] ||= {};
        draft.scores[entry.studentId][snapshot.assessmentId] = entry.score;
        setScoreStatus(draft, entry.studentId, snapshot.assessmentId, entry.status);
      });
    });
    lastScoreImport = null;
    initGrades();
    toast("已復原這次匯入。");
  };
}

function exportGrades() {
  const state = store.get(); const currentClass = activeClass(state); const rows = [["學生編號", "座號", ...state.assessments.map(item => `${item.name}（/${item.maxScore}）`), "加權平均"], ...activeStudents(state).map(student => [student.number, student.seat, ...state.assessments.map(item => { const raw = state.scores[student.id]?.[item.id]; const hasRaw = raw !== null && raw !== undefined && raw !== ""; if (hasRaw) return raw; return isAbsentExam(student.id, item.id, state) ? `缺考（${absentExamScore(item.id, state) ?? "—"}）` : ""; }), studentAverage(student.id, state)?.toFixed(1) || ""])]; download(`${currentClass.code}-自然科成績簿-${dateKey()}.csv`, "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8"); toast("成績簿已匯出。");
}

let timerState = { remaining: 300, initial: 300, running: false, interval: null };
let stopwatch = { elapsed: 0, running: false, startedAt: 0, interval: null };
let soundMeter = { stream: null, context: null, frame: null, running: false };

function initTools() {
  renderTimer();
  $$("[data-minutes]").forEach(button => button.onclick = () => { $$("[data-minutes]").forEach(item => item.classList.remove("active")); button.classList.add("active"); timerState.initial = Number(button.dataset.minutes) * 60; timerState.remaining = timerState.initial; timerState.running = false; clearInterval(timerState.interval); renderTimer(); });
  $('[data-action="timer-toggle"]').onclick = toggleTimer;
  $('[data-action="timer-reset"]').onclick = () => { clearInterval(timerState.interval); timerState.running = false; timerState.remaining = timerState.initial; renderTimer(); };
  $('[data-action="random-student"]').onclick = pickRandomStudent;
  $('[data-action="make-groups"]').onclick = makeGroups;
  $('[data-action="roll-dice"]').onclick = rollDice;
  $("#dice").addEventListener("keydown", event => { if (event.code === "Space") { event.preventDefault(); rollDice(); } });
  $('[data-action="stopwatch-toggle"]').onclick = toggleStopwatch;
  $('[data-action="stopwatch-lap"]').onclick = addLap;
  $('[data-action="stopwatch-reset"]').onclick = resetStopwatch;
  $('[data-action="reset-safety"]').onclick = () => { $$("#safety-checks input").forEach(input => input.checked = false); toast("安全檢核已重設。"); };
  $('[data-action="sound-toggle"]').onclick = toggleSoundMeter;
  $('[data-action="make-qr"]').onclick = makeQrCode;
  $('[data-action="download-qr"]').onclick = downloadQrCode;
  $('[data-action="project-mode"]').onclick = () => { document.body.classList.toggle("projecting"); $('[data-action="project-mode"]').textContent = document.body.classList.contains("projecting") ? "離開投影模式" : "進入投影模式"; };
}

function renderTimer() { const minutes = Math.floor(timerState.remaining / 60), seconds = timerState.remaining % 60; $("#timer-display").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; $('[data-action="timer-toggle"]').textContent = timerState.running ? "暫停" : "開始"; }
function toggleTimer() { if (timerState.running) { clearInterval(timerState.interval); timerState.running = false; renderTimer(); return; } timerState.running = true; timerState.interval = setInterval(() => { timerState.remaining--; if (timerState.remaining <= 0) { timerState.remaining = 0; timerState.running = false; clearInterval(timerState.interval); toast("時間到！請完成紀錄並整理器材。"); } renderTimer(); }, 1000); renderTimer(); }
function pickRandomStudent() { const state = store.get(); const attendance = getTodayAttendance(state); let pool = activeStudents(state).filter(student => !$("#exclude-absent").checked || attendance[student.id] !== "absent"); const recent = state.toolHistory.recentlyPicked || []; const fresh = pool.filter(student => !recent.slice(-Math.min(5, pool.length - 1)).includes(student.id)); if (fresh.length) pool = fresh; const student = pool[Math.floor(Math.random() * pool.length)]; if (!student) return toast("目前沒有可抽選的學生。", "error"); store.update(draft => { draft.toolHistory.recentlyPicked.push(student.id); draft.toolHistory.recentlyPicked = draft.toolHistory.recentlyPicked.slice(-20); }); $("#random-result").innerHTML = `<small>${student.seat} 號</small><strong>${esc(student.number)}</strong>`; }
function makeGroups() { const size = Math.max(2, Math.min(8, Number($("#group-size").value) || 4)); const state = store.get(); const attendance = getTodayAttendance(state); const pool = activeStudents(state).filter(student => attendance[student.id] !== "absent").sort(() => Math.random() - .5); const groupCount = Math.ceil(pool.length / size); const groups = Array.from({ length: groupCount }, () => []); pool.forEach((student, index) => groups[index % groupCount].push(student)); $("#group-preview").innerHTML = groups.map((group, index) => `<div class="group-box"><strong>第 ${index + 1} 組</strong>${group.map(student => `<span>${esc(student.number)}</span>`).join("")}</div>`).join(""); }
function rollDice() { const dice = $("#dice"); dice.classList.remove("rolling"); void dice.offsetWidth; dice.classList.add("rolling"); let count = 0; const interval = setInterval(() => { dice.textContent = Math.floor(Math.random() * 6) + 1; if (++count >= 7) clearInterval(interval); }, 55); }
function stopwatchText(ms) { const tenths = Math.floor(ms / 100) % 10, totalSeconds = Math.floor(ms / 1000); return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}.${tenths}`; }
function toggleStopwatch() { if (stopwatch.running) { stopwatch.elapsed += Date.now() - stopwatch.startedAt; clearInterval(stopwatch.interval); stopwatch.running = false; } else { stopwatch.startedAt = Date.now(); stopwatch.running = true; stopwatch.interval = setInterval(() => $("#stopwatch-display").textContent = stopwatchText(stopwatch.elapsed + Date.now() - stopwatch.startedAt), 100); } $('[data-action="stopwatch-toggle"]').textContent = stopwatch.running ? "暫停" : "開始"; }
function addLap() { const value = stopwatch.elapsed + (stopwatch.running ? Date.now() - stopwatch.startedAt : 0); const li = document.createElement("li"); li.textContent = `分段 ${$("#lap-list").children.length + 1}　${stopwatchText(value)}`; $("#lap-list").prepend(li); }
function resetStopwatch() { clearInterval(stopwatch.interval); stopwatch = { elapsed: 0, running: false, startedAt: 0, interval: null }; $("#stopwatch-display").textContent = "00:00.0"; $("#lap-list").innerHTML = ""; $('[data-action="stopwatch-toggle"]').textContent = "開始"; }

async function toggleSoundMeter() {
  if (soundMeter.running) return stopSoundMeter();
  if (!navigator.mediaDevices?.getUserMedia) return toast("此瀏覽器不支援麥克風音量分析。", "error");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false });
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    soundMeter = { stream, context, analyser, frame: null, running: true };
    $('[data-action="sound-toggle"]').textContent = "停止音量燈";
    const samples = new Float32Array(analyser.fftSize);
    const update = () => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      const db = rms ? 20 * Math.log10(rms) : -60;
      const level = Math.max(0, Math.min(100, Math.round((db + 60) / 60 * 100)));
      const status = level < 38 ? "安靜" : level < 68 ? "適中" : "偏大聲";
      const fill = $("#sound-meter-fill");
      fill.style.width = `${level}%`;
      fill.dataset.level = status;
      $("#sound-level").textContent = `相對音量 ${level}%`;
      $("#sound-status").textContent = status === "偏大聲" ? "偏大聲，請降低討論音量" : `${status}，適合目前課堂活動`;
      soundMeter.frame = requestAnimationFrame(update);
    };
    update();
  } catch (error) {
    toast(error.name === "NotAllowedError" ? "未取得麥克風權限，音量燈無法啟動。" : `音量燈啟動失敗：${error.message}`, "error");
  }
}

function stopSoundMeter() {
  cancelAnimationFrame(soundMeter.frame);
  soundMeter.stream?.getTracks().forEach(track => track.stop());
  soundMeter.context?.close();
  soundMeter = { stream: null, context: null, frame: null, running: false };
  $('[data-action="sound-toggle"]').textContent = "啟動音量燈";
  $("#sound-meter-fill").style.width = "0%";
  $("#sound-level").textContent = "尚未啟動";
  $("#sound-status").textContent = "啟動後顯示安靜、適中或偏大聲";
}

async function makeQrCode() {
  const value = $("#qr-url").value.trim();
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `QR Code：${value}`);
    await QRCode.toCanvas(canvas, value, { width: 220, margin: 2, color: { dark: "#0b3d2e", light: "#ffffff" } });
    $("#qr-preview").replaceChildren(canvas);
    $('[data-action="download-qr"]').disabled = false;
    toast("QR Code 已產生。");
  } catch {
    toast("請輸入完整的 http 或 https 網址。", "error");
  }
}

function downloadQrCode() {
  const canvas = $("#qr-preview canvas");
  if (!canvas) return toast("請先產生 QR Code。", "error");
  const link = document.createElement("a");
  link.download = `自然課堂-QR-${dateKey()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function initResources() {
  const render = () => {
    const state = store.get();
    const query = $("#resource-search").value.trim().toLowerCase(), category = $("#resource-category").value, scope = $("#resource-scope").value;
    const scoped = scope === "all" ? state.resources : visibleResources(state);
    const resources = scoped.filter(item => `${item.name}${item.category}${(item.tags || []).join(" ")}`.toLowerCase().includes(query) && (category === "all" || item.category === category));
    $("#resource-grid").innerHTML = resources.map(item => {
      const cloudAction = item.type !== "file" ? "" : item.driveUrl ? `<a href="${esc(item.driveUrl)}" target="_blank" rel="noopener">開啟 Drive</a>` : state.settings.appsScriptUrl ? `<button data-upload-drive="${item.id}">上傳 Drive</button>` : "";
      return `<article class="resource-card"><div class="resource-preview">${item.type === "link" ? "WEB" : esc(item.name.split(".").pop().slice(0, 5))}</div><span class="resource-scope-tag${item.grade === RESOURCE_SCOPE_ALL ? " is-all" : ""}">${esc(item.grade)}</span><h2>${esc(item.name)}</h2><p class="resource-meta">${esc(item.category)} · ${item.size ? humanSize(item.size) : "外部連結"}<br>${formatDate(item.createdAt)}${item.cloudSyncedAt ? "<br>已備份至 Google Drive" : ""}</p><div class="resource-actions">${item.type === "link" ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">開啟</a>` : `<button data-download-resource="${item.id}">下載</button>`}${cloudAction}<button data-scope-resource="${item.id}">適用範圍</button><button data-delete-resource="${item.id}">刪除</button></div></article>`;
    }).join("");
    $("#resource-empty").hidden = resources.length > 0;
    $$('[data-download-resource]').forEach(button => button.onclick = () => downloadResource(button.dataset.downloadResource));
    $$('[data-upload-drive]').forEach(button => button.onclick = () => uploadResourceToDrive(button.dataset.uploadDrive));
    $$('[data-scope-resource]').forEach(button => button.onclick = () => showResourceScopeModal(button.dataset.scopeResource));
    $$('[data-delete-resource]').forEach(button => button.onclick = () => removeResource(button.dataset.deleteResource));
  };
  $("#storage-mode-title").textContent = store.get().settings.appsScriptUrl ? "Google 串接已設定" : "離線資料庫";
  $("#storage-mode-copy").textContent = store.get().settings.appsScriptUrl ? "結構化資料可手動同步；檔案上傳 Drive 請依設定指南部署最新版 Apps Script。" : "檔案只儲存在這台裝置的瀏覽器；可在設定中連接 Google Drive。";
  $('[data-action="upload-resource"]').onclick = () => $("#resource-file-input").click();
  $("#resource-file-input").onchange = async event => { const grade = activeGrade(store.get()); for (const file of event.target.files) { const id = uniqueId("file"); await saveFile(id, file); store.update(draft => draft.resources.unshift({ id, name: file.name, category: inferCategory(file), type: "file", size: file.size, mimeType: file.type, grade, createdAt: new Date().toISOString(), tags: [] })); } render(); event.target.value = ""; toast(`檔案已儲存到離線資料庫，適用範圍設為${grade}。`); };
  $('[data-action="add-link"]').onclick = showLinkModal;
  $("#resource-search").oninput = render; $("#resource-category").onchange = render; $("#resource-scope").onchange = render; render();
}

function scopeOptions(selected) {
  return resourceScopes.map(scope => `<option value="${esc(scope)}"${scope === selected ? " selected" : ""}>${esc(scope)}</option>`).join("");
}

function showResourceScopeModal(id) {
  const item = store.get().resources.find(resource => resource.id === id);
  if (!item) return;
  openModal({ title: "調整適用範圍", subtitle: esc(item.name), body: `<form><label class="field">適用範圍<select name="grade">${scopeOptions(item.grade)}</select></label><p class="muted">「通用」在所有班級都看得到；選擇年級後只有該年級的班級會顯示。</p><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">儲存</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = event => { event.preventDefault(); const grade = String(new FormData(event.currentTarget).get("grade")); store.update(draft => { const target = draft.resources.find(resource => resource.id === id); if (target) target.grade = grade; }); close(); initResources(); toast(`適用範圍已改為${grade}。`); };
  }});
}
function humanSize(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1048576).toFixed(1)} MB`; }
function inferCategory(file) { if (/sheet|excel|csv/i.test(`${file.type} ${file.name}`)) return "評量"; if (/worksheet|學習單/i.test(file.name)) return "學習單"; if (/student|作品/i.test(file.name)) return "學生作品"; return "教材"; }
async function downloadResource(id) { const record = await getFile(id); if (!record) return toast("找不到離線檔案，可能已清除瀏覽器資料。", "error"); download(record.name, record.blob, record.type); }
async function uploadResourceToDrive(id) { try { const record = await getFile(id); if (!record) throw new Error("找不到離線檔案，可能已清除瀏覽器資料。"); toast("正在上傳到 Google Drive…"); const result = await uploadFileToGoogle(record.blob, record.name, record.type); store.update(draft => { const item = draft.resources.find(resource => resource.id === id); if (item) { item.driveId = result.id; item.driveUrl = result.url; item.cloudSyncedAt = new Date().toISOString(); } }); initResources(); toast("檔案已備份至 Google Drive。"); } catch (error) { toast(error.message, "error"); } }
async function removeResource(id) { const item = store.get().resources.find(resource => resource.id === id); if (store.get().settings.confirmDelete && !confirm(`確定刪除「${item?.name}」？`)) return; if (item?.type === "file") await deleteFile(id); store.update(draft => { draft.resources = draft.resources.filter(resource => resource.id !== id); }); initResources(); toast("資料已刪除。"); }
function showLinkModal() { openModal({ title: "新增教學連結", body: `<form><div class="form-grid"><label class="field full-field">名稱<input name="name" required></label><label class="field full-field">網址<input name="url" type="url" placeholder="https://" required></label><label class="field">分類<select name="category"><option>連結</option><option>教材</option><option>評量</option></select></label><label class="field">適用範圍<select name="grade">${scopeOptions(activeGrade(store.get()))}</select></label><label class="field">標籤<input name="tags" placeholder="模擬, 酸鹼"></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">新增</button></div></form>`, onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); store.update(draft => draft.resources.unshift({ id: uniqueId("link"), name: String(data.get("name")), url: String(data.get("url")), category: String(data.get("category")), grade: String(data.get("grade")), type: "link", size: 0, createdAt: new Date().toISOString(), tags: String(data.get("tags") || "").split(/[,，]/).map(item => item.trim()).filter(Boolean) })); close(); initResources(); toast("教學連結已新增。"); }; }}); }

/* ---------------------------------------------------------------- 出席紀錄 */

const ATTENDANCE_ORDER = ["present", "late", "absent"];
const WATCH_ABSENCE_THRESHOLD = 3;
const WATCH_STREAK_THRESHOLD = 2;

let attendanceMonth = dateKey().slice(0, 7);
let attendanceSelectedDate = "";

function monthLabel(month) {
  const [year, mon] = month.split("-").map(Number);
  return `${year} 年 ${mon} 月`;
}

function shiftMonth(month, delta) {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(year, mon - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month) {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon, 0).getDate();
}

/** 月曆第一格要空幾格（週一為每週第一天）。 */
function leadingBlanks(month) {
  const [year, mon] = month.split("-").map(Number);
  return (new Date(year, mon - 1, 1).getDay() + 6) % 7;
}

function dayStats(date, state) {
  const students = activeStudents(state);
  const day = state.attendance[date] || {};
  const counts = { present: 0, late: 0, absent: 0, recorded: 0 };
  students.forEach(student => {
    const status = day[student.id];
    if (!status) return;
    counts.recorded += 1;
    if (counts[status] !== undefined) counts[status] += 1;
  });
  const rate = counts.recorded ? (counts.present + counts.late) / counts.recorded * 100 : null;
  return { ...counts, total: students.length, rate };
}

function initAttendance() {
  const render = () => {
    const state = store.get();
    const students = activeStudents(state);
    const dates = attendanceDatesInMonth(attendanceMonth, state);
    if (attendanceSelectedDate && !attendanceSelectedDate.startsWith(`${attendanceMonth}-`)) attendanceSelectedDate = "";
    if (!attendanceSelectedDate) attendanceSelectedDate = dates.includes(dateKey()) ? dateKey() : dates[dates.length - 1] || "";

    $("#month-title").textContent = monthLabel(attendanceMonth);
    $("#month-subtitle").textContent = `${activeClass(state).name}｜${dates.length} 個上課日有紀錄`;

    renderAttendanceStats(state, dates);
    renderCalendar(state, dates);
    renderDayPanel(state);
    renderAttendanceTrend(state, dates);
    renderWatchlist(state, dates, students);
    renderAttendanceByStudent(state, dates, students);
  };

  $('[data-action="prev-month"]').onclick = () => { attendanceMonth = shiftMonth(attendanceMonth, -1); render(); };
  $('[data-action="next-month"]').onclick = () => { attendanceMonth = shiftMonth(attendanceMonth, 1); render(); };
  $('[data-action="this-month"]').onclick = () => { attendanceMonth = dateKey().slice(0, 7); attendanceSelectedDate = ""; render(); };
  $('[data-action="export-attendance"]').onclick = () => exportAttendanceCsv();
  $('[data-action="attendance-log"]').onclick = () => showAttendanceLogModal();
  $("#attendance-sort").onchange = render;
  attendanceRender = render;
  render();
}

let attendanceRender = () => {};

function renderAttendanceStats(state, dates) {
  const students = activeStudents(state);
  const totals = dates.reduce((sum, date) => {
    const stats = dayStats(date, state);
    return { present: sum.present + stats.present, late: sum.late + stats.late, absent: sum.absent + stats.absent, recorded: sum.recorded + stats.recorded };
  }, { present: 0, late: 0, absent: 0, recorded: 0 });
  const rate = totals.recorded ? (totals.present + totals.late) / totals.recorded * 100 : 0;
  $("#attendance-stats").innerHTML = [
    statCard("班級月出席率", totals.recorded ? `${rate.toFixed(1)}%` : "—", `${students.length} 位學生｜含遲到`, "％"),
    statCard("有紀錄的上課日", dates.length, "只計算目前班級", "日"),
    statCard("當月缺席人次", totals.absent, "點下方名單追蹤", "缺"),
    statCard("當月遲到人次", totals.late, "遲到仍計入出席", "遲")
  ].join("");
}

function renderCalendar(state, dates) {
  const recorded = new Set(dates);
  const total = daysInMonth(attendanceMonth);
  const blanks = leadingBlanks(attendanceMonth);
  const cells = Array.from({ length: blanks }, () => '<span class="calendar-cell is-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= total; day += 1) {
    const date = `${attendanceMonth}-${String(day).padStart(2, "0")}`;
    if (!recorded.has(date)) {
      cells.push(`<button class="calendar-cell s-none${date === attendanceSelectedDate ? " is-selected" : ""}" data-date="${date}"><span class="cal-day">${day}</span><span class="cal-rate">—</span></button>`);
      continue;
    }
    const stats = dayStats(date, state);
    const level = stats.rate >= 95 ? "s-high" : stats.rate >= 85 ? "s-mid" : "s-low";
    const adjusted = attendanceAdjustedOn(date, state);
    cells.push(`<button class="calendar-cell ${level}${date === attendanceSelectedDate ? " is-selected" : ""}" data-date="${date}" aria-label="${date}，出席率 ${stats.rate.toFixed(0)}%"><span class="cal-day">${day}${adjusted ? '<i class="cal-adjusted-mark" title="已調整">•</i>' : ""}</span><span class="cal-rate">${stats.rate.toFixed(0)}%</span></button>`);
  }
  $("#calendar-grid").innerHTML = cells.join("");
  $$("#calendar-grid [data-date]").forEach(button => button.onclick = () => { attendanceSelectedDate = button.dataset.date; attendanceRender(); });
}

function renderDayPanel(state) {
  const date = attendanceSelectedDate;
  const roster = $("#day-roster");
  if (!date) {
    $("#day-title").textContent = "選擇日期";
    $("#day-rate").textContent = "—";
    $("#day-rate").className = "status-pill status-local";
    $("#day-hint").hidden = false;
    $("#day-bulk").hidden = true;
    roster.innerHTML = "";
    return;
  }
  const stats = dayStats(date, state);
  const adjusted = attendanceAdjustedOn(date, state);
  $("#day-title").textContent = `${date}${adjusted ? "（已調整）" : ""}`;
  $("#day-rate").textContent = stats.recorded ? `出席率 ${stats.rate.toFixed(0)}%` : "尚無紀錄";
  $("#day-rate").className = `status-pill ${stats.recorded && stats.rate >= 95 ? "status-connected" : "status-local"}`;
  $("#day-hint").hidden = true;
  $("#day-bulk").hidden = false;
  const day = state.attendance[date] || {};
  roster.innerHTML = activeStudents(state).map(student => {
    const status = day[student.id] || "";
    return `<button class="student-chip" data-attendance-student="${student.id}" data-status="${status || "none"}" aria-label="學生 ${esc(student.number)}，${statusLabel[status] || "無紀錄"}"><span class="seat">${student.seat} 號</span><strong>${esc(student.number)}</strong><small>${statusLabel[status] || "無紀錄"}</small></button>`;
  }).join("");
  $$("[data-attendance-student]").forEach(button => button.onclick = () => cycleAttendance(date, button.dataset.attendanceStudent));
  $('[data-action="day-all-present"]').onclick = () => {
    let changed = 0;
    store.update(draft => activeStudents(draft).forEach(student => { changed += setAttendance(draft, date, student.id, "present"); }));
    attendanceRender();
    toast(changed ? `${date} 已全班標記到課（${changed} 筆變更）。` : "沒有需要變更的紀錄。");
  };
}

function cycleAttendance(date, studentId) {
  const current = store.get().attendance[date]?.[studentId] || "";
  const next = ATTENDANCE_ORDER[(ATTENDANCE_ORDER.indexOf(current) + 1) % ATTENDANCE_ORDER.length];
  store.update(draft => { setAttendance(draft, date, studentId, next); });
  attendanceRender();
  toast(`${date} 已更新為「${statusLabel[next]}」。`);
}

function renderAttendanceTrend(state, dates) {
  if (!dates.length) {
    $("#attendance-trend").innerHTML = '<p class="muted">當月尚無出席紀錄。</p>';
    return;
  }
  $("#attendance-trend").innerHTML = dates.map(date => {
    const stats = dayStats(date, state);
    const value = stats.rate ?? 0;
    return `<div class="trend-row"><span class="trend-label">${date.slice(5)}</span><span class="trend-track"><i class="trend-fill" style="width:${value.toFixed(1)}%"></i></span><strong class="trend-value">${value.toFixed(0)}%</strong></div>`;
  }).join("");
}

function studentMonthStats(studentId, dates, state) {
  const counts = { present: 0, late: 0, absent: 0, recorded: 0 };
  let streak = 0;
  let maxStreak = 0;
  dates.forEach(date => {
    const status = state.attendance[date]?.[studentId];
    if (!status) return;
    counts.recorded += 1;
    if (counts[status] !== undefined) counts[status] += 1;
    if (status === "absent") { streak += 1; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
  });
  return { ...counts, maxStreak, rate: counts.recorded ? (counts.present + counts.late) / counts.recorded * 100 : null };
}

function renderWatchlist(state, dates, students) {
  const flagged = students.map(student => ({ student, stats: studentMonthStats(student.id, dates, state) }))
    .filter(item => item.stats.absent >= WATCH_ABSENCE_THRESHOLD || item.stats.maxStreak >= WATCH_STREAK_THRESHOLD)
    .sort((a, b) => b.stats.absent - a.stats.absent || b.stats.maxStreak - a.stats.maxStreak);
  if (!flagged.length) {
    $("#attendance-watchlist").innerHTML = `<p class="muted">當月沒有學生缺席達 ${WATCH_ABSENCE_THRESHOLD} 次或連續缺席 ${WATCH_STREAK_THRESHOLD} 次。</p>`;
    return;
  }
  $("#attendance-watchlist").innerHTML = `<ul class="watchlist">${flagged.map(({ student, stats }) => {
    const reasons = [];
    if (stats.absent >= WATCH_ABSENCE_THRESHOLD) reasons.push(`當月缺席 ${stats.absent} 次`);
    if (stats.maxStreak >= WATCH_STREAK_THRESHOLD) reasons.push(`最長連續缺席 ${stats.maxStreak} 次`);
    return `<li><span class="task-badge">${stats.absent}</span><div><strong>${student.seat} 號 · ${esc(student.number)}</strong><small>${reasons.join("｜")}</small></div><span class="muted">出席率 ${stats.rate === null ? "—" : `${stats.rate.toFixed(0)}%`}</span></li>`;
  }).join("")}</ul>`;
}

function renderAttendanceByStudent(state, dates, students) {
  const sort = $("#attendance-sort").value;
  const rows = students.map(student => ({ student, stats: studentMonthStats(student.id, dates, state) }));
  const sorters = {
    absent: (a, b) => b.stats.absent - a.stats.absent || a.student.seat - b.student.seat,
    late: (a, b) => b.stats.late - a.stats.late || a.student.seat - b.student.seat,
    rate: (a, b) => (a.stats.rate ?? 101) - (b.stats.rate ?? 101) || a.student.seat - b.student.seat,
    seat: (a, b) => a.student.seat - b.student.seat
  };
  rows.sort(sorters[sort] || sorters.seat);
  $("#attendance-by-student").innerHTML = rows.map(({ student, stats }) => `<tr><td>${student.seat}</td><td>${esc(student.number)}</td><td>${stats.present}</td><td>${stats.late}</td><td>${stats.absent}</td><td>${stats.rate === null ? "—" : `${stats.rate.toFixed(0)}%`}</td></tr>`).join("");
}

function exportAttendanceCsv() {
  const state = store.get();
  const dates = attendanceDatesInMonth(attendanceMonth, state);
  if (!dates.length) return toast("當月沒有出席紀錄可匯出。", "error");
  const students = activeStudents(state);
  const header = ["座號", "學生編號", ...dates, "到課", "遲到", "缺席", "出席率"];
  const rows = students.map(student => {
    const stats = studentMonthStats(student.id, dates, state);
    const cells = dates.map(date => statusLabel[state.attendance[date]?.[student.id]] || "");
    return [student.seat, student.number, ...cells, stats.present, stats.late, stats.absent, stats.rate === null ? "" : `${stats.rate.toFixed(0)}%`];
  });
  const csv = [header, ...rows].map(row => row.map(csvEscape).join(",")).join("\n");
  download(`${activeClass(state).code}-出席紀錄-${attendanceMonth}.csv`, `﻿${csv}`, "text/csv;charset=utf-8");
  toast("當月出席 CSV 已下載。");
}

function showAttendanceLogModal() {
  const state = store.get();
  const ids = new Set(activeStudents(state).map(student => student.id));
  const entries = (state.attendanceLog || []).filter(entry => ids.has(entry.studentId)).slice(0, 100);
  const numberOf = studentId => state.students.find(student => student.id === studentId)?.number || studentId;
  const body = entries.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>修改時間</th><th>出席日期</th><th>學生</th><th>原本</th><th>改為</th></tr></thead><tbody>${entries.map(entry => `<tr><td>${formatDate(entry.at)}</td><td>${esc(entry.date)}</td><td>${esc(numberOf(entry.studentId))}</td><td>${statusLabel[entry.from] || "無紀錄"}</td><td>${statusLabel[entry.to] || "無紀錄"}</td></tr>`).join("")}</tbody></table></div>`
    : '<p class="muted">目前班級尚無出席修改紀錄。</p>';
  openModal({ title: "出席修改紀錄", subtitle: "只顯示目前班級最近 100 筆調整。", className: "large", body: `${body}<div class="modal-actions"><button type="button" class="btn btn-light" data-close>關閉</button></div>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
  }});
}

function initReports() {
  const state = store.get(); const students = activeStudents(state); const studentIds = new Set(students.map(student => student.id)); const attendance = getTodayAttendance(state); const attendanceRate = students.length ? students.filter(student => attendance[student.id] !== "absent").length / students.length * 100 : 0; const classAvg = classAverage(state); const supportCount = state.observations.filter(item => studentIds.has(item.studentId) && item.level === "support").length;
  $("#report-stats").innerHTML = [statCard("今日到課率", `${attendanceRate.toFixed(0)}%`, "遲到列入到課、另行標記", "到"), statCard("班級加權平均", classAvg.toFixed(1), "已有成績學生", "均"), statCard("正向回饋事件", state.rewards.ledger.filter(item => studentIds.has(item.studentId) && item.value > 0).length, "完整流水帳可追溯", "＋"), statCard("需要支持紀錄", supportCount, "僅教師可見", "記")].join("");
  const averages = state.assessments.map(item => ({ ...item, average: assessmentAverage(item.id, state) }));
  $("#assessment-chart").setAttribute("aria-label", `各評量平均：${averages.map(item => `${item.name} ${item.average.toFixed(1)}分`).join("，")}`);
  $("#assessment-chart").innerHTML = averages.map(item => `<div class="chart-column"><span class="value" style="--bar-height:${item.average}%">${item.average.toFixed(0)}</span><i class="column" style="height:${item.average}%"></i><label>${esc(item.name)}</label></div>`).join("");
  const first = averages[0]?.average || 0, last = averages.at(-1)?.average || 0; $("#assessment-chart-summary").textContent = last >= first ? `從第一項到最近一項評量，班級平均上升 ${(last - first).toFixed(1)} 個百分點。` : `最近一項評量較第一項低 ${(first - last).toFixed(1)} 個百分點，建議檢視題型與學習難點。`;
  const categoryCounts = {}; state.rewards.ledger.filter(item => studentIds.has(item.studentId) && item.value > 0).forEach(item => categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1); const entries = Object.entries(categoryCounts).sort((a,b) => b[1]-a[1]); const rawTotal = entries.reduce((sum, [, count]) => sum + count, 0); const denominator = rawTotal || 1; const colors = ["#176b52", "#c7e66a", "#f3b94e", "#5d9ecf", "#e87964"]; let cursor = 0; const stops = entries.length ? entries.map(([, count], index) => { const start = cursor; cursor += count / denominator * 100; return `${colors[index % colors.length]} ${start}% ${cursor}%`; }).join(",") : "#edf3ef 0% 100%"; $("#reward-chart").innerHTML = `<div class="donut" style="background:conic-gradient(${stops})"><strong>${rawTotal}</strong></div><div class="chart-legend">${entries.length ? entries.map(([name, count], index) => `<span><i style="background:${colors[index % colors.length]}"></i><b>${esc(name)}</b><strong>${Math.round(count / denominator * 100)}%</strong></span>`).join("") : '<span class="muted">目前尚無正向回饋紀錄</span>'}</div>`;
  const pendingStudents = students.filter(student => state.assessments.some(item => state.scores[student.id]?.[item.id] == null)); const lowStudents = students.filter(student => (studentAverage(student.id, state) || 100) < 70); $("#teaching-insights").innerHTML = `<article class="insight-card"><strong>延續優勢</strong><p>「${esc(topCategory(state))}」是目前最常被看見的正向行為，可讓學生分享具體策略。</p></article><article class="insight-card warning"><strong>完成缺漏</strong><p>${pendingStudents.length} 位學生尚有成績缺漏，建議用短任務補齊證據。</p></article><article class="insight-card support"><strong>差異化支持</strong><p>${lowStudents.length || "目前沒有"} 位學生加權平均低於 70；先檢視單項概念，不以總分貼標籤。</p></article>`;
  $('[data-action="print-report"]').onclick = () => window.print();
  $('[data-action="create-doc-report"]').onclick = async () => { try { toast("正在建立 Google Docs 報告…"); const result = await createGoogleDocReport(); window.open(result.url, "_blank", "noopener"); toast("Google Docs 報告已建立。"); } catch (error) { toast(error.message, "error"); } };
  $('[data-action="create-student-doc"]').onclick = showStudentReportModal;
}

function showStudentReportModal() {
  const state = store.get();
  openModal({ title: "建立個別學生報告", subtitle: "成績、點數與教師觀察會分區呈現。", body: `<form><label class="field">學生<select name="studentId">${activeStudents(state).map(student => `<option value="${student.id}">${student.seat} 號 · ${esc(student.number)}</option>`).join("")}</select></label><div class="notice privacy-notice"><strong>隱私提醒</strong><span>報告只使用學生編號；建立在教師的 Google Drive 後，分享前仍請確認學校個資規範與共用權限。</span></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">建立 Google Docs</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = async event => { event.preventDefault(); try { const studentId = String(new FormData(event.currentTarget).get("studentId")); toast("正在建立個別學生報告…"); const result = await createStudentGoogleDocReport(studentId); close(); window.open(result.url, "_blank", "noopener"); toast("個別學生報告已建立。"); } catch (error) { toast(error.message, "error"); } };
  }});
}

function initSettings() {
  const state = store.get(); $("#apps-script-url").value = state.settings.appsScriptUrl || ""; $("#private-observations").checked = state.settings.privateObservations; $("#positive-only").checked = state.settings.positiveOnly; $("#confirm-delete").checked = state.settings.confirmDelete; updateGoogleStatus();
  $('[data-action="save-integration"]').onclick = async () => { const url = $("#apps-script-url").value.trim(); if (!isValidAppsScriptUrl(url)) return toast("網址格式不符，請貼上以 /exec 結尾的 Apps Script Web App 網址。", "error"); try { toast("正在測試 Google 連線…"); const result = await pingGoogle(url); store.update(draft => { draft.settings.appsScriptUrl = url; }); updateGoogleStatus(); renderPingResult(result); toast(compareScriptVersion(result.scriptVersion) < 0 ? `連線成功，但 Apps Script 仍是舊版 ${result.scriptVersion || "未知"}，請重新部署。` : "Google 串接設定成功。", compareScriptVersion(result.scriptVersion) < 0 ? "error" : "success"); } catch (error) { toast(`測試失敗：${error.message}`, "error"); renderDiagnostics([{ ok: false, label: "連線測試", detail: error.message }], { ok: false }); } };
  initDiagnostics();
  initAccountCard();
  $('[data-action="sync-now"]').onclick = async () => { try { toast("正在同步資料…"); await syncToGoogle(); updateGoogleStatus(); toast("資料已同步到 Google Sheets。"); } catch (error) { toast(error.message, "error"); } };
  $('[data-action="export-backup"]').onclick = () => { download(`自然課堂中控站備份-${dateKey()}.json`, JSON.stringify(store.get(), null, 2), "application/json"); toast("完整 JSON 備份已下載。"); };
  $('[data-action="restore-google"]').onclick = async () => { if (!confirm("從 Google 還原會覆蓋目前的本機班級資料，是否繼續？")) return; try { toast("正在讀取 Google 最新備份…"); const result = await fetchGoogleBackup(); store.replace(result.payload); initSettings(); toast("已從 Google Drive 最新備份還原。"); } catch (error) { toast(error.message, "error"); } };
  $("#backup-file").onchange = async event => { try { const next = JSON.parse(await event.target.files[0].text()); if (!confirm("還原會覆蓋目前的班級資料，是否繼續？")) return; store.replace(next); initSettings(); toast("備份已成功還原。"); } catch (error) { toast(error.message || "無法讀取備份。", "error"); } event.target.value = ""; };
  $('[data-action="reset-demo"]').onclick = () => { if (!confirm("確定重設為示範資料？目前所有本機班級紀錄會被覆蓋。")) return; store.reset(); initSettings(); toast("已重設示範資料。"); };
  [["#private-observations", "privateObservations"], ["#positive-only", "positiveOnly"], ["#confirm-delete", "confirmDelete"]].forEach(([selector, key]) => $(selector).onchange = event => store.update(draft => { draft.settings[key] = event.target.checked; }));
}

function updateGoogleStatus() { const state = store.get(), connected = Boolean(state.settings.appsScriptUrl); $("#google-status").textContent = connected ? "已設定" : "尚未連接"; $("#google-status").className = `status-pill ${connected ? "status-connected" : "status-local"}`; $("#last-sync").textContent = state.settings.lastSyncAt ? `最後成功同步：${formatDate(state.settings.lastSyncAt)}` : "尚無成功同步紀錄。"; }

async function initAccountCard() {
  const card = $("#account-card");
  if (!card) return;
  if (!isFirebaseConfigured) {
    // 尚未填 Firebase 設定時完全不顯示，避免出現按了沒反應的登入按鈕。
    card.hidden = true;
    return;
  }
  const cloud = await loadCloud();
  card.hidden = false;
  const busy = async (action, label) => {
    try { toast(`${label}中…`); await action(); toast(`${label}完成。`); }
    catch (error) { toast(error.message || `${label}失敗。`, "error"); }
  };
  card.querySelector('[data-action="cloud-sign-in"]').onclick = () => busy(cloud.signIn, "登入");
  card.querySelector('[data-action="cloud-sign-out"]').onclick = () => busy(cloud.signOutCloud, "登出");
  card.querySelector('[data-action="cloud-push"]').onclick = () => busy(cloud.forcePush, "上傳");
  card.querySelector('[data-action="cloud-pull"]').onclick = () => busy(cloud.forcePull, "下載");
  cloudResolver = cloud.resolveInitialSync;
  cloud.onCloudState(renderAccountCard);
}

let cloudResolver = null;

function renderAccountCard(cloud) {
  const card = $("#account-card");
  if (!card || !cloud.enabled) return;
  const signedIn = Boolean(cloud.user);
  $("#account-status").textContent = !cloud.ready ? "檢查登入狀態…" : signedIn ? "已登入" : "未登入";
  $("#account-status").className = `status-pill ${signedIn ? "status-connected" : "status-local"}`;
  card.querySelector('[data-action="cloud-sign-in"]').hidden = signedIn;
  ["cloud-sign-out", "cloud-push", "cloud-pull"].forEach(action => { card.querySelector(`[data-action="${action}"]`).hidden = !signedIn; });

  const detail = $("#account-detail");
  detail.hidden = !signedIn;
  if (signedIn) {
    detail.innerHTML = `<strong>${esc(cloud.user.email || "")}</strong><small>${cloud.lastSyncedAt ? `最後同步：${formatDate(cloud.lastSyncedAt)}` : "尚未同步"}</small>`;
  }

  const resolution = $("#cloud-resolution");
  resolution.hidden = !cloud.pendingResolution;
  if (cloud.pendingResolution) {
    const { cloudUpdatedAt, localUpdatedAt } = cloud.pendingResolution;
    resolution.innerHTML = `<strong>雲端與這台裝置都有資料，請選擇要保留哪一份</strong><span>雲端最後更新：${cloudUpdatedAt ? formatDate(cloudUpdatedAt) : "未知"}；這台裝置：${localUpdatedAt ? formatDate(localUpdatedAt) : "未知"}。另一份會被覆蓋，建議先「下載 JSON 備份」再選。</span><div class="button-row"><button class="btn btn-primary" data-choose="cloud">改用雲端資料</button><button class="btn btn-light" data-choose="local">保留這台裝置並覆蓋雲端</button></div>`;
    resolution.querySelectorAll("[data-choose]").forEach(button => button.onclick = async () => {
      try {
        toast("處理中…");
        await cloudResolver(button.dataset.choose);
        initSettings();
        toast(button.dataset.choose === "cloud" ? "已改用雲端資料。" : "已把這台裝置的資料上傳為雲端版本。");
      } catch (error) { toast(error.message || "處理失敗。", "error"); }
    });
  }
}

let lastDiagnosticsReport = "";

function initDiagnostics() {
  const list = $("#diagnostics-list");
  if (!list) return;
  $('[data-action="run-diagnostics"]').onclick = () => runDiagnostics("readonly");
  $('[data-action="run-selftest"]').onclick = () => runDiagnostics("write");
  $('[data-action="copy-diagnostics"]').onclick = async () => {
    if (!lastDiagnosticsReport) return toast("請先執行一次診斷。", "error");
    try { await navigator.clipboard.writeText(lastDiagnosticsReport); toast("診斷結果已複製，可直接貼到問題回報。"); }
    catch (error) { toast("瀏覽器不允許複製，請手動選取畫面內容。", "error"); }
  };
}

async function runDiagnostics(mode) {
  const url = $("#apps-script-url").value.trim() || store.get().settings.appsScriptUrl;
  if (!isValidAppsScriptUrl(url)) return toast("請先貼上以 /exec 結尾的 Apps Script Web App 網址。", "error");
  const buttons = $$('#diagnostics-card button');
  buttons.forEach(button => { button.disabled = true; });
  setDiagnosticsStatus("檢測中…", "status-local");
  $("#diagnostics-list").innerHTML = `<li class="is-note">${mode === "write" ? "正在執行寫入測試，Apps Script 需要建立與刪除測試檔案，約需 10–30 秒…" : "正在執行唯讀診斷…"}</li>`;
  try {
    const result = mode === "write"
      ? await selfTestGoogle({ keepArtifacts: $("#keep-artifacts").checked, url })
      : await diagnoseGoogle(url);
    const items = mode === "write" ? (result.steps || []) : (result.checks || []);
    renderDiagnostics([versionCheck(result.scriptVersion), ...items], result, mode);
  } catch (error) {
    renderDiagnostics([{ ok: false, label: mode === "write" ? "寫入測試" : "唯讀診斷", detail: error.message }], { ok: false }, mode);
    toast(error.message, "error");
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

function versionCheck(actual) {
  const comparison = compareScriptVersion(actual);
  if (comparison === 0) return { ok: true, label: "Apps Script 版本", detail: `${actual}（與前端相符）` };
  if (comparison < 0) return { ok: false, label: "Apps Script 版本", detail: `部署中的版本為 ${actual || "未知"}，前端需要 ${EXPECTED_SCRIPT_VERSION}。請把最新 Code.gs 貼回 Apps Script，並在「管理部署作業」重新部署為新版本。` };
  return { ok: true, label: "Apps Script 版本", detail: `${actual}（比前端 ${EXPECTED_SCRIPT_VERSION} 新，功能相容）` };
}

function renderPingResult(result) {
  renderDiagnostics([versionCheck(result.scriptVersion), { ok: true, label: "Web App 回應", detail: `${result.app || "Apps Script"}｜伺服器時間 ${result.serverTime || "—"}` }], result, "ping");
}

function setDiagnosticsStatus(text, className) {
  const pill = $("#diagnostics-status");
  if (!pill) return;
  pill.textContent = text;
  pill.className = `status-pill ${className}`;
}

function renderDiagnostics(items, result = {}, mode = "readonly") {
  const list = $("#diagnostics-list");
  if (!list) return;
  const passed = items.filter(item => item.ok).length;
  const allOk = items.length > 0 && passed === items.length;
  setDiagnosticsStatus(allOk ? `全部通過（${passed}/${items.length}）` : `${items.length - passed} 項未通過`, allOk ? "status-connected" : "status-warn");
  list.innerHTML = items.map(item => `<li class="${item.ok ? "is-pass" : "is-fail"}"><span class="diag-icon" aria-hidden="true">${item.ok ? "✓" : "✕"}</span><span class="diag-label"><strong>${esc(item.label)}</strong><small>${esc(item.detail || "")}</small></span><span class="diag-meta">${typeof item.ms === "number" ? `${item.ms} ms` : ""}${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">開啟</a>` : ""}</span></li>`).join("");

  const summary = $("#diagnostics-summary");
  const facts = [
    result.effectiveUser ? `執行身分：${result.effectiveUser}` : "",
    result.timeZone ? `指令碼時區：${result.timeZone}` : "",
    result.serverTime ? `伺服器時間：${result.serverTime}` : "",
    result.keptArtifacts ? "測試產物已保留在 Drive 資料夾，請自行刪除。" : "",
    (result.artifacts || []).map(item => `${item.label}：${item.url}`).join("\n")
  ].filter(Boolean);
  summary.hidden = !facts.length;
  summary.className = `diagnostics-summary ${allOk ? "" : "is-fail"}`;
  summary.innerHTML = facts.map(fact => `<span>${esc(fact)}</span>`).join("");

  const title = mode === "write" ? "寫入測試" : mode === "ping" ? "連線測試" : "唯讀診斷";
  lastDiagnosticsReport = [
    `自然課堂中控站 ${title} 結果`,
    `前端預期 Apps Script 版本：${EXPECTED_SCRIPT_VERSION}`,
    ...facts,
    "",
    ...items.map(item => `[${item.ok ? "PASS" : "FAIL"}] ${item.label}｜${item.detail || ""}${item.url ? `｜${item.url}` : ""}`)
  ].join("\n");
}

function initPage() {
  if (page === "dashboard") initDashboard();
  else if (page === "classroom") initClassroom();
  else if (page === "students") initStudents();
  else if (page === "attendance") initAttendance();
  else if (page === "rewards") initRewards();
  else if (page === "grades") initGrades();
  else if (page === "tools") initTools();
  else if (page === "resources") initResources();
  else if (page === "reports") initReports();
  else if (page === "settings") initSettings();
}

initPage();
