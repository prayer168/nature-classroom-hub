import { renderChrome } from "./chrome.js";
import { store, getTodayAttendance, studentPoints, studentAverage, classAverage, assessmentAverage, uniqueId, dateKey } from "./store.js";
import { saveFile, getFile, deleteFile } from "./resource-db.js";
import { pingGoogle, syncToGoogle, createGoogleDocReport } from "./google-bridge.js";

const page = document.body.dataset.page;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const formatDate = value => new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const formatDay = value => new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(value);
const statusLabel = { present: "到課", absent: "缺席", late: "遲到" };

renderChrome();

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
  return `<div class="student-picker">${store.get().students.map(student => `<label><input type="${multiple ? "checkbox" : "radio"}" name="studentIds" value="${student.id}"><span>${student.seat}. ${esc(student.name)}</span></label>`).join("")}</div>`;
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
            draft.observations.unshift({ id: uniqueId("obs"), studentId, category, level: supportMode ? "support" : "positive", note, lesson: draft.lesson.topic, createdAt: new Date().toISOString() });
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
  const attendance = getTodayAttendance(state);
  const present = Object.values(attendance).filter(value => value === "present").length;
  const todayRewards = state.rewards.ledger.filter(entry => entry.createdAt.slice(0, 10) === dateKey()).length;
  $("#today-label").textContent = formatDay(new Date());
  $("#dashboard-stats").innerHTML = [
    statCard("今日到課", `${present}/${state.students.length}`, `<strong>${Math.round(present / state.students.length * 100)}%</strong> 到課率`, "到"),
    statCard("今日正向回饋", todayRewards || 6, "持續看見具體行為", "＋"),
    statCard("班級學業平均", `${classAverage(state).toFixed(1)}`, "依目前有成績項目計算", "分"),
    statCard("待補交", state.students.filter(student => Object.values(state.scores[student.id] || {}).some(value => value === null)).length, "點擊成績簿查看名單", "待")
  ].join("");
  $("#quick-attendance").innerHTML = state.students.map(student => `<button class="student-chip" data-student-id="${student.id}" data-status="${attendance[student.id] || "present"}" aria-label="${esc(student.name)}，${statusLabel[attendance[student.id]] || "到課"}"><span class="seat">${student.seat} 號</span><strong>${esc(student.name.slice(-2))}</strong></button>`).join("");
  $("#sync-pill").textContent = state.settings.appsScriptUrl ? "Google 待同步" : "本機模式";
  $("#sync-pill").className = `status-pill ${state.settings.appsScriptUrl ? "status-connected" : "status-local"}`;
  $("#lesson-topic").textContent = state.lesson.topic;
  const weekly = [{ day: "一", a: 92, p: 73 }, { day: "二", a: 96, p: 78 }, { day: "三", a: 96, p: 84 }, { day: "四", a: 100, p: 82 }, { day: "五", a: 94, p: 88 }];
  $("#pulse-chart").innerHTML = weekly.map(item => `<div class="bar-group"><i class="bar" style="height:${item.a}%" title="出席 ${item.a}%"></i><i class="bar secondary" style="height:${item.p}%" title="參與 ${item.p}%"></i><label>週${item.day}</label></div>`).join("");
  $("#pulse-summary").innerHTML = `<strong>本週亮點：</strong> 合作學習回饋比上週增加，探究發表的完成度也正在上升。`;
  $("#follow-up-list").innerHTML = `<li><span class="task-badge">${state.students.filter(student => state.scores[student.id]?.a04 === null).length}</span><div><strong>探究發表待補交</strong><small>建議下節課安排 8 分鐘完成</small></div><a href="grades.html">查看</a></li><li><span class="task-badge">1</span><div><strong>今日缺席學生</strong><small>補發實驗安全與紀錄單</small></div><a href="students.html">查看</a></li><li><span class="task-badge">3</span><div><strong>教材尚未備份</strong><small>離線檔案建議同步到 Drive</small></div><a href="settings.html">設定</a></li>`;

  $$(".student-chip").forEach(button => button.addEventListener("click", () => {
    const order = ["present", "late", "absent"];
    const next = order[(order.indexOf(button.dataset.status) + 1) % order.length];
    store.update(draft => { getTodayAttendance(draft)[button.dataset.studentId] = next; });
    initDashboard();
    toast(`已更新為「${statusLabel[next]}」。`);
  }));
  $$('[data-quick-point]').forEach(button => button.addEventListener("click", () => showPointModal(button.dataset.quickPoint, Number(button.dataset.value), button.dataset.quickPoint === "需要支持")));
  $('[data-action="all-present"]').onclick = () => { store.update(draft => draft.students.forEach(student => { getTodayAttendance(draft)[student.id] = "present"; })); initDashboard(); toast("已將全班標記為到課。"); };
  $('[data-action="start-class"]').onclick = () => { store.update(draft => { draft.lesson.startedAt = new Date().toISOString(); }); toast("課堂已開始，祝今天探究順利！"); };
  $('[data-action="edit-lesson"]').onclick = () => openLessonModal();
}

function openLessonModal() {
  const lesson = store.get().lesson;
  openModal({ title: "編輯今日課堂", body: `<form id="lesson-form"><div class="form-grid"><label class="field full-field">單元主題<input name="topic" value="${esc(lesson.topic)}" required></label><label class="field">課次<input name="session" value="${esc(lesson.session)}"></label><label class="field">今日任務<input name="task" value="${esc(lesson.task)}"></label></div><div class="modal-actions"><button class="btn btn-light" type="button" data-close>取消</button><button class="btn btn-primary">儲存</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); store.update(draft => { draft.lesson.topic = String(data.get("topic")); draft.lesson.session = String(data.get("session")); draft.lesson.task = String(data.get("task")); }); close(); initDashboard(); toast("課堂資訊已更新。"); };
  }});
}

function initStudents() {
  const render = () => {
    const state = store.get();
    const query = $("#student-search").value.trim().toLowerCase();
    const filter = $("#student-status-filter").value;
    const attendance = getTodayAttendance(state);
    const students = state.students.filter(student => {
      const matchesText = `${student.seat}${student.name}${student.tags.join(" ")}`.toLowerCase().includes(query);
      return matchesText && (filter === "all" || attendance[student.id] === filter);
    });
    $("#student-table-body").innerHTML = students.map(student => {
      const status = attendance[student.id] || "present";
      const average = studentAverage(student.id, state);
      return `<tr><td><div class="student-cell"><span class="avatar">${esc(student.name.slice(-1))}</span><div><strong>${student.seat}. ${esc(student.name)}</strong><small>${esc(state.classes[0].name)}</small></div></div></td><td><span class="badge ${status}">${statusLabel[status]}</span></td><td><strong>${studentPoints(student.id, state)}</strong> 點</td><td>${average === null ? "—" : `<strong>${average.toFixed(1)}</strong>`}</td><td>${student.tags.length ? student.tags.map(tag => `<span class="tag">${esc(tag)}</span>`).join("") : '<span class="muted">—</span>'}</td><td><div class="row-actions"><button data-edit-student="${student.id}">編輯</button><button data-student-point="${student.id}">加點</button></div></td></tr>`;
    }).join("");
    $("#student-empty").hidden = students.length > 0;
    $$('[data-edit-student]').forEach(button => button.onclick = () => showStudentModal(button.dataset.editStudent));
    $$('[data-student-point]').forEach(button => button.onclick = () => showPointModalForOne(button.dataset.studentPoint));
  };
  $("#student-search").oninput = render;
  $("#student-status-filter").onchange = render;
  $('[data-action="add-student"]').onclick = () => showStudentModal();
  $('[data-action="export-students"]').onclick = exportStudents;
  $('[data-action="import-students"]').onclick = importStudents;
  render();
}

function showStudentModal(studentId = null) {
  const current = store.get().students.find(student => student.id === studentId);
  openModal({ title: current ? "編輯學生" : "新增學生", subtitle: "只填課堂管理真正需要的資料。", body: `<form><div class="form-grid"><label class="field">座號<input name="seat" type="number" min="1" value="${current?.seat ?? store.get().students.length + 1}" required></label><label class="field">姓名<input name="name" value="${esc(current?.name || "")}" required></label><label class="field full-field">標籤（以逗號分隔）<input name="tags" value="${esc(current?.tags?.join(", ") || "")}" placeholder="例如：器材長, 需留意視力"></label><label class="field full-field">教師私密備註<textarea name="note" rows="3">${esc(current?.note || "")}</textarea></label></div><div class="modal-actions">${current ? '<button class="btn btn-danger-quiet" type="button" data-delete>刪除</button>' : ""}<button class="btn btn-light" type="button" data-close>取消</button><button class="btn btn-primary">儲存</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      store.update(draft => {
        const payload = { seat: Number(data.get("seat")), name: String(data.get("name")).trim(), tags: String(data.get("tags") || "").split(/[,，]/).map(item => item.trim()).filter(Boolean), note: String(data.get("note") || "") };
        if (current) Object.assign(draft.students.find(item => item.id === current.id), payload);
        else { const id = uniqueId("student"); draft.students.push({ id, classId: draft.activeClassId, active: true, createdAt: new Date().toISOString(), ...payload }); draft.scores[id] = {}; getTodayAttendance(draft)[id] = "present"; }
      });
      close(); initStudents(); toast(current ? "學生資料已更新。" : "已新增學生。");
    };
    modal.querySelector("[data-delete]")?.addEventListener("click", () => {
      if (store.get().settings.confirmDelete && !confirm(`確定刪除 ${current.name}？相關成績與點數也會一併移除。`)) return;
      store.update(draft => { draft.students = draft.students.filter(item => item.id !== current.id); delete draft.scores[current.id]; Object.values(draft.attendance).forEach(day => delete day[current.id]); draft.rewards.ledger = draft.rewards.ledger.filter(item => item.studentId !== current.id); });
      close(); initStudents(); toast("學生資料已刪除。");
    });
  }});
}

function showPointModalForOne(studentId) {
  const student = store.get().students.find(item => item.id === studentId);
  openModal({ title: `給 ${student.name} 點數`, body: `<form><div class="form-grid"><label class="field">回饋類型<select name="category"><option>探究精神</option><option>合作學習</option><option>安全操作</option><option>清楚表達</option></select></label><label class="field">點數<input name="value" type="number" min="1" max="10" value="1"></label><label class="field full-field">備註<textarea name="note" rows="3"></textarea></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">儲存</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); store.update(draft => draft.rewards.ledger.unshift({ id: uniqueId("reward"), studentId, category: String(data.get("category")), value: Number(data.get("value")), note: String(data.get("note") || ""), createdAt: new Date().toISOString() })); close(); initStudents(); toast("點數已儲存。"); };
  }});
}

function exportStudents() {
  const state = store.get(); const attendance = getTodayAttendance(state);
  const rows = [["座號", "姓名", "今日狀態", "點數", "學業平均", "標籤"], ...state.students.map(student => [student.seat, student.name, statusLabel[attendance[student.id]], studentPoints(student.id, state), studentAverage(student.id, state)?.toFixed(1) || "", student.tags.join(";")])];
  download(`自然課學生名冊-${dateKey()}.csv`, "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8");
  toast("學生名冊已匯出。");
}

function importStudents() {
  const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,text/csv";
  input.onchange = async () => {
    const text = await input.files[0].text(); const rows = parseCsv(text); if (!rows.length) return toast("CSV 沒有可讀資料。", "error");
    const header = rows[0].map(item => item.toLowerCase()); const nameIndex = header.findIndex(item => ["姓名", "name", "學生"].includes(item)); const seatIndex = header.findIndex(item => ["座號", "seat", "number"].includes(item)); const dataRows = nameIndex >= 0 ? rows.slice(1) : rows;
    store.update(draft => dataRows.forEach((row, index) => { const name = (nameIndex >= 0 ? row[nameIndex] : row[1] || row[0])?.trim(); if (!name) return; const seat = Number(seatIndex >= 0 ? row[seatIndex] : row[0]) || draft.students.length + 1; if (draft.students.some(item => item.name === name && item.seat === seat)) return; const id = uniqueId("student"); draft.students.push({ id, seat, name, classId: draft.activeClassId, tags: [], note: "", active: true, createdAt: new Date().toISOString() }); draft.scores[id] = {}; getTodayAttendance(draft)[id] = "present"; }));
    initStudents(); toast("CSV 名冊已匯入，重複姓名與座號已略過。");
  };
  input.click();
}

function initRewards() {
  const render = () => {
    const state = store.get(); const query = $("#reward-search")?.value.trim().toLowerCase() || "";
    const total = state.rewards.ledger.filter(entry => entry.value > 0).reduce((sum, entry) => sum + entry.value, 0);
    const redeemed = Math.abs(state.rewards.ledger.filter(entry => entry.value < 0).reduce((sum, entry) => sum + entry.value, 0));
    $("#reward-stats").innerHTML = [statCard("本週正向點數", total, "包含個人與小組回饋", "＋"), statCard("獲得回饋學生", new Set(state.rewards.ledger.filter(entry => entry.value > 0).map(entry => entry.studentId)).size, "持續讓每位學生被看見", "人"), statCard("已兌換點數", redeemed, "兌換後保留完整流水帳", "換"), statCard("最常見回饋", topCategory(state), "依本期點數事件統計", "類")].join("");
    $("#reward-student-grid").innerHTML = state.students.filter(student => student.name.toLowerCase().includes(query)).map(student => `<article class="reward-person"><span class="avatar">${esc(student.name.slice(-1))}</span><div><strong>${student.seat}. ${esc(student.name)}</strong><small>本期累積</small></div><span class="points">${studentPoints(student.id, state)}</span></article>`).join("");
    $("#reward-menu").innerHTML = state.rewards.menu.map(item => `<div class="reward-item"><div><strong>${esc(item.name)}</strong><small>${esc(item.note)}</small></div><span class="reward-cost">${item.cost} 點</span></div>`).join("");
    $("#ledger-body").innerHTML = state.rewards.ledger.slice(0, 80).map(entry => { const student = state.students.find(item => item.id === entry.studentId); return `<tr><td>${formatDate(entry.createdAt)}</td><td>${esc(student?.name || "已刪除")}</td><td>${esc(entry.category)}</td><td><span class="delta ${entry.value >= 0 ? "positive" : "negative"}">${entry.value > 0 ? "+" : ""}${entry.value}</span></td><td>${esc(entry.note || "—")}</td></tr>`; }).join("");
  };
  $('[data-action="give-points"]').onclick = () => showPointModal();
  $('[data-action="redeem"]').onclick = showRedeemModal;
  $('[data-action="export-ledger"]').onclick = exportLedger;
  $('[data-action="edit-reward-menu"]').onclick = editRewardMenu;
  $("#reward-search").oninput = render;
  render();
}

function topCategory(state) {
  const counts = {}; state.rewards.ledger.filter(item => item.value > 0).forEach(item => counts[item.category] = (counts[item.category] || 0) + 1);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
}

function showRedeemModal() {
  const state = store.get();
  openModal({ title: "兌換獎勵", subtitle: "兌換會扣除點數並保留流水帳。", body: `<form><div class="form-grid"><label class="field full-field">學生<select name="studentId">${state.students.map(student => `<option value="${student.id}">${student.seat}. ${esc(student.name)}（${studentPoints(student.id, state)} 點）</option>`).join("")}</select></label><label class="field full-field">獎勵<select name="rewardId">${state.rewards.menu.map(item => `<option value="${item.id}">${esc(item.name)}（${item.cost} 點）</option>`).join("")}</select></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">確認兌換</button></div></form>`, onReady(modal, close) {
    modal.querySelector("[data-close]").onclick = close;
    modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); const studentId = String(data.get("studentId")); const reward = state.rewards.menu.find(item => item.id === data.get("rewardId")); if (studentPoints(studentId) < reward.cost) return toast("點數不足，無法兌換。", "error"); store.update(draft => draft.rewards.ledger.unshift({ id: uniqueId("redeem"), studentId, category: "獎勵兌換", value: -reward.cost, note: reward.name, createdAt: new Date().toISOString() })); close(); initRewards(); toast(`已兌換「${reward.name}」。`); };
  }});
}

function editRewardMenu() {
  openModal({ title: "新增兌換項目", body: `<form><div class="form-grid"><label class="field">名稱<input name="name" required></label><label class="field">所需點數<input name="cost" type="number" min="1" value="10" required></label><label class="field full-field">說明<input name="note"></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">新增</button></div></form>`, onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); store.update(draft => draft.rewards.menu.push({ id: uniqueId("menu"), name: String(data.get("name")), cost: Number(data.get("cost")), note: String(data.get("note") || "") })); close(); initRewards(); toast("兌換項目已新增。"); }; }});
}

function exportLedger() {
  const state = store.get(); const rows = [["時間", "學生", "類型", "點數", "備註"], ...state.rewards.ledger.map(entry => [entry.createdAt, state.students.find(item => item.id === entry.studentId)?.name || "", entry.category, entry.value, entry.note])]; download(`自然課點數流水帳-${dateKey()}.csv`, "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8"); toast("流水帳已匯出。");
}

function initGrades() {
  const state = store.get();
  const pending = state.students.filter(student => state.assessments.some(item => state.scores[student.id]?.[item.id] === null || state.scores[student.id]?.[item.id] === undefined)).length;
  const best = [...state.assessments].sort((a, b) => assessmentAverage(b.id, state) - assessmentAverage(a.id, state))[0];
  $("#grade-stats").innerHTML = [statCard("班級平均", classAverage(state).toFixed(1), "依評量權重自動換算", "均"), statCard("目前評量", state.assessments.length, `總權重 ${state.assessments.reduce((s, a) => s + a.weight, 0)}%`, "項"), statCard("待補成績", pending, "至少一項尚未輸入", "待"), statCard("表現較佳項目", best?.name || "—", `${assessmentAverage(best?.id, state).toFixed(1)}%`, "優")].join("");
  $("#gradebook-head").innerHTML = `<tr><th>學生</th>${state.assessments.map(item => `<th><div class="assessment-head"><strong>${esc(item.name)}</strong><small>${item.maxScore} 分 · 權重 ${item.weight}%</small></div></th>`).join("")}<th>加權平均</th></tr>`;
  $("#gradebook-body").innerHTML = state.students.map(student => `<tr><td><div class="student-cell"><span class="avatar">${esc(student.name.slice(-1))}</span><div><strong>${student.seat}. ${esc(student.name)}</strong></div></div></td>${state.assessments.map(item => { const value = state.scores[student.id]?.[item.id]; return `<td><input class="score-input" data-student="${student.id}" data-assessment="${item.id}" data-max="${item.maxScore}" type="number" min="0" max="${item.maxScore}" value="${value ?? ""}" aria-label="${esc(student.name)} ${esc(item.name)}分數"></td>`; }).join("")}<td><span class="score-average">${studentAverage(student.id, state)?.toFixed(1) || "—"}</span></td></tr>`).join("");
  $$(".score-input").forEach(input => {
    input.onchange = () => { const value = input.value === "" ? null : Number(input.value); if (value !== null && (value < 0 || value > Number(input.dataset.max))) { input.classList.add("invalid"); return toast(`分數需介於 0 到 ${input.dataset.max}。`, "error"); } input.classList.remove("invalid"); store.update(draft => { draft.scores[input.dataset.student] ||= {}; draft.scores[input.dataset.student][input.dataset.assessment] = value; }); initGrades(); toast("成績已儲存。"); };
    input.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); input.onchange(); } };
  });
  $('[data-action="add-assessment"]').onclick = showAssessmentModal;
  $('[data-action="export-grades"]').onclick = exportGrades;
}

function showAssessmentModal() {
  openModal({ title: "新增評量", subtitle: "評量權重用來換算學期表現，可稍後調整。", body: `<form><div class="form-grid"><label class="field full-field">評量名稱<input name="name" required placeholder="例如：酸鹼指示劑實驗"></label><label class="field">類型<select name="type"><option>形成性</option><option>實作</option><option>總結性</option></select></label><label class="field">日期<input name="date" type="date" value="${dateKey()}"></label><label class="field">滿分<input name="maxScore" type="number" min="1" value="20" required></label><label class="field">權重（%）<input name="weight" type="number" min="0" max="100" value="10" required></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">建立評量</button></div></form>`, onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget), id = uniqueId("assessment"); store.update(draft => { draft.assessments.push({ id, name: String(data.get("name")), type: String(data.get("type")), date: String(data.get("date")), maxScore: Number(data.get("maxScore")), weight: Number(data.get("weight")) }); draft.students.forEach(student => { draft.scores[student.id] ||= {}; draft.scores[student.id][id] = null; }); }); close(); initGrades(); toast("評量已建立，可直接輸入成績。"); }; }});
}

function exportGrades() {
  const state = store.get(); const rows = [["座號", "姓名", ...state.assessments.map(item => `${item.name}（/${item.maxScore}）`), "加權平均"], ...state.students.map(student => [student.seat, student.name, ...state.assessments.map(item => state.scores[student.id]?.[item.id] ?? ""), studentAverage(student.id, state)?.toFixed(1) || ""])]; download(`自然科成績簿-${dateKey()}.csv`, "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8"); toast("成績簿已匯出。");
}

let timerState = { remaining: 300, initial: 300, running: false, interval: null };
let stopwatch = { elapsed: 0, running: false, startedAt: 0, interval: null };

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
  $('[data-action="project-mode"]').onclick = () => { document.body.classList.toggle("projecting"); $('[data-action="project-mode"]').textContent = document.body.classList.contains("projecting") ? "離開投影模式" : "進入投影模式"; };
}

function renderTimer() { const minutes = Math.floor(timerState.remaining / 60), seconds = timerState.remaining % 60; $("#timer-display").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; $('[data-action="timer-toggle"]').textContent = timerState.running ? "暫停" : "開始"; }
function toggleTimer() { if (timerState.running) { clearInterval(timerState.interval); timerState.running = false; renderTimer(); return; } timerState.running = true; timerState.interval = setInterval(() => { timerState.remaining--; if (timerState.remaining <= 0) { timerState.remaining = 0; timerState.running = false; clearInterval(timerState.interval); toast("時間到！請完成紀錄並整理器材。"); } renderTimer(); }, 1000); renderTimer(); }
function pickRandomStudent() { const state = store.get(); const attendance = getTodayAttendance(state); let pool = state.students.filter(student => !$("#exclude-absent").checked || attendance[student.id] !== "absent"); const recent = state.toolHistory.recentlyPicked || []; const fresh = pool.filter(student => !recent.slice(-Math.min(5, pool.length - 1)).includes(student.id)); if (fresh.length) pool = fresh; const student = pool[Math.floor(Math.random() * pool.length)]; if (!student) return toast("目前沒有可抽選的學生。", "error"); store.update(draft => { draft.toolHistory.recentlyPicked.push(student.id); draft.toolHistory.recentlyPicked = draft.toolHistory.recentlyPicked.slice(-20); }); $("#random-result").innerHTML = `<small>${student.seat} 號</small><strong>${esc(student.name)}</strong>`; }
function makeGroups() { const size = Math.max(2, Math.min(8, Number($("#group-size").value) || 4)); const state = store.get(); const attendance = getTodayAttendance(state); const pool = state.students.filter(student => attendance[student.id] !== "absent").sort(() => Math.random() - .5); const groupCount = Math.ceil(pool.length / size); const groups = Array.from({ length: groupCount }, () => []); pool.forEach((student, index) => groups[index % groupCount].push(student)); $("#group-preview").innerHTML = groups.map((group, index) => `<div class="group-box"><strong>第 ${index + 1} 組</strong>${group.map(student => `<span>${esc(student.name)}</span>`).join("")}</div>`).join(""); }
function rollDice() { const dice = $("#dice"); dice.classList.remove("rolling"); void dice.offsetWidth; dice.classList.add("rolling"); let count = 0; const interval = setInterval(() => { dice.textContent = Math.floor(Math.random() * 6) + 1; if (++count >= 7) clearInterval(interval); }, 55); }
function stopwatchText(ms) { const tenths = Math.floor(ms / 100) % 10, totalSeconds = Math.floor(ms / 1000); return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}.${tenths}`; }
function toggleStopwatch() { if (stopwatch.running) { stopwatch.elapsed += Date.now() - stopwatch.startedAt; clearInterval(stopwatch.interval); stopwatch.running = false; } else { stopwatch.startedAt = Date.now(); stopwatch.running = true; stopwatch.interval = setInterval(() => $("#stopwatch-display").textContent = stopwatchText(stopwatch.elapsed + Date.now() - stopwatch.startedAt), 100); } $('[data-action="stopwatch-toggle"]').textContent = stopwatch.running ? "暫停" : "開始"; }
function addLap() { const value = stopwatch.elapsed + (stopwatch.running ? Date.now() - stopwatch.startedAt : 0); const li = document.createElement("li"); li.textContent = `分段 ${$("#lap-list").children.length + 1}　${stopwatchText(value)}`; $("#lap-list").prepend(li); }
function resetStopwatch() { clearInterval(stopwatch.interval); stopwatch = { elapsed: 0, running: false, startedAt: 0, interval: null }; $("#stopwatch-display").textContent = "00:00.0"; $("#lap-list").innerHTML = ""; $('[data-action="stopwatch-toggle"]').textContent = "開始"; }

function initResources() {
  const render = () => { const state = store.get(); const query = $("#resource-search").value.trim().toLowerCase(), category = $("#resource-category").value; const resources = state.resources.filter(item => `${item.name}${item.category}${(item.tags || []).join(" ")}`.toLowerCase().includes(query) && (category === "all" || item.category === category)); $("#resource-grid").innerHTML = resources.map(item => `<article class="resource-card"><div class="resource-preview">${item.type === "link" ? "WEB" : esc(item.name.split(".").pop().slice(0, 5))}</div><h2>${esc(item.name)}</h2><p class="resource-meta">${esc(item.category)} · ${item.size ? humanSize(item.size) : "外部連結"}<br>${formatDate(item.createdAt)}</p><div class="resource-actions">${item.type === "link" ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">開啟</a>` : `<button data-download-resource="${item.id}">下載</button>`}<button data-delete-resource="${item.id}">刪除</button></div></article>`).join(""); $("#resource-empty").hidden = resources.length > 0; $$('[data-download-resource]').forEach(button => button.onclick = () => downloadResource(button.dataset.downloadResource)); $$('[data-delete-resource]').forEach(button => button.onclick = () => removeResource(button.dataset.deleteResource)); };
  $("#storage-mode-title").textContent = store.get().settings.appsScriptUrl ? "Google 串接已設定" : "離線資料庫";
  $("#storage-mode-copy").textContent = store.get().settings.appsScriptUrl ? "結構化資料可手動同步；檔案上傳 Drive 請依設定指南部署最新版 Apps Script。" : "檔案只儲存在這台裝置的瀏覽器；可在設定中連接 Google Drive。";
  $('[data-action="upload-resource"]').onclick = () => $("#resource-file-input").click();
  $("#resource-file-input").onchange = async event => { for (const file of event.target.files) { const id = uniqueId("file"); await saveFile(id, file); store.update(draft => draft.resources.unshift({ id, name: file.name, category: inferCategory(file), type: "file", size: file.size, mimeType: file.type, createdAt: new Date().toISOString(), tags: [] })); } render(); event.target.value = ""; toast("檔案已儲存到離線資料庫。"); };
  $('[data-action="add-link"]').onclick = showLinkModal;
  $("#resource-search").oninput = render; $("#resource-category").onchange = render; render();
}
function humanSize(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1048576).toFixed(1)} MB`; }
function inferCategory(file) { if (/sheet|excel|csv/i.test(`${file.type} ${file.name}`)) return "評量"; if (/worksheet|學習單/i.test(file.name)) return "學習單"; if (/student|作品/i.test(file.name)) return "學生作品"; return "教材"; }
async function downloadResource(id) { const record = await getFile(id); if (!record) return toast("找不到離線檔案，可能已清除瀏覽器資料。", "error"); download(record.name, record.blob, record.type); }
async function removeResource(id) { const item = store.get().resources.find(resource => resource.id === id); if (store.get().settings.confirmDelete && !confirm(`確定刪除「${item?.name}」？`)) return; if (item?.type === "file") await deleteFile(id); store.update(draft => { draft.resources = draft.resources.filter(resource => resource.id !== id); }); initResources(); toast("資料已刪除。"); }
function showLinkModal() { openModal({ title: "新增教學連結", body: `<form><div class="form-grid"><label class="field full-field">名稱<input name="name" required></label><label class="field full-field">網址<input name="url" type="url" placeholder="https://" required></label><label class="field">分類<select name="category"><option>連結</option><option>教材</option><option>評量</option></select></label><label class="field">標籤<input name="tags" placeholder="模擬, 酸鹼"></label></div><div class="modal-actions"><button type="button" class="btn btn-light" data-close>取消</button><button class="btn btn-primary">新增</button></div></form>`, onReady(modal, close) { modal.querySelector("[data-close]").onclick = close; modal.querySelector("form").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); store.update(draft => draft.resources.unshift({ id: uniqueId("link"), name: String(data.get("name")), url: String(data.get("url")), category: String(data.get("category")), type: "link", size: 0, createdAt: new Date().toISOString(), tags: String(data.get("tags") || "").split(/[,，]/).map(item => item.trim()).filter(Boolean) })); close(); initResources(); toast("教學連結已新增。"); }; }}); }

function initReports() {
  const state = store.get(); const attendance = getTodayAttendance(state); const attendanceRate = Object.values(attendance).filter(value => value !== "absent").length / state.students.length * 100; const classAvg = classAverage(state); const supportCount = state.observations.filter(item => item.level === "support").length;
  $("#report-stats").innerHTML = [statCard("今日到課率", `${attendanceRate.toFixed(0)}%`, "遲到列入到課、另行標記", "到"), statCard("班級加權平均", classAvg.toFixed(1), "已有成績學生", "均"), statCard("正向回饋事件", state.rewards.ledger.filter(item => item.value > 0).length, "完整流水帳可追溯", "＋"), statCard("需要支持紀錄", supportCount, "僅教師可見", "記")].join("");
  const averages = state.assessments.map(item => ({ ...item, average: assessmentAverage(item.id, state) }));
  $("#assessment-chart").setAttribute("aria-label", `各評量平均：${averages.map(item => `${item.name} ${item.average.toFixed(1)}分`).join("，")}`);
  $("#assessment-chart").innerHTML = averages.map(item => `<div class="chart-column"><span class="value" style="--bar-height:${item.average}%">${item.average.toFixed(0)}</span><i class="column" style="height:${item.average}%"></i><label>${esc(item.name)}</label></div>`).join("");
  const first = averages[0]?.average || 0, last = averages.at(-1)?.average || 0; $("#assessment-chart-summary").textContent = last >= first ? `從第一項到最近一項評量，班級平均上升 ${(last - first).toFixed(1)} 個百分點。` : `最近一項評量較第一項低 ${(first - last).toFixed(1)} 個百分點，建議檢視題型與學習難點。`;
  const categoryCounts = {}; state.rewards.ledger.filter(item => item.value > 0).forEach(item => categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1); const entries = Object.entries(categoryCounts).sort((a,b) => b[1]-a[1]); const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1; const colors = ["#176b52", "#c7e66a", "#f3b94e", "#5d9ecf", "#e87964"]; let cursor = 0; const stops = entries.map(([, count], index) => { const start = cursor; cursor += count / total * 100; return `${colors[index % colors.length]} ${start}% ${cursor}%`; }).join(","); $("#reward-chart").innerHTML = `<div class="donut" style="background:conic-gradient(${stops})"><strong>${total}</strong></div><div class="chart-legend">${entries.map(([name, count], index) => `<span><i style="background:${colors[index % colors.length]}"></i><b>${esc(name)}</b><strong>${Math.round(count / total * 100)}%</strong></span>`).join("")}</div>`;
  const pendingStudents = state.students.filter(student => state.assessments.some(item => state.scores[student.id]?.[item.id] == null)); const lowStudents = state.students.filter(student => (studentAverage(student.id, state) || 100) < 70); $("#teaching-insights").innerHTML = `<article class="insight-card"><strong>延續優勢</strong><p>「${esc(topCategory(state))}」是目前最常被看見的正向行為，可讓學生分享具體策略。</p></article><article class="insight-card warning"><strong>完成缺漏</strong><p>${pendingStudents.length} 位學生尚有成績缺漏，建議用短任務補齊證據。</p></article><article class="insight-card support"><strong>差異化支持</strong><p>${lowStudents.length || "目前沒有"} 位學生加權平均低於 70；先檢視單項概念，不以總分貼標籤。</p></article>`;
  $('[data-action="print-report"]').onclick = () => window.print();
  $('[data-action="create-doc-report"]').onclick = async () => { try { toast("正在建立 Google Docs 報告…"); const result = await createGoogleDocReport(); window.open(result.url, "_blank", "noopener"); toast("Google Docs 報告已建立。"); } catch (error) { toast(error.message, "error"); } };
}

function initSettings() {
  const state = store.get(); $("#apps-script-url").value = state.settings.appsScriptUrl || ""; $("#private-observations").checked = state.settings.privateObservations; $("#positive-only").checked = state.settings.positiveOnly; $("#confirm-delete").checked = state.settings.confirmDelete; updateGoogleStatus();
  $('[data-action="save-integration"]').onclick = async () => { const url = $("#apps-script-url").value.trim(); if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url)) return toast("網址格式不符，請貼上以 /exec 結尾的 Apps Script Web App 網址。", "error"); try { toast("正在測試 Google 連線…"); await pingGoogle(url); store.update(draft => { draft.settings.appsScriptUrl = url; }); updateGoogleStatus(); toast("Google 串接設定成功。"); } catch (error) { toast(`測試失敗：${error.message}`, "error"); } };
  $('[data-action="sync-now"]').onclick = async () => { try { toast("正在同步資料…"); await syncToGoogle(); updateGoogleStatus(); toast("資料已同步到 Google Sheets。"); } catch (error) { toast(error.message, "error"); } };
  $('[data-action="export-backup"]').onclick = () => { download(`自然課堂中控站備份-${dateKey()}.json`, JSON.stringify(store.get(), null, 2), "application/json"); toast("完整 JSON 備份已下載。"); };
  $("#backup-file").onchange = async event => { try { const next = JSON.parse(await event.target.files[0].text()); if (!confirm("還原會覆蓋目前的班級資料，是否繼續？")) return; store.replace(next); initSettings(); toast("備份已成功還原。"); } catch (error) { toast(error.message || "無法讀取備份。", "error"); } event.target.value = ""; };
  $('[data-action="reset-demo"]').onclick = () => { if (!confirm("確定重設為示範資料？目前所有本機班級紀錄會被覆蓋。")) return; store.reset(); initSettings(); toast("已重設示範資料。"); };
  [["#private-observations", "privateObservations"], ["#positive-only", "positiveOnly"], ["#confirm-delete", "confirmDelete"]].forEach(([selector, key]) => $(selector).onchange = event => store.update(draft => { draft.settings[key] = event.target.checked; }));
}

function updateGoogleStatus() { const state = store.get(), connected = Boolean(state.settings.appsScriptUrl); $("#google-status").textContent = connected ? "已設定" : "尚未連接"; $("#google-status").className = `status-pill ${connected ? "status-connected" : "status-local"}`; $("#last-sync").textContent = state.settings.lastSyncAt ? `最後成功同步：${formatDate(state.settings.lastSyncAt)}` : "尚無成功同步紀錄。"; }

function initPage() {
  if (page === "dashboard") initDashboard();
  else if (page === "students") initStudents();
  else if (page === "rewards") initRewards();
  else if (page === "grades") initGrades();
  else if (page === "tools") initTools();
  else if (page === "resources") initResources();
  else if (page === "reports") initReports();
  else if (page === "settings") initSettings();
}

initPage();
