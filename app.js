/* Flowboard: keyboard-first, offline task board with natural-language input. */
(() => {
  const { parse, compose, iso } = window.FlowParser;
  const STORE_KEY = "flowboard:v1";
  const THEME_KEY = "flowboard:theme";
  const COLUMNS = [
    { id: "todo", title: "To do", color: "var(--muted)" },
    { id: "doing", title: "In progress", color: "var(--accent)" },
    { id: "done", title: "Done", color: "var(--low)" },
  ];
  const PRIORITY = {
    high: { label: "High", color: "var(--high)" },
    med: { label: "Medium", color: "var(--med)" },
    low: { label: "Low", color: "var(--low)" },
  };
  const ICONS = {
    start: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    complete: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m5 12 5 5L20 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    reopen: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    delete: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  const NEXT = { todo: ["doing", "start", "Start task"], doing: ["done", "complete", "Mark as done"], done: ["todo", "reopen", "Reopen task"] };

  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  /* ---------- Data ---------- */
  function seed() {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return iso(x); };
    const t = (title, col, extra = {}) => ({ id: uid(), title, col, due: null, priority: null, tags: [], estimate: null, ...extra });
    return [
      t("Fix login redirect bug", "doing", { due: d(-1), priority: "high", tags: ["dev"], estimate: 30 }),
      t("Redesign settings page", "doing", { due: d(0), priority: "high", tags: ["design"], estimate: 240 }),
      t("Write onboarding email sequence", "todo", { due: d(2), priority: "high", tags: ["marketing"], estimate: 120 }),
      t("Plan Q4 roadmap", "todo", { due: d(6), priority: "med", tags: ["planning"], estimate: 180 }),
      t("Research competitor pricing", "todo", { due: d(4), tags: ["research"], estimate: 60 }),
      t("Book dentist appointment", "todo", { priority: "low" }),
      t("Set up CI pipeline", "done", { tags: ["dev"], estimate: 60 }),
      t("Summarise user interview notes", "done", { tags: ["research"], estimate: 45 }),
    ];
  }

  const isValid = (data) =>
    Array.isArray(data) &&
    data.every((t) => t && typeof t.id === "string" && typeof t.title === "string" && COLUMNS.some((c) => c.id === t.col) && Array.isArray(t.tags));

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY));
      return isValid(data) ? data : null;
    } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(tasks)); } catch { /* storage full or blocked: keep working in memory */ }
  }

  let tasks = load() || seed();
  let undoStack = [];
  let redoStack = [];
  const filters = { text: "", tag: null, priority: null };
  let selectedId = null;
  let editingId = null;

  function commit(mutate, { focus = false } = {}) {
    undoStack.push(JSON.stringify(tasks));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    mutate();
    save();
    render({ focus });
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(tasks));
    tasks = JSON.parse(undoStack.pop());
    save(); render(); toast("Undone");
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(tasks));
    tasks = JSON.parse(redoStack.pop());
    save(); render(); toast("Redone");
  }

  const byId = (id) => tasks.find((t) => t.id === id);

  // Move a task into a column, before another task (or to the end of that column)
  function moveTask(id, col, beforeId = null) {
    const task = byId(id);
    const rest = tasks.filter((t) => t.id !== id);
    task.col = col;
    let at;
    if (beforeId && beforeId !== id) {
      at = rest.findIndex((t) => t.id === beforeId);
    } else {
      const inCol = rest.filter((t) => t.col === col);
      at = inCol.length ? rest.indexOf(inCol[inCol.length - 1]) + 1 : rest.length;
    }
    rest.splice(at < 0 ? rest.length : at, 0, task);
    tasks = rest;
  }

  /* ---------- Formatting ---------- */
  function dueInfo(due, done) {
    if (!due) return null;
    const [y, m, d] = due.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((date - today) / 864e5);
    const short = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (done) return { text: short, cls: "" };
    if (diff < 0) return { text: `Overdue · ${short}`, cls: "overdue" };
    if (diff === 0) return { text: "Today", cls: "today" };
    if (diff === 1) return { text: "Tomorrow", cls: "" };
    if (diff < 7) return { text: date.toLocaleDateString(undefined, { weekday: "long" }), cls: "" };
    return { text: short, cls: "" };
  }
  const fmtMins = (m) => {
    if (!m) return "";
    const h = Math.floor(m / 60), r = m % 60;
    return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
  };

  function chip(text, cls = "", style = "") {
    const s = document.createElement("span");
    s.className = `chip ${cls}`.trim();
    if (style) s.setAttribute("style", style);
    s.textContent = text;
    return s;
  }

  /* ---------- Rendering ---------- */
  const matches = (t) => {
    if (filters.tag && !t.tags.includes(filters.tag)) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.text) {
      const q = filters.text.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !t.tags.some((g) => g.includes(q))) return false;
    }
    return true;
  };

  function cardEl(t) {
    const li = document.createElement("li");
    li.className = "card" + (t.col === "done" ? " done" : "") + (t.id === selectedId ? " selected" : "");
    li.tabIndex = 0;
    li.dataset.id = t.id;
    if (t.priority) li.style.setProperty("--p", PRIORITY[t.priority].color);

    if (t.id === editingId) {
      const input = document.createElement("input");
      input.className = "card-edit";
      input.value = compose(t);
      input.setAttribute("aria-label", "Edit task");
      li.appendChild(input);
      return li;
    }

    const title = document.createElement("p");
    title.className = "card-title";
    title.textContent = t.title;
    li.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const due = dueInfo(t.due, t.col === "done");
    if (due) meta.appendChild(chip(due.text, `chip-due ${due.cls}`));
    if (t.priority) meta.appendChild(chip(PRIORITY[t.priority].label, "chip-pri", `--p:${PRIORITY[t.priority].color}`));
    for (const tag of t.tags) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip chip-tag";
      b.dataset.tag = tag;
      b.textContent = `#${tag}`;
      b.title = `Show only #${tag}`;
      meta.appendChild(b);
    }
    if (t.estimate) meta.appendChild(chip(`~${fmtMins(t.estimate)}`));
    li.appendChild(meta);

    const [, icon, label] = NEXT[t.col];
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.innerHTML = `<button type="button" data-act="advance" aria-label="${label}" title="${label}">${ICONS[icon]}</button><button type="button" data-act="delete" aria-label="Delete task" title="Delete (Del)">${ICONS.delete}</button>`;
    li.appendChild(actions);

    const bits = [t.title, due?.text, t.priority && `${PRIORITY[t.priority].label} priority`, ...t.tags.map((g) => `tag ${g}`), t.estimate && `estimate ${fmtMins(t.estimate)}`];
    li.setAttribute("aria-label", bits.filter(Boolean).join(", "));
    return li;
  }

  function render({ focus = false } = {}) {
    const hadFocusInBoard = board.contains(document.activeElement);
    board.innerHTML = "";
    for (const col of COLUMNS) {
      const all = tasks.filter((t) => t.col === col.id);
      const visible = all.filter(matches);
      const section = document.createElement("section");
      section.className = "column";
      section.dataset.col = col.id;
      section.setAttribute("aria-labelledby", `h-${col.id}`);
      const total = all.reduce((s, t) => s + (t.estimate || 0), 0);
      section.innerHTML = `
        <div class="column-head">
          <span class="column-dot" style="--c:${col.color}"></span>
          <h2 id="h-${col.id}">${col.title}</h2>
          <span class="count">${visible.length === all.length ? all.length : `${visible.length} of ${all.length}`}</span>
          <span class="total">${total ? `~${fmtMins(total)}` : ""}</span>
        </div>`;
      const list = document.createElement("ul");
      list.className = "cards";
      visible.forEach((t) => list.appendChild(cardEl(t)));
      section.appendChild(list);
      if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "column-empty";
        empty.textContent = all.length ? "No tasks match your filters" : col.id === "done" ? "Finished tasks land here" : "Drag a task here";
        section.appendChild(empty);
      }
      board.appendChild(section);
    }

    const done = tasks.filter((t) => t.col === "done").length;
    $("progress-fill").style.width = tasks.length ? `${(done / tasks.length) * 100}%` : "0";
    $("progress-text").textContent = `${done} of ${tasks.length} done`;
    $("undo").disabled = !undoStack.length;
    $("redo").disabled = !redoStack.length;
    renderFilters();

    if (editingId) {
      const input = board.querySelector(".card-edit");
      if (input) { input.focus(); input.select(); }
    } else if (selectedId && (focus || hadFocusInBoard)) {
      const el = board.querySelector(`.card[data-id="${selectedId}"]`);
      if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    }
  }

  function renderFilters() {
    const box = $("filters");
    const active = [];
    if (filters.text) active.push([`"${filters.text}"`, () => { filters.text = ""; $("search").value = ""; }]);
    if (filters.tag) active.push([`#${filters.tag}`, () => (filters.tag = null)]);
    if (filters.priority) active.push([`${PRIORITY[filters.priority].label} priority`, () => (filters.priority = null)]);
    box.hidden = !active.length;
    box.innerHTML = "";
    if (!active.length) return;
    box.append("Showing");
    for (const [label, clear] of active) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = `${label} ×`;
      b.setAttribute("aria-label", `Remove filter ${label}`);
      b.addEventListener("click", () => { clear(); render(); });
      box.appendChild(b);
    }
    const clearAll = document.createElement("button");
    clearAll.type = "button";
    clearAll.className = "clear";
    clearAll.textContent = "Clear filters";
    clearAll.addEventListener("click", clearFilters);
    box.appendChild(clearAll);
  }

  const hasFilters = () => Boolean(filters.text || filters.tag || filters.priority);
  function clearFilters() {
    filters.text = ""; filters.tag = null; filters.priority = null;
    $("search").value = "";
    render();
  }

  /* ---------- Composer ---------- */
  const addInput = $("add-input");
  const preview = $("preview");
  const hintHTML = preview.innerHTML;

  function renderPreview() {
    const text = addInput.value.trim();
    if (!text) { preview.innerHTML = hintHTML; return; }
    const p = parse(text);
    preview.innerHTML = "";
    preview.appendChild(chip(p.title || "Add a title", "chip-title"));
    if (p.due) {
      const info = dueInfo(p.due, false);
      const [y, m, d] = p.due.split("-").map(Number);
      const full = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      const rel = ["Today", "Tomorrow"].includes(info.text) ? `${info.text.toLowerCase()}, ` : "";
      preview.appendChild(chip(`Due ${rel}${full}`, `chip-due ${info.cls}`));
    }
    if (p.priority) preview.appendChild(chip(`${PRIORITY[p.priority].label} priority`, "chip-pri", `--p:${PRIORITY[p.priority].color}`));
    p.tags.forEach((g) => preview.appendChild(chip(`#${g}`)));
    if (p.estimate) preview.appendChild(chip(`~${fmtMins(p.estimate)}`));
  }

  addInput.addEventListener("input", renderPreview);
  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const p = parse(addInput.value);
    if (!p.title) { addInput.focus(); return; }
    const task = { id: uid(), col: "todo", ...p };
    commit(() => { tasks.unshift(task); });
    addInput.value = "";
    renderPreview();
    if (hasFilters() && !matches(task)) toast("Task added. It's hidden by your filters.", "Clear filters", clearFilters);
  });

  /* ---------- Card actions ---------- */
  function deleteTask(id) {
    const t = byId(id);
    if (!t) return;
    const nextFocus = neighbour(id);
    commit(() => { tasks = tasks.filter((x) => x.id !== id); selectedId = nextFocus; }, { focus: true });
    toast(`Deleted "${t.title.length > 28 ? t.title.slice(0, 28) + "…" : t.title}"`, "Undo", undo);
  }

  function neighbour(id) {
    const cards = [...board.querySelectorAll(".card")];
    const i = cards.findIndex((c) => c.dataset.id === id);
    return (cards[i + 1] || cards[i - 1])?.dataset.id || null;
  }

  function advance(id) {
    const t = byId(id);
    const [to, , label] = NEXT[t.col];
    commit(() => moveTask(id, to), { focus: true });
    if (to === "done") toast("Nice work. Task completed.", "Undo", undo);
    else if (label === "Reopen task") toast("Task reopened");
  }

  function startEdit(id) { editingId = id; selectedId = id; render(); }
  function finishEdit(save) {
    const input = board.querySelector(".card-edit");
    const id = editingId;
    editingId = null;
    if (save && input) {
      const p = parse(input.value);
      if (p.title) {
        commit(() => Object.assign(byId(id), p), { focus: true });
        return;
      }
    }
    render({ focus: true });
  }

  board.addEventListener("click", (e) => {
    if (justDragged) return;
    const tagBtn = e.target.closest("[data-tag]");
    if (tagBtn) { filters.tag = tagBtn.dataset.tag; render(); return; }
    const act = e.target.closest("[data-act]");
    const card = e.target.closest(".card");
    if (!card) return;
    if (act?.dataset.act === "delete") return deleteTask(card.dataset.id);
    if (act?.dataset.act === "advance") return advance(card.dataset.id);
  });
  board.addEventListener("dblclick", (e) => {
    const card = e.target.closest(".card");
    if (card && !e.target.closest("button, input")) startEdit(card.dataset.id);
  });
  board.addEventListener("focusin", (e) => {
    const card = e.target.closest(".card");
    if (!card || card.dataset.id === selectedId) return;
    board.querySelectorAll(".card.selected").forEach((c) => c.classList.remove("selected"));
    selectedId = card.dataset.id;
    card.classList.add("selected");
  });
  board.addEventListener("keydown", (e) => {
    if (!e.target.classList.contains("card-edit")) return;
    if (e.key === "Enter") { e.preventDefault(); finishEdit(true); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishEdit(false); }
  });
  board.addEventListener("focusout", (e) => {
    if (e.target.classList.contains("card-edit") && editingId) finishEdit(true);
  });

  /* ---------- Keyboard navigation ---------- */
  function grid() {
    return COLUMNS.map((c) => [...board.querySelectorAll(`.column[data-col="${c.id}"] .card`)].map((el) => el.dataset.id));
  }
  function position(id) {
    const g = grid();
    for (let c = 0; c < g.length; c++) { const r = g[c].indexOf(id); if (r >= 0) return { g, c, r }; }
    return null;
  }
  function focusCard(id) {
    selectedId = id;
    const el = board.querySelector(`.card[data-id="${id}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function handleCardKeys(e, id) {
    const pos = position(id);
    if (!pos) return false;
    const { g, c, r } = pos;
    const colId = COLUMNS[c].id;

    if (e.shiftKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "ArrowUp" && r > 0) commit(() => moveTask(id, colId, g[c][r - 1]), { focus: true });
      if (e.key === "ArrowDown" && r < g[c].length - 1) commit(() => moveTask(id, colId, g[c][r + 2] || null), { focus: true });
      if (e.key === "ArrowLeft" && c > 0) commit(() => moveTask(id, COLUMNS[c - 1].id, g[c - 1][r] || null), { focus: true });
      if (e.key === "ArrowRight" && c < COLUMNS.length - 1) commit(() => moveTask(id, COLUMNS[c + 1].id, g[c + 1][r] || null), { focus: true });
      return true;
    }
    if (e.key === "ArrowUp" && r > 0) { e.preventDefault(); focusCard(g[c][r - 1]); return true; }
    if (e.key === "ArrowDown" && r < g[c].length - 1) { e.preventDefault(); focusCard(g[c][r + 1]); return true; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.key === "ArrowLeft" ? -1 : 1;
      for (let n = c + step; n >= 0 && n < g.length; n += step) {
        if (g[n].length) { focusCard(g[n][Math.min(r, g[n].length - 1)]); break; }
      }
      return true;
    }
    if (e.key === "Enter") { e.preventDefault(); startEdit(id); return true; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteTask(id); return true; }
    return false;
  }

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const typing = e.target.matches("input, textarea, [contenteditable]");
    const dialogOpen = $("palette").open || $("help").open;

    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (dialogOpen) return;
    if (!typing && mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (!typing && mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (e.key === "Escape") {
      if (typing) { if (e.target.id === "search" && filters.text) { filters.text = ""; e.target.value = ""; render(); } e.target.blur(); return; }
      if (hasFilters()) clearFilters();
      return;
    }
    if (typing || mod || e.altKey) return;

    const card = e.target.closest?.(".card");
    if (card && handleCardKeys(e, card.dataset.id)) return;

    if (e.key === "/") { e.preventDefault(); $("search").focus(); }
    else if (e.key.toLowerCase() === "n") { e.preventDefault(); addInput.focus(); }
    else if (e.key === "?") { e.preventDefault(); $("help").showModal(); }
    else if (!card && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "j", "k"].includes(e.key)) {
      const first = board.querySelector(`.card[data-id="${selectedId}"]`) || board.querySelector(".card");
      if (first) { e.preventDefault(); focusCard(first.dataset.id); }
    }
  });

  /* ---------- Search ---------- */
  $("search").addEventListener("input", (e) => { filters.text = e.target.value.trim(); render(); });
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);

  /* ---------- Drag and drop (pointer events: mouse, pen and touch) ---------- */
  let drag = null;
  let justDragged = false;

  board.addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".card");
    if (!card || editingId || e.button !== 0 || e.target.closest("button, input")) return;
    drag = { card, id: card.dataset.id, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType === "touch", last: e };
    if (drag.touch) {
      // Long-press to pick up on touch screens, so normal swipes still scroll
      drag.timer = setTimeout(() => drag && !drag.active && beginDrag(drag.last), 260);
    }
  });

  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.last = e;
    const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (!drag.active) {
      if (drag.touch) { if (dist > 10) cancelDrag(); }
      else if (dist > 5) beginDrag(e);
      return;
    }
    moveDrag(e);
  });
  document.addEventListener("pointerup", () => { if (drag?.active) endDrag(); else cancelDrag(); });
  document.addEventListener("pointercancel", () => { if (drag?.active) { drag.cancelled = true; endDrag(); } else cancelDrag(); });
  document.addEventListener("touchmove", (e) => { if (drag?.active) e.preventDefault(); }, { passive: false });

  function cancelDrag() { if (drag) clearTimeout(drag.timer); drag = null; }

  function beginDrag(e) {
    const { card } = drag;
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.classList.remove("selected");
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.dx = e.clientX - rect.left;
    drag.dy = e.clientY - rect.top;
    drag.origin = { col: card.closest(".column").dataset.col, next: card.nextElementSibling?.dataset.id || null };
    drag.active = true;
    card.classList.add("placeholder");
    document.body.classList.add("dragging");
    if (drag.touch) navigator.vibrate?.(12);
    moveDrag(e);
  }

  function moveDrag(e) {
    const { ghost, card } = drag;
    ghost.style.left = `${e.clientX - drag.dx}px`;
    ghost.style.top = `${e.clientY - drag.dy}px`;

    // Auto-scroll the board sideways on small screens
    const br = board.getBoundingClientRect();
    if (board.scrollWidth > board.clientWidth) {
      if (e.clientX < br.left + 40) board.scrollLeft -= 14;
      else if (e.clientX > br.right - 40) board.scrollLeft += 14;
    }

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const column = under?.closest(".column");
    board.querySelectorAll(".drop-target").forEach((c) => c !== column && c.classList.remove("drop-target"));
    if (!column) return;
    column.classList.add("drop-target");
    const list = column.querySelector(".cards");
    column.querySelector(".column-empty")?.setAttribute("hidden", "");
    const others = [...list.querySelectorAll(".card:not(.placeholder)")];
    const before = others.find((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (before) { if (card.nextElementSibling !== before) list.insertBefore(card, before); }
    else if (list.lastElementChild !== card) list.appendChild(card);
  }

  function endDrag() {
    const { card, ghost, id, origin, cancelled } = drag;
    clearTimeout(drag.timer);
    ghost.remove();
    card.classList.remove("placeholder");
    document.body.classList.remove("dragging");
    board.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target"));
    drag = null;
    justDragged = true;
    setTimeout(() => (justDragged = false), 50);

    const col = card.closest(".column").dataset.col;
    const next = card.nextElementSibling?.dataset.id || null;
    if (cancelled || (col === origin.col && next === origin.next)) { render(); return; }
    selectedId = id;
    const wasDone = byId(id).col === "done";
    commit(() => moveTask(id, col, next));
    if (col === "done" && !wasDone) toast("Nice work. Task completed.", "Undo", undo);
  }

  /* ---------- Command palette ---------- */
  const palette = $("palette");
  const pInput = $("palette-input");
  const pList = $("palette-list");
  let pItems = [];
  let pIndex = 0;

  function effectiveTheme() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function commandList() {
    const tags = [...new Set(tasks.flatMap((t) => t.tags))].sort();
    const list = [
      { label: "New task", group: "Tasks", run: () => addInput.focus() },
      { label: "Search tasks", group: "Tasks", run: () => $("search").focus() },
      ...Object.entries(PRIORITY).map(([k, p]) => ({ label: `Show ${p.label.toLowerCase()} priority only`, group: "Filter", run: () => { filters.priority = k; render(); } })),
      ...tags.map((g) => ({ label: `Show #${g} only`, group: "Filter", run: () => { filters.tag = g; render(); } })),
      { label: "Clear completed tasks", group: "Board", run: clearDone },
      { label: "Export board as JSON", group: "Board", run: exportBoard },
      { label: "Import board from JSON", group: "Board", run: () => $("import-file").click() },
      { label: "Reset to sample tasks", group: "Board", run: () => { commit(() => { tasks = seed(); }); toast("Sample tasks restored", "Undo", undo); } },
      { label: effectiveTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme", group: "View", run: toggleTheme },
      { label: "Keyboard shortcuts", group: "Help", run: () => $("help").showModal() },
    ];
    if (hasFilters()) list.unshift({ label: "Clear filters", group: "Filter", run: clearFilters });
    if (undoStack.length) list.push({ label: "Undo", group: "Edit", run: undo });
    if (redoStack.length) list.push({ label: "Redo", group: "Edit", run: redo });
    return list;
  }

  // Fuzzy match: exact substrings rank highest, then in-order letters ("clrcomp" finds "Clear completed tasks")
  function fuzzyScore(query, text) {
    const q = query.toLowerCase().replace(/\s+/g, "");
    const t = text.toLowerCase();
    if (!q) return 1;
    if (t.includes(query.toLowerCase().trim())) return 100 - t.indexOf(query.toLowerCase().trim());
    let ti = 0, score = 0, streak = 0;
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return 0;
      streak = found === ti ? streak + 1 : 0;
      score += 1 + streak;
      ti = found + 1;
    }
    return score;
  }

  function renderPalette() {
    const q = pInput.value.trim();
    const cmds = commandList().map((c) => ({ ...c, score: fuzzyScore(q, c.label) })).filter((c) => c.score > 0);
    const taskHits = q
      ? tasks.map((t) => ({ label: t.title, group: COLUMNS.find((c) => c.id === t.col).title, score: fuzzyScore(q, t.title) - 0.5, run: () => goToTask(t.id) })).filter((c) => c.score > 0.5)
      : [];
    pItems = [...cmds, ...taskHits].sort((a, b) => b.score - a.score).slice(0, 12);
    if (!q) pItems = commandList();
    pIndex = Math.min(pIndex, Math.max(pItems.length - 1, 0));
    pList.innerHTML = "";
    if (!pItems.length) {
      pList.innerHTML = `<li class="empty">No commands or tasks match "${q.replace(/[<>&"]/g, "")}"</li>`;
      return;
    }
    pItems.forEach((item, i) => {
      const li = document.createElement("li");
      li.id = `pal-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === pIndex));
      li.innerHTML = `<span></span><span class="group"></span>`;
      li.firstChild.textContent = item.label;
      li.lastChild.textContent = item.group;
      li.addEventListener("click", () => runPalette(i));
      li.addEventListener("mousemove", () => { if (pIndex !== i) { pIndex = i; highlight(); } });
      pList.appendChild(li);
    });
    pInput.setAttribute("aria-activedescendant", `pal-${pIndex}`);
  }
  function highlight() {
    pList.querySelectorAll("[role=option]").forEach((li, i) => li.setAttribute("aria-selected", String(i === pIndex)));
    pInput.setAttribute("aria-activedescendant", `pal-${pIndex}`);
    pList.children[pIndex]?.scrollIntoView({ block: "nearest" });
  }
  function openPalette() {
    if (palette.open) return;
    if ($("help").open) $("help").close();
    pInput.value = "";
    pIndex = 0;
    renderPalette();
    palette.showModal();
    pInput.focus();
  }
  function runPalette(i) {
    const item = pItems[i];
    palette.close();
    item?.run();
  }
  pInput.addEventListener("input", () => { pIndex = 0; renderPalette(); });
  pInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); pIndex = (pIndex + 1) % pItems.length; highlight(); }
    if (e.key === "ArrowUp") { e.preventDefault(); pIndex = (pIndex - 1 + pItems.length) % pItems.length; highlight(); }
    if (e.key === "Enter") { e.preventDefault(); runPalette(pIndex); }
  });
  palette.addEventListener("click", (e) => { if (e.target === palette) palette.close(); });
  $("open-palette").addEventListener("click", openPalette);

  function goToTask(id) {
    if (!matches(byId(id))) { filters.text = ""; filters.tag = null; filters.priority = null; $("search").value = ""; }
    selectedId = id;
    render({ focus: true });
  }

  function clearDone() {
    const n = tasks.filter((t) => t.col === "done").length;
    if (!n) { toast("No completed tasks to clear"); return; }
    commit(() => { tasks = tasks.filter((t) => t.col !== "done"); });
    toast(`Cleared ${n} completed ${n === 1 ? "task" : "tasks"}`, "Undo", undo);
  }

  function exportBoard() {
    const blob = new Blob([JSON.stringify({ app: "flowboard", version: 1, exported: new Date().toISOString(), tasks }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `flowboard-${iso(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Board exported");
  }

  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const imported = Array.isArray(data) ? data : data.tasks;
      if (!isValid(imported)) throw new Error("invalid");
      commit(() => { tasks = imported; });
      toast(`Imported ${imported.length} tasks`, "Undo", undo);
    } catch {
      toast("That file isn't a Flowboard export. Choose a .json file exported from Flowboard.");
    }
  });

  function toggleTheme() {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }
  try { const saved = localStorage.getItem(THEME_KEY); if (saved) document.documentElement.dataset.theme = saved; } catch {}

  /* ---------- Toast ---------- */
  function toast(msg, actionLabel, onAction) {
    const el = $("toast");
    const btn = $("toast-action");
    $("toast-msg").textContent = msg;
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || "";
    btn.onclick = () => { el.classList.remove("show"); onAction?.(); };
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), actionLabel ? 5000 : 2200);
  }

  /* ---------- Offline support ---------- */
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  render();
})();
