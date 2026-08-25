import { store, activeClass } from "./store.js";

const icons = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  classroom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 4h18v16H3z"/><path d="M8 8h3v3H8zM14 8h3v3h-3zM8 14h3v3H8zM14 14h3v3h-3z"/></svg>',
  students: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3.2 2.4-5.5 5.5-5.5s5.5 2.3 5.5 5.5"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 15.2c3.5-.8 5.5 1.2 5.5 4.8"/></svg>',
  rewards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.9L12 3Z"/></svg>',
  grades: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>',
  tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m14.7 6.3 3-3a5 5 0 0 1-6.4 6.4l-7 7a2.1 2.1 0 1 0 3 3l7-7a5 5 0 0 0 6.4-6.4l-3 3-3-1 0-3Z"/></svg>',
  resources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6.5h6l2 2h10v11H3z"/><path d="M3 6.5V4h7l2 2.5"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>'
};

const pages = [
  ["dashboard", "今日課堂", "index.html"], ["classroom", "教室座位圖", "classroom.html"], ["students", "學生與班級", "students.html"],
  ["rewards", "正向獎勵", "rewards.html"], ["grades", "成績與評量", "grades.html"],
  ["tools", "課堂工具", "tools.html"], ["resources", "教學資料庫", "resources.html"],
  ["reports", "統計報表", "reports.html"], ["settings", "串接與設定", "settings.html"]
];

export function renderChrome() {
  const page = document.body.dataset.page;
  const current = pages.find(([id]) => id === page) || pages[0];
  const state = store.get();
  const currentClass = activeClass(state);
  const appShell = document.querySelector("#app-shell");
  appShell.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="index.html"><span class="brand-mark">N</span><span class="brand-copy"><strong>自然課堂中控站</strong><small>NATURE HUB</small></span></a>
      <p class="nav-label">教學工作台</p>
      <nav class="main-nav" aria-label="主要導覽">
        ${pages.slice(0, 8).map(([id, label, href]) => `<a class="nav-link ${page === id ? "active" : ""}" href="${href}">${icons[id]}<span>${label}</span></a>`).join("")}
      </nav>
      <div class="sidebar-foot">
        <a class="nav-link ${page === "settings" ? "active" : ""}" href="settings.html">${icons.settings}<span>串接與設定</span></a>
        <label class="class-switcher"><span class="class-avatar">${currentClass.code}</span><span><small>目前班級</small><select data-action="class-switcher" aria-label="切換班級">${state.classes.map(item => `<option value="${item.id}" ${item.id === state.activeClassId ? "selected" : ""}>${item.name}</option>`).join("")}</select></span></label>
      </div>
    </aside>
    <header class="topbar">
      <div class="top-actions"><button class="mobile-menu" type="button" aria-label="開啟選單" data-action="mobile-menu">☰</button><span class="breadcrumb">${currentClass.name} / ${current[1]}</span></div>
      <div class="top-actions"><span class="sync-indicator ${state.settings.appsScriptUrl ? "connected" : ""}">${state.settings.appsScriptUrl ? "Google 已設定" : "資料儲存在本機"}</span><a class="top-icon" href="settings.html" aria-label="設定">${icons.settings}</a></div>
    </header>`;

  appShell.querySelector('[data-action="mobile-menu"]')?.addEventListener("click", () => {
    const sidebar = document.querySelector("#sidebar");
    const open = sidebar.classList.toggle("open");
    appShell.querySelector('[data-action="mobile-menu"]').setAttribute("aria-expanded", String(open));
  });
  appShell.querySelector('[data-action="class-switcher"]')?.addEventListener("change", event => {
    store.update(draft => { draft.activeClassId = event.target.value; });
    window.location.reload();
  });
  document.addEventListener("click", event => {
    if (window.innerWidth <= 820 && !event.target.closest("#sidebar") && !event.target.closest('[data-action="mobile-menu"]')) {
      document.querySelector("#sidebar")?.classList.remove("open");
    }
  });
}
