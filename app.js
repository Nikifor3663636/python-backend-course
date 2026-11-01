/* Python Backend с нуля — сайт и Android-приложение.
   Логика повторяет learn.py / timer.py: теория (+10 XP) → тест ≥70 % (+20 XP) → задача (+40 XP),
   урок засчитан (+50 XP). Норма — 3 часа в день, напоминание о перерыве каждые 50 минут. */
"use strict";

const DAILY_GOAL = 3 * 60 * 60;
const BREAK_EVERY = 50 * 60;
const RUN_TIMEOUT = 15;
const XP = { theory: 10, quiz: 20, task: 40, completed: 50 };
const IN_APP = /PyBackendApp/.test(navigator.userAgent);

const COURSE = window.COURSE;
const LESSONS = COURSE.modules.flatMap((m, mi) => m.lessons.map((l) => ({ ...l, module: m.title, moduleIndex: mi })));
const byId = Object.fromEntries(LESSONS.map((l) => [l.id, l]));

// ---------- хранилище ----------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("pbc." + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("pbc." + key, JSON.stringify(value)); } catch { /* приватный режим */ }
  },
  del(key) { try { localStorage.removeItem("pbc." + key); } catch { /* ignore */ } },
};

const today = () => dayKey(new Date());
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const nowIso = () => new Date().toISOString().slice(0, 19);

const progress = {
  data: store.get("progress", { lessons: {}, xp: 0 }),
  save() { store.set("progress", this.data); updateTop(); },
  state(id) { return this.data.lessons[id] || {}; },
  mark(id, step) {
    const st = (this.data.lessons[id] ||= {});
    if (!st[step]) {
      st[step] = nowIso();
      this.data.xp = (this.data.xp || 0) + (XP[step] || 0);
    }
    this.save();
    return maybeComplete(byId[id]);
  },
  reset(id) { delete this.data.lessons[id]; this.recalcXp(); this.save(); },
  recalcXp() {
    this.data.xp = Object.values(this.data.lessons)
      .reduce((sum, st) => sum + Object.keys(XP).reduce((s, k) => s + (st[k] ? XP[k] : 0), 0), 0);
  },
};

const timeLog = {
  data: store.get("time_log", {}),
  add(sec) {
    const k = today();
    this.data[k] = Math.round(((this.data[k] || 0) + sec) * 10) / 10;
  },
  save() { store.set("time_log", this.data); },
  today() { return this.data[today()] || 0; },
  streak() {
    const d = new Date();
    if ((this.data[dayKey(d)] || 0) < DAILY_GOAL) d.setDate(d.getDate() - 1);
    let n = 0;
    while ((this.data[dayKey(d)] || 0) >= DAILY_GOAL) { n++; d.setDate(d.getDate() - 1); }
    return n;
  },
};

function fmt(sec) {
  sec = Math.floor(sec);
  return `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
function fmtShort(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

// ---------- урок: шаги и завершение ----------
const needSteps = (l) => ["theory", ...(l.quiz.length ? ["quiz"] : []), ...(l.tests ? ["task"] : [])];
const isDone = (l) => !!progress.state(l.id).completed;
const nextLesson = () => LESSONS.find((l) => !isDone(l));

function maybeComplete(lesson) {
  const st = progress.state(lesson.id);
  if (st.completed) return false;
  if (needSteps(lesson).every((s) => st[s])) {
    st.completed = nowIso();
    progress.data.xp += XP.completed;
    progress.save();
    const nxt = nextLesson();
    showDialog(`
      <div class="big-emoji">🎉</div>
      <h3>Урок ${lesson.id} пройден! +50 XP</h3>
      <p class="muted">«${esc(lesson.title)}»</p>
      ${nxt ? `<p>Следующий: <b>${nxt.id} ${esc(nxt.title)}</b></p>` : "<p>Это был последний урок — курс пройден!</p>"}
      <div class="row">
        <button class="btn ghost" data-close>Остаться</button><span class="spacer"></span>
        ${nxt ? `<a class="btn primary" href="#/l/${nxt.id}/theory" data-close>Дальше →</a>` : ""}
      </div>`);
    return true;
  }
  return false;
}

// ---------- утилиты UI ----------
const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
function showDialog(html) {
  const dlg = $("#dialog");
  $("#dialog-body").innerHTML = html;
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  if (!dlg.open) dlg.showModal();
  return dlg;
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch { /* ignore */ } }

// ---------- подсветка Python ----------
const KW = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(" "));
const BI = new Set("print input len range int str float bool list dict set tuple open isinstance enumerate zip map filter sorted sum min max abs round type super self cls object Exception ValueError TypeError KeyError IndexError AttributeError RuntimeError StopIteration NotImplementedError property staticmethod classmethod any all iter next repr hash id dir vars getattr setattr hasattr callable".split(" "));
const TOKEN_RE = /("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|[rbfRBF]{0,2}"(?:\\.|[^"\\\n])*"?|[rbfRBF]{0,2}'(?:\\.|[^'\\\n])*'?)|(#[^\n]*)|(@[A-Za-z_][\w.]*)|\b(\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?)\b|([A-Za-z_]\w*)/g;
function highlight(code) {
  let out = "", last = 0, prev = "";
  code.replace(TOKEN_RE, (m, str, com, dec, num, word, idx) => {
    out += esc(code.slice(last, idx));
    let cls = "";
    if (str) cls = "str";
    else if (com) cls = "com";
    else if (dec) cls = "dec";
    else if (num) cls = "num";
    else if (KW.has(word)) cls = "kw";
    else if (prev === "def" || prev === "class") cls = "fn";
    else if (BI.has(word)) cls = "bi";
    out += cls ? `<span class="tok-${cls}">${esc(m)}</span>` : esc(m);
    if (word) prev = word;
    last = idx + m.length;
    return m;
  });
  return out + esc(code.slice(last));
}

function renderMd(md) {
  const html = marked.parse(md, { gfm: true });
  const div = document.createElement("div");
  div.className = "md";
  div.innerHTML = html;
  div.querySelectorAll("pre code").forEach((c) => {
    const lang = (c.className.match(/language-(\w+)/) || [])[1];
    if (!lang || lang === "python" || lang === "py") c.innerHTML = highlight(c.textContent);
  });
  div.querySelectorAll("table").forEach((t) => {
    const w = document.createElement("div");
    w.className = "table-wrap";
    t.replaceWith(w);
    w.appendChild(t);
  });
  div.querySelectorAll("a[href^='http']").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  return div;
}

// ---------- Python в Web Worker ----------
const Py = {
  worker: null, seq: 0, pending: new Map(), sources: null,
  async load() {
    if (!this.sources) {
      const [shim, worker] = await Promise.all(["py/shim.py", "worker.js"].map((u) => fetch(u).then((r) => {
        if (!r.ok) throw new Error(u);
        return r.text();
      })));
      this.sources = { shim, worker };
    }
    if (!this.worker) {
      const url = URL.createObjectURL(new Blob([this.sources.worker], { type: "text/javascript" }));
      this.worker = new Worker(url);
      this.worker.onmessage = (e) => this.onMessage(e.data);
      this.worker.onerror = (e) => this.fail(`Ошибка воркера: ${e.message || "неизвестная"}`);
    }
  },
  onMessage(msg) {
    const job = this.pending.get(msg.id);
    if (!job) return;
    if (msg.phase === "progress") job.onProgress?.(msg.text);
    if (msg.phase === "running") {
      job.onProgress?.("Выполняю…");
      job.timer = setTimeout(() => {
        this.restart();
        job.resolve({ error: `Решение работает дольше ${RUN_TIMEOUT} с — возможно, бесконечный цикл или лишний input().` });
      }, RUN_TIMEOUT * 1000);
    }
    if (msg.phase === "done") {
      clearTimeout(job.timer);
      this.pending.delete(msg.id);
      if (msg.result?.boot) {
        msg.result.error = "Не удалось загрузить Python. Для первого запуска нужен интернет.\n\n" + msg.result.error;
        this.restart();
      }
      job.resolve(msg.result);
    }
  },
  fail(text) {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.resolve({ error: text }); }
    this.pending.clear();
    this.restart();
  },
  restart() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    for (const job of this.pending.values()) clearTimeout(job.timer);
    this.pending.clear();
  },
  async run(kind, files, { stdin = "", onProgress } = {}) {
    try { await this.load(); } catch (e) {
      return { error: "Не удалось загрузить файлы движка. Открой курс через веб-сервер или приложение, а не как файл." };
    }
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, onProgress });
      this.worker.postMessage({ id, kind, shim: this.sources.shim, files, stdin });
    });
  },
  warm() {
    if (this.worker || this.warming) return;
    this.warming = true;
    this.run("program", { "solution.py": "" }).finally(() => { this.warming = false; });
  },
};

// ---------- таймер ----------
const timer = {
  running: store.get("timer_running", false),
  sinceBreak: 0,
  last: Date.now(),
  goalShown: store.get("goal_shown", ""),
  toggle(force) {
    this.running = force ?? !this.running;
    this.last = Date.now();
    store.set("timer_running", this.running);
    timeLog.save();
    updateTop();
    toast(this.running ? "Таймер запущен" : "Таймер на паузе");
  },
  tick() {
    const now = Date.now();
    const delta = (now - this.last) / 1000;
    this.last = now;
    if (!this.running || document.visibilityState !== "visible" || delta <= 0 || delta > 5) return;
    const before = timeLog.today();
    timeLog.add(delta);
    this.sinceBreak += delta;
    if (Math.floor(timeLog.today() / 10) !== Math.floor(before / 10)) timeLog.save();
    if (before < DAILY_GOAL && timeLog.today() >= DAILY_GOAL && this.goalShown !== today()) {
      this.goalShown = today();
      store.set("goal_shown", this.goalShown);
      vibrate([200, 100, 200]);
      showDialog(`<div class="big-emoji">🏆</div><h3>Норма выполнена!</h3>
        <p>3 часа на сегодня есть — день идёт в серию (сейчас ${timeLog.streak()} дн.). Можно продолжать или отдыхать.</p>
        <button class="btn primary block" data-close>Отлично</button>`);
    }
    if (this.sinceBreak >= BREAK_EVERY) {
      this.sinceBreak = 0;
      this.running = false;
      store.set("timer_running", false);
      timeLog.save();
      vibrate([300, 150, 300]);
      showDialog(`<div class="big-emoji">☕</div><h3>Перерыв 10 минут</h3>
        <p>50 минут подряд — встань, разомнись, посмотри вдаль. Таймер на паузе.</p>
        <button class="btn primary block" data-close data-resume>Продолжить учёбу</button>`)
        .querySelector("[data-resume]").addEventListener("click", () => timer.toggle(true));
    }
    updateTop();
  },
};

function updateTop() {
  $("#xp-chip").textContent = `${progress.data.xp || 0} XP`;
  $("#streak-chip").textContent = `🔥 ${timeLog.streak()}`;
  $("#timer-text").textContent = fmt(timeLog.today());
  $("#timer-btn").classList.toggle("running", timer.running);
  $("#timer-btn").setAttribute("aria-label", timer.running ? "Поставить таймер на паузу" : "Запустить таймер");
  const bar = $("#today-bar");
  if (bar) {
    const pct = Math.min(timeLog.today() / DAILY_GOAL, 1);
    bar.style.width = `${pct * 100}%`;
    bar.parentElement.classList.toggle("ok", pct >= 1);
    $("#today-text").textContent = `${fmt(timeLog.today())} / 3:00:00`;
  }
}

// ---------- экраны ----------
function statusIcon(l) {
  const st = progress.state(l.id);
  if (st.completed) return `<span class="status done" aria-label="пройден">✓</span>`;
  if (Object.keys(st).length) return `<span class="status part" aria-label="начат"></span>`;
  return `<span class="status" aria-label="не начат"></span>`;
}

function viewHome() {
  const done = LESSONS.filter(isDone).length;
  const nxt = nextLesson();
  const openModule = nxt ? nxt.moduleIndex : -1;
  app.innerHTML = `
    <section class="card hero">
      <h1>Python Backend с нуля</h1>
      <div class="muted small">Пройдено ${done} из ${LESSONS.length} уроков · ${progress.data.xp || 0} XP</div>
      <div class="progress" style="margin-top:10px"><i style="width:${(done / LESSONS.length) * 100}%"></i></div>
      <div class="today">
        <div class="today-line"><span>Сегодня</span><span id="today-text"></span></div>
        <div class="progress"><i id="today-bar"></i></div>
        <button class="btn ${timer.running ? "" : "primary"}" id="home-timer">${timer.running ? "⏸ Пауза" : "▶ Начать учёбу (таймер)"}</button>
      </div>
    </section>
    ${nxt ? `
    <a class="card continue" href="#/l/${nxt.id}/${firstOpenStep(nxt)}">
      <span class="module-num badge">▶</span>
      <span style="flex:1;min-width:0">
        <span class="muted small">Продолжить · ${esc(nxt.module)}</span><br>
        <span class="continue-title">${nxt.id} ${esc(nxt.title)}</span>
      </span>
      <span class="chev">›</span>
    </a>` : `<div class="card"><h2>Курс пройден! 🎉</h2><p class="muted">Время для собственного проекта.</p></div>`}
    ${COURSE.modules.map((m, i) => {
      const ls = LESSONS.filter((l) => l.moduleIndex === i);
      const d = ls.filter(isDone).length;
      return `
      <details class="card module ${d === ls.length ? "done" : ""}" ${i === openModule ? "open" : ""}>
        <summary>
          <span class="module-num">${d === ls.length ? "✓" : i + 1}</span>
          <span class="module-info"><span class="module-title">${esc(m.title)}</span><br>
            <span class="module-meta">${d} / ${ls.length} уроков</span></span>
          <span class="chev">›</span>
        </summary>
        <ul class="lessons">
          ${ls.map((l) => `<li><a href="#/l/${l.id}/theory">
            <span class="lesson-id">${l.id}</span><span class="lesson-title">${esc(l.title)}</span>${statusIcon(l)}</a></li>`).join("")}
        </ul>
      </details>`;
    }).join("")}
    <p class="muted small" style="text-align:center">Прогресс хранится на этом устройстве. Перенос с ПК и обратно — в «Статистике».</p>`;
  $("#home-timer").addEventListener("click", () => { timer.toggle(); viewHome(); });
  updateTop();
}

function firstOpenStep(l) {
  const st = progress.state(l.id);
  if (!st.theory) return "theory";
  if (l.quiz.length && !st.quiz) return "quiz";
  if (l.tests && !st.task) return "task";
  return "theory";
}

function lessonShell(lesson, tab) {
  const st = progress.state(lesson.id);
  const tabs = [["theory", "Теория"]];
  if (lesson.quiz.length) tabs.push(["quiz", "Тест"]);
  if (lesson.task || lesson.tests) tabs.push(["task", "Практика"]);
  const idx = LESSONS.indexOf(lesson);
  const prev = LESSONS[idx - 1], next = LESSONS[idx + 1];
  app.innerHTML = `
    <div class="lesson-head">
      <div class="crumb">${esc(lesson.module)} · урок ${lesson.id} ${st.completed ? "· <b style='color:var(--ok)'>пройден ✓</b>" : ""}</div>
      <h1>${esc(lesson.title)}</h1>
    </div>
    <nav class="tabs">${tabs.map(([k, t]) => `<a href="#/l/${lesson.id}/${k}" class="${k === tab ? "active" : ""}">${t}${st[k] ? ' <span class="tick">✓</span>' : ""}</a>`).join("")}</nav>
    <div id="pane"></div>
    <div class="row" style="margin-top:18px">
      ${prev ? `<a class="btn ghost small" href="#/l/${prev.id}/theory">← ${prev.id}</a>` : ""}
      <span class="spacer"></span>
      ${next ? `<a class="btn ghost small" href="#/l/${next.id}/theory">${next.id} →</a>` : ""}
    </div>`;
  return $("#pane");
}

function viewTheory(lesson) {
  const pane = lessonShell(lesson, "theory");
  const card = document.createElement("article");
  card.className = "card";
  card.appendChild(renderMd(lesson.theory || "*В этом уроке нет теории.*"));
  pane.appendChild(card);
  const nextTab = lesson.quiz.length ? "quiz" : (lesson.tests ? "task" : null);
  const wasRead = progress.state(lesson.id).theory;
  progress.mark(lesson.id, "theory");
  if (!wasRead) toast("Теория прочитана: +10 XP");
  if (nextTab) {
    pane.insertAdjacentHTML("beforeend",
      `<a class="btn primary block" href="#/l/${lesson.id}/${nextTab}">${nextTab === "quiz" ? "Прочитал — к тесту →" : "Прочитал — к задаче →"}</a>`);
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function viewQuiz(lesson) {
  const pane = lessonShell(lesson, "quiz");
  const qs = lesson.quiz;
  const need = Math.max(1, Math.round(qs.length * 0.7));
  const marks = [];
  let i = 0, correct = 0;

  function dots() {
    return `<div class="dots">${qs.map((_, k) => `<i class="${marks[k] === true ? "ok" : marks[k] === false ? "bad" : k === i ? "cur" : ""}"></i>`).join("")}</div>`;
  }
  function question() {
    const q = qs[i];
    const opts = shuffle(q.options.map((text, idx) => ({ text, idx })));
    pane.innerHTML = `
      <div class="card">
        ${dots()}
        <div class="q-num">Вопрос ${i + 1} из ${qs.length}</div>
        <div class="q-text">${esc(q.q)}</div>
        ${q.code ? `<pre class="code">${highlight(q.code)}</pre>` : ""}
        <div class="options">${opts.map((o) => `<button class="option" data-idx="${o.idx}">${esc(o.text)}</button>`).join("")}</div>
        <div id="fb"></div>
      </div>`;
    pane.querySelectorAll(".option").forEach((btn) => btn.addEventListener("click", () => {
      const chosen = Number(btn.dataset.idx);
      const ok = chosen === q.answer;
      marks[i] = ok;
      if (ok) correct++;
      vibrate(ok ? 30 : [60, 40, 60]);
      pane.querySelectorAll(".option").forEach((b) => {
        b.disabled = true;
        if (Number(b.dataset.idx) === q.answer) b.classList.add("right");
      });
      if (!ok) btn.classList.add("wrong");
      $("#fb", pane).innerHTML = `
        <div class="feedback ${ok ? "ok" : "bad"}">${ok ? "<b>Верно!</b>" : `<b>Неверно.</b> Правильно: <code>${esc(q.options[q.answer])}</code>`}
          ${q.explain ? `<div style="margin-top:4px">${esc(q.explain)}</div>` : ""}</div>
        <button class="btn primary block" style="margin-top:10px" id="nextq">${i + 1 < qs.length ? "Следующий вопрос →" : "Результат"}</button>`;
      $("#nextq", pane).addEventListener("click", () => { i++; i < qs.length ? question() : result(); });
      $("#nextq", pane).focus();
    }));
  }
  function result() {
    const passed = correct >= need;
    let completedNow = false;
    if (passed) {
      const first = !progress.state(lesson.id).quiz;
      completedNow = progress.mark(lesson.id, "quiz");
      if (first) toast("Тест пройден: +20 XP");
    }
    pane.innerHTML = `
      <div class="card" style="text-align:center">
        ${dots()}
        <div class="big-emoji">${passed ? "✅" : "📖"}</div>
        <h2>${correct} из ${qs.length}</h2>
        <p class="muted">${passed ? "Тест пройден!" : `Нужно минимум ${need}. Перечитай теорию и попробуй снова.`}</p>
        <div class="row" style="justify-content:center">
          <button class="btn" id="again">Пройти заново</button>
          ${passed && lesson.tests ? `<a class="btn primary" href="#/l/${lesson.id}/task">К задаче →</a>` : ""}
          ${!passed ? `<a class="btn primary" href="#/l/${lesson.id}/theory">К теории</a>` : ""}
        </div>
      </div>`;
    $("#again", pane).addEventListener("click", () => { i = 0; correct = 0; marks.length = 0; question(); });
    if (completedNow) lessonShellTicks(lesson);
  }
  question();
}

function lessonShellTicks(lesson) {
  const st = progress.state(lesson.id);
  document.querySelectorAll(".tabs a").forEach((a) => {
    const k = a.getAttribute("href").split("/").pop();
    if (st[k] && !a.querySelector(".tick")) a.insertAdjacentHTML("beforeend", ' <span class="tick">✓</span>');
  });
}

// ---------- редактор кода ----------
function makeEditor(host, initial, onChange) {
  host.innerHTML = `
    <div class="editor">
      <div class="gutter" aria-hidden="true"></div>
      <pre aria-hidden="true"><code></code></pre>
      <textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"
        aria-label="Код решения (solution.py)" wrap="off"></textarea>
    </div>
    <div class="keybar" role="toolbar" aria-label="Символы">
      ${["⇥", "⇤", ":", "(", ")", "[", "]", "{", "}", '"', "'", "=", "_", ".", ",", "#", "+", "-", "*", "/", "<", ">", "!", "%", "\\", "f\"\"", "↶"]
        .map((k) => `<button type="button" data-key="${esc(k)}" aria-label="${esc(k === "⇥" ? "Отступ" : k === "⇤" ? "Убрать отступ" : k === "↶" ? "Отменить" : k)}">${esc(k)}</button>`).join("")}
    </div>`;
  const ta = $("textarea", host), code = $("pre code", host), pre = $("pre", host), gutter = $(".gutter", host);
  ta.value = initial;
  const history = [initial];

  function paint() {
    code.innerHTML = highlight(ta.value) + "\n";
    const lines = ta.value.split("\n").length;
    gutter.textContent = Array.from({ length: lines }, (_, k) => k + 1).join("\n");
    sync();
  }
  function sync() {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }
  let histTimer;
  function changed() {
    paint();
    onChange(ta.value);
    clearTimeout(histTimer);
    histTimer = setTimeout(() => { if (history[history.length - 1] !== ta.value) history.push(ta.value); if (history.length > 200) history.shift(); }, 400);
  }
  function insert(text, caretBack = 0) {
    const { selectionStart: s, selectionEnd: e } = ta;
    ta.setRangeText(text, s, e, "end");
    if (caretBack) ta.selectionStart = ta.selectionEnd = ta.selectionEnd - caretBack;
    changed();
  }
  function lineStart(pos) { return ta.value.lastIndexOf("\n", pos - 1) + 1; }
  function indent(dir) {
    const s = lineStart(ta.selectionStart);
    let e = ta.value.indexOf("\n", Math.max(ta.selectionEnd - 1, ta.selectionStart));
    if (e === -1) e = ta.value.length;
    const block = ta.value.slice(s, e);
    const single = ta.selectionStart === ta.selectionEnd && dir > 0;
    if (single) return insert("    ");
    const out = block.split("\n").map((ln) => (dir > 0 ? "    " + ln : ln.replace(/^ {1,4}/, ""))).join("\n");
    ta.setRangeText(out, s, e, "select");
    changed();
  }
  ta.addEventListener("input", changed);
  ta.addEventListener("scroll", sync);
  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Tab") { ev.preventDefault(); indent(ev.shiftKey ? -1 : 1); }
    else if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      const s = lineStart(ta.selectionStart);
      const line = ta.value.slice(s, ta.selectionStart);
      let ind = (line.match(/^\s*/) || [""])[0];
      if (/:\s*(#.*)?$/.test(line)) ind += "    ";
      insert("\n" + ind);
    }
  });
  // Android-клавиатуры часто не шлют keydown для Enter — дублируем автоотступ через beforeinput
  ta.addEventListener("beforeinput", (ev) => {
    if (ev.inputType === "insertLineBreak" || (ev.inputType === "insertText" && ev.data === "\n")) {
      ev.preventDefault();
      const s = lineStart(ta.selectionStart);
      const line = ta.value.slice(s, ta.selectionStart);
      let ind = (line.match(/^\s*/) || [""])[0];
      if (/:\s*(#.*)?$/.test(line)) ind += "    ";
      insert("\n" + ind);
    }
  });
  const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
  host.querySelectorAll(".keybar button").forEach((b) => {
    b.addEventListener("pointerdown", (ev) => ev.preventDefault()); // не убирать фокус и клавиатуру
    b.addEventListener("click", () => {
      const k = b.dataset.key;
      ta.focus();
      if (k === "⇥") indent(1);
      else if (k === "⇤") indent(-1);
      else if (k === "↶") {
        if (history.length > 1 && history[history.length - 1] === ta.value) history.pop();
        ta.value = history[history.length - 1] ?? ta.value;
        paint(); onChange(ta.value);
      } else if (k === 'f""') insert('f""', 1);
      else if (pairs[k] && ta.selectionStart === ta.selectionEnd) insert(k + pairs[k], 1);
      else insert(k);
    });
  });
  paint();
  return {
    get value() { return ta.value; },
    set value(v) { ta.value = v; history.push(v); paint(); onChange(v); },
  };
}

function viewTask(lesson) {
  const pane = lessonShell(lesson, "task");
  const key = "code." + lesson.id;
  const saved = store.get(key, null);
  const hasInput = /input\s*\(/.test(lesson.solution) || /expect_lines|run_solution|output_lines/.test(lesson.tests);
  pane.innerHTML = `
    <details class="fold" ${saved == null ? "open" : ""}><summary>📝 Условие задачи</summary><div id="task-md"></div></details>
    <div id="editor"></div>
    <div class="actions">
      <button class="btn" id="run-btn">▶ Запустить</button>
      <button class="btn primary" id="check-btn" ${lesson.tests ? "" : "disabled"}>✓ Проверить</button>
    </div>
    ${hasInput ? `<details class="fold" style="margin-top:10px"><summary>⌨ Ввод для «Запустить» (stdin)</summary>
      <div><textarea class="plain" id="stdin" placeholder="Каждая строка — один input()">${esc(store.get("stdin." + lesson.id, ""))}</textarea></div></details>` : ""}
    <div class="results" id="results" aria-live="polite"></div>
    <details class="fold"><summary>🔍 Тесты, по которым идёт проверка</summary><div><pre class="code">${highlight(lesson.tests || "# тестов нет")}</pre></div></details>
    <div class="row">
      <button class="btn ghost small" id="reset-code">Сбросить код к заготовке</button>
    </div>`;
  $("#task-md").appendChild(renderMd(lesson.task || "Задачи на код в этом уроке нет."));
  let saveTimer;
  const editor = makeEditor($("#editor"), saved ?? lesson.solution, (v) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(key, v), 300);
  });
  const stdinEl = $("#stdin");
  stdinEl?.addEventListener("input", () => store.set("stdin." + lesson.id, stdinEl.value));
  const results = $("#results");
  const runBtn = $("#run-btn"), checkBtn = $("#check-btn");

  function busy(on, btn, label) {
    runBtn.disabled = checkBtn.disabled = on || false;
    if (!lesson.tests) checkBtn.disabled = true;
    if (on) btn.innerHTML = `<span class="spinner"></span> ${label}`;
    else { runBtn.innerHTML = "▶ Запустить"; checkBtn.innerHTML = "✓ Проверить"; }
  }
  const progressLine = (text) => { results.innerHTML = `<div class="row muted small"><span class="spinner"></span>${esc(text)}</div>`; };

  checkBtn.addEventListener("click", async () => {
    store.set(key, editor.value);
    busy(true, checkBtn, "Проверяю…");
    progressLine("Готовлю Python… (первый запуск ~10–20 с)");
    const res = await Py.run("tests", { "solution.py": editor.value, "tests.py": lesson.tests }, { onProgress: progressLine });
    busy(false);
    if (res.error) {
      results.innerHTML = `<div class="summary err">Ошибка</div><div class="console">${esc(res.error)}</div>`;
      vibrate([60, 40, 60]);
      return;
    }
    const total = res.results.length, passed = res.results.filter((r) => r.ok).length;
    const ok = total > 0 && passed === total;
    results.innerHTML = `
      <div class="summary ${ok ? "ok" : "bad"}">${ok ? `Все тесты пройдены (${passed}/${total}). Задача засчитана!` : `Пройдено ${passed}/${total}. Исправь решение и проверь снова.`}</div>
      ${res.results.map((r) => `<div class="result ${r.ok ? "ok" : "bad"}"><b>${r.ok ? "OK" : "FAIL"}</b>
        <div>${esc(r.name)}${r.ok ? "" : `<pre>${esc(r.msg)}</pre>`}</div></div>`).join("")}`;
    if (ok) {
      vibrate(80);
      const first = !progress.state(lesson.id).task;
      const completedNow = progress.mark(lesson.id, "task");
      if (first && !completedNow) toast("Задача решена: +40 XP");
      lessonShellTicks(lesson);
    } else vibrate([60, 40, 60]);
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  runBtn.addEventListener("click", async () => {
    store.set(key, editor.value);
    busy(true, runBtn, "Запускаю…");
    progressLine("Готовлю Python… (первый запуск ~10–20 с)");
    const res = await Py.run("program", { "solution.py": editor.value }, { stdin: stdinEl ? stdinEl.value : "", onProgress: progressLine });
    busy(false);
    const out = res.out ?? "", err = res.err || res.error || "";
    results.innerHTML = `<div class="muted small" style="margin-bottom:6px">Вывод программы:</div>
      <div class="console">${esc(out) || (err ? "" : '<span class="muted">(ничего не напечатано)</span>')}${err ? `<span class="err">${esc(err)}</span>` : ""}</div>`;
  });

  $("#reset-code").addEventListener("click", () => {
    if (confirm("Вернуть исходную заготовку solution.py? Твой код будет удалён.")) {
      editor.value = lesson.solution;
      store.set(key, lesson.solution);
      results.innerHTML = "";
    }
  });
  Py.warm();
}

// ---------- статистика и перенос прогресса ----------
function viewStats() {
  const log = timeLog.data;
  const total = Object.values(log).reduce((a, b) => a + b, 0);
  const goalDays = Object.values(log).filter((v) => v >= DAILY_GOAL).length;
  const done = LESSONS.filter(isDone).length;
  const days = [];
  for (let k = 13; k >= 0; k--) {
    const d = new Date();
    d.setDate(d.getDate() - k);
    days.push({ d, sec: log[dayKey(d)] || 0 });
  }
  app.innerHTML = `
    <h1 style="font-size:22px;margin:0 0 12px">Статистика</h1>
    <div class="kpis">
      <div class="kpi"><div class="v">${fmtShort(timeLog.today())}</div><div class="l">сегодня из 3 ч</div></div>
      <div class="kpi"><div class="v">${timeLog.streak()}</div><div class="l">дней подряд</div></div>
      <div class="kpi"><div class="v">${done}/${LESSONS.length}</div><div class="l">уроков пройдено</div></div>
      <div class="kpi"><div class="v">${progress.data.xp || 0}</div><div class="l">XP</div></div>
    </div>
    <section class="card">
      <h2>Последние 14 дней</h2>
      <p class="muted small" style="margin-top:0">Всего ${fmtShort(total)} · дней с нормой: ${goalDays}. Зелёный — норма 3 часа выполнена.</p>
      <div class="days">
        ${days.map(({ d, sec }) => `<div class="day ${sec >= DAILY_GOAL ? "goal" : ""}">
          <span>${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}</span>
          <span class="bar" title="${fmt(sec)}"><i style="width:${Math.min(sec / DAILY_GOAL, 1) * 100}%"></i></span>
          <span class="t">${sec ? fmt(sec) : "—"}</span></div>`).join("")}
      </div>
    </section>
    <section class="card">
      <h2>Перенос прогресса</h2>
      <p class="muted small" style="margin-top:0">Формат совместим с курсом в PyCharm: <code>python learn.py export</code> на ПК выдаёт такой же текст, а <code>python learn.py import файл.json</code> его принимает. При объединении берётся лучшее с обеих сторон.</p>
      <div class="row">
        <button class="btn" id="export-btn">⬆ Экспорт</button>
        <button class="btn" id="import-btn">⬇ Импорт</button>
      </div>
      <div id="sync-area"></div>
    </section>
    <section class="card">
      <h2>Тема оформления</h2>
      <div class="row">
        ${[["auto", "Как в системе"], ["light", "Светлая"], ["dark", "Тёмная"]].map(([k, t]) =>
          `<button class="btn ${(store.get("theme", "auto") === k) ? "primary" : ""}" data-theme-set="${k}">${t}</button>`).join("")}
      </div>
    </section>
    <section class="card">
      <h2>Сброс</h2>
      <p class="muted small" style="margin-top:0">Удалить весь прогресс, время и код на этом устройстве.</p>
      <button class="btn" id="wipe-btn" style="color:var(--bad)">Сбросить всё</button>
    </section>`;

  const area = $("#sync-area");
  $("#export-btn").addEventListener("click", () => {
    const text = JSON.stringify({ progress: progress.data, time_log: timeLog.data }, null, 2);
    area.innerHTML = `<p class="small">Скопируй текст и сохрани на ПК как файл, например <code>sync.json</code>.</p>
      <textarea class="plain" rows="8" readonly>${esc(text)}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="copy-btn">Копировать</button>
      ${IN_APP && window.AndroidBridge ? `<button class="btn" id="share-btn">Поделиться…</button>` : `<button class="btn" id="dl-btn">Скачать файл</button>`}</div>`;
    $("#copy-btn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); toast("Скопировано"); }
      catch { const t = $("textarea", area); t.select(); document.execCommand("copy"); toast("Скопировано"); }
    });
    $("#share-btn")?.addEventListener("click", () => window.AndroidBridge.share(text));
    $("#dl-btn")?.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = "python-backend-progress.json";
      a.click();
    });
  });
  $("#import-btn").addEventListener("click", () => {
    area.innerHTML = `<p class="small">Вставь текст экспорта (с ПК — из <code>python learn.py export</code>).</p>
      <textarea class="plain" rows="8" id="import-text" placeholder='{"progress": {...}, "time_log": {...}}'></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="merge-btn">Объединить</button>
      <label class="btn">Из файла<input type="file" accept=".json,application/json" id="import-file" hidden></label></div>`;
    $("#import-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (f) $("#import-text").value = await f.text();
    });
    $("#merge-btn").addEventListener("click", () => {
      try {
        const n = mergeSync(JSON.parse($("#import-text").value));
        toast(`Готово: обновлено уроков — ${n}`);
        viewStats();
      } catch (e) { toast("Не получилось разобрать JSON: " + e.message); }
    });
  });
  app.querySelectorAll("[data-theme-set]").forEach((b) => b.addEventListener("click", () => {
    store.set("theme", b.dataset.themeSet);
    applyTheme();
    viewStats();
  }));
  $("#wipe-btn").addEventListener("click", () => {
    if (!confirm("Точно удалить весь прогресс, время и код на этом устройстве?")) return;
    Object.keys(localStorage).filter((k) => k.startsWith("pbc.")).forEach((k) => localStorage.removeItem(k));
    progress.data = { lessons: {}, xp: 0 };
    timeLog.data = {};
    timer.running = false;
    updateTop();
    viewStats();
  });
}

function mergeSync(data) {
  const prog = data.progress || (data.lessons ? data : null);
  const time = data.time_log || {};
  let changed = 0;
  if (prog && prog.lessons) {
    for (const [id, st] of Object.entries(prog.lessons)) {
      const mine = (progress.data.lessons[id] ||= {});
      let touched = false;
      for (const [step, at] of Object.entries(st)) {
        if (at && (!mine[step] || at < mine[step])) { mine[step] = at; touched = true; }
      }
      if (touched) changed++;
    }
    progress.recalcXp();
    progress.save();
  }
  for (const [day, sec] of Object.entries(time)) {
    if (typeof sec === "number" && sec > (timeLog.data[day] || 0)) timeLog.data[day] = sec;
  }
  timeLog.save();
  updateTop();
  return changed;
}

// ---------- роутер ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  document.querySelectorAll(".bottombar a").forEach((a) => a.classList.remove("active"));
  const nav = (k) => document.querySelector(`[data-nav="${k}"]`)?.classList.add("active");
  if (parts[0] === "l" && byId[parts[1]]) {
    const lesson = byId[parts[1]];
    const tab = parts[2] || "theory";
    if (tab === "quiz" && lesson.quiz.length) viewQuiz(lesson);
    else if (tab === "task" && (lesson.task || lesson.tests)) viewTask(lesson);
    else viewTheory(lesson);
    nav("next");
    store.set("last", location.hash);
  } else if (parts[0] === "next") {
    const nxt = nextLesson();
    location.replace(nxt ? `#/l/${nxt.id}/${firstOpenStep(nxt)}` : "#/");
    return;
  } else if (parts[0] === "stats") {
    viewStats();
    nav("stats");
  } else {
    viewHome();
    nav("home");
  }
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

function applyTheme() {
  const t = store.get("theme", "auto");
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

// Для Android: кнопка «Назад» спрашивает у страницы, куда идти
window.appBack = function () {
  if ($("#dialog").open) { $("#dialog").close(); return true; }
  if (location.hash && location.hash !== "#/") { history.back(); return true; }
  return false;
};

applyTheme();
const setTopH = () => document.documentElement.style.setProperty("--top-h", $(".topbar").offsetHeight + "px");
setTopH();
window.addEventListener("resize", setTopH);
$("#timer-btn").addEventListener("click", () => { timer.toggle(); if (!location.hash || location.hash === "#/") viewHome(); });
setInterval(() => timer.tick(), 1000);
document.addEventListener("visibilitychange", () => { timer.last = Date.now(); timeLog.save(); });
window.addEventListener("pagehide", () => timeLog.save());
window.addEventListener("hashchange", route);
route();
updateTop();

if ("serviceWorker" in navigator && !IN_APP && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
