const $ = (id) => document.getElementById(id);

// --- Saqlash (brauzer localStorage) ---

const STORAGE_KEY = "vocab-data-v2";
const OLD_STORAGE_KEY = "vocab-data-v1";
const DAILY_GOAL = 20;

// progress: { [wordId]: { box, next, ok, no, last } } — last: oxirgi javob to'g'rimi
// custom:   { [wordId]: { term, translation, example } } — foydalanuvchi o'zi qo'shgan so'zlar
// history:  { "YYYY-MM-DD": javoblar soni }
// write:    { en: { [wordId]: progress }, uz: { ... } } — yozish mashqi, har yo'nalish alohida Leitner
const emptyDb = () => ({ progress: {}, custom: {}, streak: 0, lastDay: null, history: {}, write: { en: {}, uz: {} } });
let db = emptyDb();
let storageOk = true;

/** 1-versiya (to'plamlarni qo'lda qo'shish) ma'lumotini yangi formatga o'tkazadi */
function migrateV1(old) {
  const out = { ...emptyDb(), streak: old.streak || 0, lastDay: old.lastDay || null };
  for (const w of Object.values(old.words || {})) {
    const key = w.term.toLowerCase();
    const id = w.pack ? `${w.pack}:${key}` : `u:${key}`;
    if (!w.pack) out.custom[id] = { term: w.term, translation: w.translation, example: w.example };
    if (!w.pack || w.ok + w.no > 0) out.progress[id] = { box: w.box, next: w.next, ok: w.ok || 0, no: w.no || 0 };
  }
  return out;
}

function normalize(data) {
  if (!data || typeof data !== "object") throw new Error("noto'g'ri format");
  if (data.words) return migrateV1(data);
  if (typeof data.progress !== "object") throw new Error("noto'g'ri format");
  return { ...emptyDb(), ...data, write: { en: {}, uz: {}, ...data.write } };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (raw) db = normalize(JSON.parse(raw));
    else if (old) {
      db = normalize(JSON.parse(old));
      saveDb();
    }
  } catch {
    storageOk = false;
  }
}

function saveDb() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    if (storageOk) toast("Brauzer ma'lumotni saqlay olmadi. Zaxira nusxa oling.");
    storageOk = false;
  }
}

// --- Kitoblar va so'zlar indeksi ---

const PACKS = window.PACKS;
const isEvu = (p) => p.level.startsWith("EVU-");

const BOOKS = [
  {
    id: "evu",
    title: "English Vocabulary in Use",
    level: "Elementary · A1–A2",
    author: "Michael McCarthy · Felicity O'Dell",
    cover: "img/evu-elementary.jpg",
    packs: PACKS.filter(isEvu),
  },
  {
    // Hali so'zlari kiritilmagan: javonda ko'rinadi, lekin ochilmaydi
    id: "evu-pi",
    title: "English Vocabulary in Use",
    level: "Pre-intermediate & Intermediate · B1–B2",
    author: "Stuart Redman",
    cover: "img/evu-pre-intermediate.jpg",
    packs: [],
    soon: true,
  },
  {
    id: "basic",
    title: "Kundalik so'zlar",
    level: "A1 · Boshlang'ich",
    author: "Vocab to'plami",
    coverText: ["A1", "Kundalik so'zlar"],
    packs: PACKS.filter((p) => !isEvu(p)),
  },
];

const HUES = [
  "linear-gradient(135deg, #8b6cff, #ff5ca8)",
  "linear-gradient(135deg, #ff9f43, #ff5c7a)",
  "linear-gradient(135deg, #1fb6ff, #8b6cff)",
  "linear-gradient(135deg, #22d39a, #1fb6ff)",
  "linear-gradient(135deg, #ffb347, #ff7a45)",
  "linear-gradient(135deg, #ff5ca8, #ffb347)",
  "linear-gradient(135deg, #7bd96b, #22d39a)",
  "linear-gradient(135deg, #a78bfa, #1fb6ff)",
];

const bookOf = new Map(); // level -> book
const hueOf = new Map(); // level -> gradient
for (const book of BOOKS) {
  const groups = [...new Set(book.packs.map((p) => p.group))];
  for (const p of book.packs) {
    bookOf.set(p.level, book);
    hueOf.set(p.level, HUES[groups.indexOf(p.group) % HUES.length]);
  }
}
const packByLevel = new Map(PACKS.map((p) => [p.level, p]));

// id -> { id, term, translation, example, pack }
let WORDS = new Map();
const packIds = new Map();

function buildIndex() {
  WORDS = new Map();
  // Kitob so'zlari lug'atda birinchi chiqishi uchun kitoblar tartibida
  for (const book of BOOKS) {
    for (const pack of book.packs) {
      const ids = [];
      for (const w of pack.words) {
        const id = `${pack.level}:${w.term.toLowerCase()}`;
        if (!WORDS.has(id)) WORDS.set(id, { id, ...w, pack: pack.level });
        ids.push(id);
      }
      packIds.set(pack.level, [...new Set(ids)]);
    }
  }
  for (const [id, w] of Object.entries(db.custom)) WORDS.set(id, { id, ...w, pack: null });
}

// --- Leitner tizimi ---
// 7 ta quti. Yangi so'zga birinchi to'g'ri javob -> 1-quti (ertaga tekshiriladi),
// keyingi to'g'ri javoblar -> bir quti yuqoriga, xato -> 2 quti pastga (eng kami 1-quti).
// Oraliqlar (kun): 1-quti 1, 2-quti 3, 3-quti 7, 4-quti 14, 5-quti 30, 6-quti 60, 7-quti 120.
// 7-qutidagilar yodlangan hisoblanadi.

const MAX_BOX = 7;
const INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30, 6: 60, 7: 120 };
const WRONG_DROP = 2;
// Oraliqqa ±10% tasodifiy farq: bir kunda o'rganilgan so'zlar bir kunga yig'ilib qolmasin
const JITTER = 0.1;
// Xato javobdan keyin so'z shu daqiqadan keyin qayta chiqadi
const RETRY_MINUTES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function nextState(box, correct, fresh = false, now = Date.now()) {
  if (!correct) return { box: Math.max(1, box - WRONG_DROP), next: now + RETRY_MINUTES * 60 * 1000 };
  const newBox = fresh ? 1 : Math.min(box + 1, MAX_BOX);
  const jitter = 1 + (Math.random() * 2 - 1) * JITTER;
  return { box: newBox, next: now + Math.round(INTERVAL_DAYS[newBox] * DAY_MS * jitter) };
}

// "YYYY-MM-DD", qurilmaning mahalliy vaqti bo'yicha
function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function touchStreak() {
  const today = dayKey();
  if (db.lastDay === today) return;
  db.streak = db.lastDay === dayKey(new Date(Date.now() - DAY_MS)) ? db.streak + 1 : 1;
  db.lastDay = today;
}

function applyAnswer(id, correct) {
  const p = db.progress[id] ?? { box: 1, next: 0, ok: 0, no: 0 };
  Object.assign(p, nextState(p.box, correct, p.ok + p.no === 0), { last: correct });
  if (correct) p.ok++;
  else p.no++;
  db.progress[id] = p;
  logAnswer();
  saveDb();
}

/** Kunlik javoblar soni va streak (kartochka ham, yozish ham hisoblanadi) */
function logAnswer() {
  const today = dayKey();
  db.history[today] = (db.history[today] || 0) + 1;
  touchStreak();
}

// --- Hisob-kitob ---

/** "new" — hali javob berilmagan, "ok" — oxirgi javob "bilaman", "no" — oxirgi javob "bilmayman" */
function status(id) {
  const p = db.progress[id];
  if (!p || p.ok + p.no === 0) return "new";
  if (p.last === undefined) return p.box > 1 ? "ok" : "no";
  return p.last ? "ok" : "no";
}

const isDue = (id, now = Date.now()) => db.progress[id] && db.progress[id].next <= now;

function dueIds() {
  return Object.keys(db.progress)
    .filter((id) => WORDS.has(id) && isDue(id))
    .sort((a, b) => db.progress[a].next - db.progress[b].next);
}

function streakNow() {
  const alive = db.lastDay === dayKey() || db.lastDay === dayKey(new Date(Date.now() - DAY_MS));
  return alive ? db.streak : 0;
}

function getStats() {
  const boxes = {};
  for (let i = 1; i <= MAX_BOX; i++) boxes[i] = 0;
  let due = 0, known = 0, unknown = 0;
  const now = Date.now();
  for (const [id, p] of Object.entries(db.progress)) {
    if (!WORDS.has(id)) continue;
    const st = status(id);
    if (st === "new") continue;
    boxes[p.box]++;
    if (st === "ok") known++;
    else unknown++;
    if (p.next <= now) due++;
  }
  return { boxes, due, known, unknown, mastered: boxes[MAX_BOX], streak: streakNow(), today: db.history[dayKey()] || 0 };
}

function packStats(level) {
  const ids = packIds.get(level);
  const s = { total: ids.length, ok: 0, no: 0, new: 0, due: 0 };
  const now = Date.now();
  for (const id of ids) {
    s[status(id)]++;
    if (isDue(id, now)) s.due++;
  }
  return s;
}

function bookStats(book) {
  let unitsDone = 0, studied = 0, total = 0;
  for (const p of book.packs) {
    const s = packStats(p.level);
    if (s.new === 0) unitsDone++;
    studied += s.total - s.new;
    total += s.total;
  }
  return { unitsDone, units: book.packs.length, studied, total };
}

/** Kitobdagi keyingi ish: avval navbati kelgan, keyin tugallanmagan bo'lim */
function nextPack(book) {
  return book.packs.find((p) => packStats(p.level).due > 0) ?? book.packs.find((p) => packStats(p.level).new > 0) ?? book.packs[0];
}

// --- Yordamchilar ---

let toastTimer;
function toast(message) {
  const node = $("toast");
  node.hidden = true;
  void node.offsetWidth; // animatsiyani qayta boshlash uchun
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 2600);
}

function timeLeft(date) {
  const minutes = Math.max(1, Math.ceil((date - Date.now()) / 60000));
  if (minutes < 60) return `${minutes} daqiqa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat`;
  return `${Math.round(hours / 24)} kun`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Lucide ikonasi uchun joy; icons() chaqirilganda SVG ga aylanadi */
function ic(name, className) {
  const node = document.createElement("i");
  node.setAttribute("data-lucide", name);
  if (className) node.className = className;
  return node;
}

function icons() {
  window.lucide?.createIcons();
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Raqamni eski qiymatdan yangisiga silliq o'tkazib ko'rsatadi */
function countTo(node, value, suffix = "") {
  const from = Number(node.dataset.value || 0);
  node.dataset.value = value;
  if (reduceMotion || from === value) {
    node.textContent = value + suffix;
    return;
  }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 700);
    node.textContent = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setWidth(node, ratio) {
  requestAnimationFrame(() => (node.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`));
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

const unitNumber = (pack) => (isEvu(pack) ? String(Number(pack.level.slice(4))) : pack.level);
const unitName = (pack) => pack.title.replace(/^\d+\.\s*/, "");

// --- Marshrutlash (#/, #/book/evu, #/unit/EVU-01, #/words, #/stats) ---

const route = { view: "home", book: null, pack: null };

function parseRoute() {
  const [name, arg] = location.hash.replace(/^#\/?/, "").split("/");
  route.book = null;
  route.pack = null;
  if (name === "book" && BOOKS.some((b) => b.id === arg && !b.soon)) {
    route.view = "book";
    route.book = BOOKS.find((b) => b.id === arg);
  } else if (name === "unit" && packByLevel.has(arg)) {
    route.view = "unit";
    route.pack = packByLevel.get(arg);
    route.book = bookOf.get(arg);
  } else if (name === "words" || name === "stats") {
    route.view = name;
  } else {
    route.view = "home";
  }
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function onRoute() {
  const prev = route.view;
  parseRoute();
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${route.view}`));
  const navKey = ["book", "unit"].includes(route.view) ? "home" : route.view;
  document.querySelectorAll(".dock [data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === navKey));
  if (prev !== route.view || route.view !== "words") window.scrollTo({ top: 0 });
  render();
}

window.addEventListener("hashchange", onRoute);

function render() {
  refreshBadge();
  if (route.view === "home") renderHome();
  if (route.view === "book") renderBook();
  if (route.view === "unit") renderUnit();
  if (route.view === "words") renderWords();
  if (route.view === "stats") renderStats();
  icons();
}

$("dock-review").addEventListener("click", startReview);
document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => go(b.dataset.back)));

function refreshBadge() {
  const due = dueIds().length + writeDueCount();
  $("dock-badge").hidden = due === 0;
  $("dock-badge").textContent = due > 99 ? "99+" : due;
}

// --- Mavzu (qorong'i / yorug') ---
// Tanlov brauzerda saqlanadi; tanlanmagan bo'lsa tizim sozlamasiga ergashadi.
// Boshlang'ich qiymatni index.html dagi kichik skript sahifa chizilishidan oldin qo'yadi.

const THEME_KEY = "vocab-theme";
const THEME_COLOR = { dark: "#0b0a1a", light: "#f4f2ff" };

function savedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = THEME_COLOR[theme];
  const btn = $("theme-toggle");
  const label = theme === "dark" ? "Yorug' rejimga o'tish" : "Qorong'i rejimga o'tish";
  btn.replaceChildren(ic(theme === "dark" ? "sun" : "moon"));
  btn.setAttribute("aria-label", label);
  btn.title = label;
  icons();
}

$("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
  applyTheme(next);
});

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  if (!savedTheme()) applyTheme(e.matches ? "light" : "dark");
});

applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");

// --- Ilovani o'rnatish (PWA) ---
// Android / kompyuter Chrome: brauzerning o'rnatish oynasi; iPhone: qo'lda qo'shish ko'rsatmasi.

const INSTALL_HIDE_KEY = "vocab-install-hidden";
let installPrompt = null;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function refreshInstall() {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(INSTALL_HIDE_KEY) === "1";
  } catch {}
  $("install-banner").hidden = dismissed || isStandalone() || !(installPrompt || isIos);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  refreshInstall();
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  refreshInstall();
  toast("Ilova o'rnatildi — bosh ekrandan oching");
});

$("install-btn").addEventListener("click", async () => {
  if (!installPrompt) {
    $("install-sheet").hidden = false;
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  refreshInstall();
});

$("install-close").addEventListener("click", () => {
  try {
    localStorage.setItem(INSTALL_HIDE_KEY, "1");
  } catch {}
  refreshInstall();
});

$("install-sheet").addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) $("install-sheet").hidden = true;
});

// file:// orqali ochilganda service worker ishlamaydi
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

refreshInstall();

// --- Asosiy sahifa ---

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return "Xayrli tong";
  if (h >= 11 && h < 17) return "Xayrli kun";
  if (h >= 17 && h < 23) return "Xayrli kech";
  return "Xayrli tun";
}

function setHeroButton(icon, label, onClick) {
  $("hero-btn").replaceChildren(ic(icon), el("span", "", label));
  $("hero-btn").onclick = onClick;
}

function renderHome() {
  const s = getStats();
  $("greeting").textContent = greeting();
  countTo($("home-streak"), s.streak);

  const ratio = Math.min(1, s.today / DAILY_GOAL);
  requestAnimationFrame(() => ($("goal-ring").style.strokeDashoffset = String(327 * (1 - ratio))));
  countTo($("goal-count"), s.today);
  $("goal-total").textContent = DAILY_GOAL;

  const next = nextPack(BOOKS[0]);
  const due = s.due + writeDueCount();
  if (due > 0) {
    $("hero-title").textContent = `${due} ta so'z kutmoqda`;
    $("hero-sub").textContent = "Takrorlash vaqti keldi — eslab qolish shu paytda eng samarali.";
    setHeroButton("zap", "Takrorlash", startReview);
  } else if (s.today >= DAILY_GOAL) {
    $("hero-title").textContent = "Maqsad bajarildi!";
    $("hero-sub").textContent = "Bugun zo'r ishladingiz. Xohlasangiz, yana bir bo'lim oching.";
    setHeroButton("book-open", "Kitobni ochish", () => go("#/book/evu"));
  } else {
    $("hero-title").textContent = `${unitNumber(next)}. ${unitName(next)}`;
    $("hero-sub").textContent = "Yangi so'zlar bilan tanishing.";
    setHeroButton("play", "Boshlash", () => go(`#/unit/${next.level}`));
  }

  countTo($("q-known"), s.known);
  countTo($("q-unknown"), s.unknown);
  countTo($("q-mastered"), s.mastered);

  $("shelf").replaceChildren(...BOOKS.map(bookCard));
}

function coverEl(book, className = "cover") {
  const cover = el("div", className);
  if (book.cover) {
    const img = el("img");
    img.src = book.cover;
    img.alt = `${book.title} muqovasi`;
    cover.append(img);
  } else {
    cover.classList.add("cover-gen");
    cover.append(el("b", "", book.coverText[0]), el("span", "", book.coverText[1]));
  }
  return cover;
}

function bookCard(book, i) {
  if (book.soon) return soonCard(book, i);
  const s = bookStats(book);
  const card = el("a", "book glass");
  card.href = `#/book/${book.id}`;
  card.style.setProperty("--i", i);

  const main = el("div", "book-main");
  const meta = el("div", "book-meta");
  const units = el("span");
  units.append(ic("layers"), `${s.unitsDone}/${s.units} bo'lim`);
  const words = el("span");
  words.append(ic("book-open"), `${s.studied}/${s.total} so'z`);
  meta.append(units, words);

  const bar = el("div", "bar");
  const fill = el("span");
  bar.append(fill);
  setWidth(fill, s.studied / s.total);

  const goLabel = el("span", "book-go", s.studied ? "Davom ettirish" : "Boshlash");
  goLabel.append(ic("arrow-right"));

  main.append(el("p", "eyebrow", book.level), el("h3", "", book.title), el("p", "muted small", book.author), meta, bar, goLabel);
  card.append(coverEl(book), main);
  return card;
}

function soonCard(book, i) {
  const card = el("div", "book glass soon");
  card.style.setProperty("--i", i);
  card.setAttribute("aria-disabled", "true");

  const cover = coverEl(book);
  const ribbon = el("span", "soon-ribbon");
  ribbon.append(ic("clock"), "Tez orada");
  cover.append(ribbon);

  const pill = el("span", "soon-pill");
  pill.append(ic("lock"), "Tez orada qo'shiladi");
  const main = el("div", "book-main");
  main.append(el("p", "eyebrow", book.level), el("h3", "", book.title), el("p", "muted small", book.author), pill);

  card.append(cover, main);
  card.addEventListener("click", () => toast("Bu kitob tez orada qo'shiladi"));
  return card;
}

// --- Kitob sahifasi ---

function renderBook() {
  const book = route.book;
  const s = bookStats(book);
  $("book-cover").replaceWith(Object.assign(coverEl(book, "cover cover-lg"), { id: "book-cover" }));
  $("book-level").textContent = book.level;
  $("book-title").textContent = book.title;
  $("book-author").textContent = book.author;
  countTo($("book-units-done"), s.unitsDone);
  $("book-units-total").textContent = s.units;
  countTo($("book-words-done"), s.studied);
  $("book-words-total").textContent = s.total;
  setWidth($("book-bar"), s.studied / s.total);

  const next = nextPack(book);
  $("book-continue").replaceChildren(ic("play"), el("span", "", s.studied ? `Davom ettirish · ${unitNumber(next)}-bo'lim` : "Birinchi bo'limdan boshlash"));
  $("book-continue").onclick = () => go(`#/unit/${next.level}`);

  const groups = new Map();
  for (const p of book.packs) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  }
  let i = 0;
  const nodes = [];
  for (const [name, packs] of groups) {
    if (groups.size > 1) nodes.push(el("div", "group-title", name));
    const grid = el("div", "unit-grid");
    for (const p of packs) grid.append(unitTile(p, i++));
    nodes.push(grid);
  }
  $("units").replaceChildren(...nodes);
}

function unitTile(pack, i) {
  const s = packStats(pack.level);
  const tile = el("a", "unit glass");
  tile.href = `#/unit/${pack.level}`;
  tile.style.setProperty("--hue", hueOf.get(pack.level));
  tile.style.setProperty("--i", Math.min(i, 24));
  tile.append(el("span", "unit-num", unitNumber(pack)), el("span", "unit-title", unitName(pack)), el("span", "unit-sub", pack.subtitle || ""));

  const meta = el("div", "unit-meta");
  const ok = el("span", "m-ok");
  ok.append(ic("check"), String(s.ok));
  const no = el("span", "m-no");
  no.append(ic("x"), String(s.no));
  meta.append(ok, no, el("span", "m-new", `${s.new} yangi`));

  const mix = el("div", "mix");
  const mixOk = el("span", "mix-ok");
  const mixNo = el("span", "mix-no");
  mix.append(mixOk, mixNo);
  setWidth(mixOk, s.ok / s.total);
  setWidth(mixNo, s.no / s.total);

  const foot = el("div", "unit-foot");
  foot.append(meta, mix);
  tile.append(foot);

  if (s.due) {
    const badge = el("span", "unit-badge badge-due");
    badge.append(ic("clock"), String(s.due));
    tile.append(badge);
  } else if (s.new === 0) {
    const badge = el("span", "unit-badge badge-done");
    badge.append(ic("check"));
    tile.append(badge);
  }
  return tile;
}

// --- Bo'lim sahifasi ---

let unitSeg = "all";

function renderUnit() {
  const pack = route.pack;
  const s = packStats(pack.level);
  const hue = hueOf.get(pack.level);

  $("unit-back").replaceChildren(ic("arrow-left"), el("span", "", route.book.title));
  $("unit-back").onclick = () => go(`#/book/${route.book.id}`);
  $("unit-hero").style.setProperty("--hue", hue);
  $("unit-num").textContent = unitNumber(pack);
  $("unit-title").textContent = unitName(pack);
  $("unit-sub").textContent = `${pack.subtitle || ""} · ${s.total} so'z`;

  countTo($("unit-ok"), s.ok);
  countTo($("unit-no"), s.no);
  countTo($("unit-new"), s.new);

  const pending = s.due + s.new;
  $("unit-start").replaceChildren(ic(pending ? "play" : "repeat-2"), el("span", "", pending ? `Boshlash · ${pending} ta` : "Qayta mashq"));
  $("unit-start").onclick = () => startUnit(pack);

  $("unit-retry").hidden = s.no === 0;
  $("unit-retry").replaceChildren(ic("rotate-ccw"), el("span", "", `Bilmaganlarim · ${s.no}`));
  $("unit-retry").onclick = () => startRetry(pack);
  document.querySelector(".unit-actions").classList.toggle("single", s.no === 0);

  document.querySelectorAll("#view-unit [data-seg]").forEach((b) => {
    const active = b.dataset.seg === unitSeg;
    b.classList.toggle("active", active && (b.closest(".segmented") || unitSeg !== "all"));
  });

  const ids = packIds.get(pack.level).filter((id) => unitSeg === "all" || status(id) === unitSeg);
  const order = { no: 0, new: 1, ok: 2 };
  if (unitSeg === "all") ids.sort((a, b) => order[status(a)] - order[status(b)]);
  const empty = { ok: "Hali “bilaman” deb belgilangan so'z yo'q", no: "Bilmagan so'zlaringiz yo'q — zo'r!", new: "Barcha so'zlar ko'rib chiqilgan", all: "" };
  $("unit-words").replaceChildren(...(ids.length ? ids.map((id, i) => wordRow(WORDS.get(id), i)) : [el("li", "empty-row", empty[unitSeg])]));
}

document.querySelectorAll("#view-unit [data-seg]").forEach((b) =>
  b.addEventListener("click", () => {
    unitSeg = b.dataset.seg;
    renderUnit();
    icons();
  }),
);

// --- So'z qatori (bo'lim va lug'at uchun) ---

const STATE_ICON = { ok: "check", no: "x", new: "sparkles" };

function wordRow(w, i) {
  const st = status(w.id);
  const p = db.progress[w.id];
  const li = el("li", `st-${st}`);
  li.style.setProperty("--i", Math.min(i, 20));

  const state = el("span", "word-state");
  state.append(ic(STATE_ICON[st]));

  const main = el("div", "word-main");
  main.append(el("div", "word-term", w.term), el("div", "word-tr", w.translation));

  const side = el("div", "word-side");
  if (p && st !== "new") {
    const pill = el("span", "box-pill", `${p.box}-quti`);
    pill.style.background = `var(--box-${p.box})`;
    side.append(pill, el("span", "", p.next <= Date.now() ? "hozir" : timeLeft(p.next)));
  } else {
    side.append(el("span", "", "yangi"));
  }

  const say = el("button", "word-say");
  say.type = "button";
  say.setAttribute("aria-label", "Talaffuz");
  say.append(ic("volume-2"));
  say.addEventListener("click", () => speak(w.term));

  li.append(state, main, side, say);
  return li;
}

// --- O'rganish sessiyasi ---

const session = { ids: [], i: 0, ok: 0, no: 0, results: new Map(), title: "", kind: "unit", pack: null, busy: false };

function startSession(ids, title, kind, pack = null) {
  if (!ids.length) return;
  Object.assign(session, { ids, i: 0, ok: 0, no: 0, results: new Map(), title, kind, pack, busy: false });
  $("study").hidden = false;
  $("study-title").textContent = title;
  $("tally-ok").textContent = "0";
  $("tally-no").textContent = "0";
  document.body.style.overflow = "hidden";
  showCard();
  icons();
}

function startUnit(pack) {
  const ids = packIds.get(pack.level);
  let queue = [...ids.filter((id) => isDue(id)), ...ids.filter((id) => status(id) === "new")];
  if (!queue.length) {
    queue = [...ids].sort(() => Math.random() - 0.5);
    toast("Bo'lim to'liq o'rganilgan — qayta mashq rejimi");
  }
  startSession(queue, `${unitNumber(pack)}. ${unitName(pack)}`, "unit", pack);
}

function startRetry(pack, ids) {
  const queue = ids ?? packIds.get(pack.level).filter((id) => status(id) === "no");
  startSession(queue, `${unitNumber(pack)}. ${unitName(pack)} · bilmaganlarim`, "retry", pack);
}

function startReview() {
  const ids = dueIds();
  const wen = writeDueIds("en"), wuz = writeDueIds("uz");
  if (!ids.length && !wen.length && !wuz.length) {
    const all = [db.progress, db.write.en, db.write.uz].flatMap((m) => Object.values(m)).filter((p) => p.ok + p.no > 0);
    const next = all.reduce((m, p) => Math.min(m, p.next), Infinity);
    toast(Number.isFinite(next) ? `Hammasi takrorlangan. Keyingisi ${timeLeft(next)}dan keyin` : "Avval biror bo'limni o'rganing");
    return;
  }
  const cards = () => startSession(ids.slice(0, 50), "Takrorlash", "review");
  if (!wen.length && !wuz.length) return cards();
  const writeOpt = (key, list) => ({
    icon: key === "en" ? "keyboard" : "pen-line",
    title: `Yozish: ${WRITE_DIRS[key].label}`,
    desc: WRITE_DIRS[key].desc,
    count: list.length,
    disabled: !list.length,
    run: () => startWrite(list.slice(0, 50), `Yozib takrorlash · ${WRITE_DIRS[key].short}`, key, null, "write-review"),
  });
  openModes("Takrorlash", "Qaysi mashqdan boshlaymiz?", [
    { icon: "layers", title: "Kartochkalar", desc: "So'zni ko'rib, bilasizmi — belgilaysiz", count: ids.length, disabled: !ids.length, run: cards },
    writeOpt("en", wen),
    writeOpt("uz", wuz),
  ]);
}

function closeStudy() {
  $("study").hidden = true;
  document.body.style.overflow = "";
  render();
}

function highlight(example, term) {
  const frag = document.createDocumentFragment();
  const base = term.split(/[\s/]+/)[0].replace(/[^a-z']/gi, "");
  const idx = base.length > 2 ? example.toLowerCase().indexOf(base.toLowerCase().slice(0, Math.max(3, base.length - 2))) : -1;
  if (idx < 0) {
    frag.append(example);
    return frag;
  }
  let end = idx;
  while (end < example.length && /[a-z'-]/i.test(example[end])) end++;
  frag.append(example.slice(0, idx), el("mark", "", example.slice(idx, end)), example.slice(end));
  return frag;
}

function showCard() {
  const card = $("card");
  if (session.i >= session.ids.length) return finishSession();

  const w = WORDS.get(session.ids[session.i]);
  const p = db.progress[w.id];
  const pack = packByLevel.get(w.pack);

  card.classList.remove("flipped");
  card.style.transition = "none";
  card.style.transform = "";
  card.style.opacity = "";
  card.style.setProperty("--ok-o", 0);
  card.style.setProperty("--no-o", 0);

  $("card-chip").textContent = pack ? pack.subtitle || pack.title : "Mening so'zim";
  $("card-box").textContent = p && status(w.id) !== "new" ? `${p.box}-quti` : "Yangi";
  $("card-term").textContent = w.term;
  $("card-term-back").textContent = w.term;
  $("card-translation").textContent = w.translation;
  $("card-example").replaceChildren(w.example ? highlight(w.example, w.term) : "");

  $("study-count").textContent = `${session.i + 1}/${session.ids.length}`;
  $("study-bar").style.width = `${(session.i / session.ids.length) * 100}%`;

  card.classList.remove("enter");
  void card.offsetWidth;
  card.classList.add("enter");
}

function flipCard() {
  $("card").classList.toggle("flipped");
}

function bump(node, value) {
  node.textContent = value;
  node.classList.remove("bump");
  void node.offsetWidth;
  node.classList.add("bump");
}

function answer(correct) {
  if (session.busy || session.i >= session.ids.length) return;
  session.busy = true;
  const id = session.ids[session.i];
  applyAnswer(id, correct);
  session.results.set(id, correct);
  if (correct) bump($("tally-ok"), ++session.ok);
  else bump($("tally-no"), ++session.no);
  navigator.vibrate?.(correct ? 12 : [20, 40, 20]);

  const flash = $("flash");
  flash.className = "flash";
  void flash.offsetWidth;
  flash.className = `flash ${correct ? "ok" : "no"}`;

  const card = $("card");
  const dir = correct ? 1 : -1;
  card.classList.remove("enter");
  card.style.transition = "transform .45s cubic-bezier(.4, 0, .2, 1), opacity .45s";
  card.style.transform = `translateX(${dir * 140}%) rotate(${dir * 22}deg)`;
  card.style.opacity = "0";
  card.style.setProperty(correct ? "--ok-o" : "--no-o", 1);

  setTimeout(() => {
    session.i++;
    session.busy = false;
    showCard();
  }, reduceMotion ? 0 : 380);
}

$("btn-ok").addEventListener("click", () => answer(true));
$("btn-no").addEventListener("click", () => answer(false));
$("btn-flip").addEventListener("click", flipCard);
$("btn-speak").addEventListener("click", () => {
  const w = WORDS.get(session.ids[session.i]);
  if (w) speak(w.term);
});
$("study-close").addEventListener("click", closeStudy);

// Kartani surish (swipe) va bosish (flip)
(function setupSwipe() {
  const card = $("card");
  let drag = null;

  card.addEventListener("pointerdown", (e) => {
    if (session.busy) return;
    drag = { x: e.clientX, dx: 0 };
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
    card.classList.remove("enter");
    card.style.transition = "none";
  });

  card.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    card.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 16}deg)`;
    card.style.setProperty("--ok-o", Math.max(0, Math.min(1, drag.dx / 110)));
    card.style.setProperty("--no-o", Math.max(0, Math.min(1, -drag.dx / 110)));
  });

  const release = () => {
    if (!drag) return;
    const { dx } = drag;
    drag = null;
    card.classList.remove("dragging");
    if (Math.abs(dx) > 110) return answer(dx > 0);
    card.style.transition = "transform .4s cubic-bezier(.3, 1.4, .5, 1)";
    card.style.transform = "";
    card.style.setProperty("--ok-o", 0);
    card.style.setProperty("--no-o", 0);
    if (Math.abs(dx) < 6) flipCard();
  };
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);
})();

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input")) return;
  if (!$("celebrate").hidden) {
    if (e.key === "Escape") closeCelebrate();
    return;
  }
  if ($("study").hidden) return;
  if (e.key === "Escape") closeStudy();
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    flipCard();
  }
  if (e.key === "ArrowRight") answer(true);
  if (e.key === "ArrowLeft") answer(false);
});

// --- Yozish mashqi ---
// en: o'zbekcha ko'rsatiladi, inglizchasi yoziladi; uz: inglizcha ko'rsatiladi, o'zbekchasi yoziladi.
// Progress kartochkalardan alohida: so'zni tanish va uni yoza olish — har xil daraja.

const WRITE_DIRS = {
  en: {
    label: "O'zbekcha → Inglizcha",
    short: "UZ → EN",
    desc: "Tarjimani ko'rib, inglizchasini yozasiz",
    ask: "Inglizchasini yozing",
    placeholder: "Inglizcha so'z…",
    prompt: (w) => w.translation,
    answer: (w) => w.term,
  },
  uz: {
    label: "Inglizcha → O'zbekcha",
    short: "EN → UZ",
    desc: "Inglizcha so'zni ko'rib, tarjimasini yozasiz",
    ask: "O'zbekchasini yozing",
    placeholder: "O'zbekcha tarjima…",
    prompt: (w) => w.term,
    answer: (w) => w.translation,
  },
};

function wstatus(dir, id) {
  const p = db.write[dir][id];
  if (!p || p.ok + p.no === 0) return "new";
  return p.last ? "ok" : "no";
}

function writeDueIds(dir, ids = Object.keys(db.write[dir]), now = Date.now()) {
  const prog = db.write[dir];
  return ids.filter((id) => WORDS.has(id) && prog[id] && prog[id].ok + prog[id].no > 0 && prog[id].next <= now).sort((a, b) => prog[a].next - prog[b].next);
}

const writeDueCount = () => writeDueIds("en").length + writeDueIds("uz").length;

/** verdict: "ok" | "typo" | "override" — to'g'ri; "hint" — yordam bilan; "no" | "skip" — xato */
function applyWrite(dir, id, verdict) {
  const p = db.write[dir][id] ?? { box: 1, next: 0, ok: 0, no: 0 };
  const fresh = p.ok + p.no === 0;
  if (verdict === "hint") {
    // Yordam bilan topilgan so'z qutisidan tushmaydi, lekin tez orada yana so'raladi
    Object.assign(p, { next: Date.now() + RETRY_MINUTES * 60 * 1000, last: false });
    p.no++;
  } else {
    const correct = ["ok", "typo", "override"].includes(verdict);
    Object.assign(p, nextState(p.box, correct, fresh), { last: correct });
    if (correct) p.ok++;
    else p.no++;
  }
  db.write[dir][id] = p;
  logAnswer();
  saveDb();
}

// Javobni solishtirish: katta-kichik harf, tutuq belgisi turlari (ʻ ’ `), chiziqcha va tinish belgilari farq qilmaydi
function normText(s) {
  return s
    .toLowerCase()
    .normalize("NFC")
    .replace(/[ʻʼ‘’`´]/g, "'")
    .replace(/\.\.\.|…/g, " ")
    .replace(/[-‐–—]/g, " ")
    .replace(/[.!?;:"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const stripArticle = (s) => s.replace(/^(to|a|an|the) /, "");

/** "aka, uka" -> aka | uka; "qiz (farzand)" -> qiz | qiz farzand; "child / children" -> child | children */
function answerVariants(text, dir) {
  const out = new Set();
  for (const base of [text.replace(/\([^)]*\)/g, " "), text.replace(/[()]/g, " ")]) {
    for (const part of base.split(/[,;/]/)) out.add(normText(part));
  }
  if (dir === "en") for (const v of [...out]) out.add(stripArticle(v));
  out.delete("");
  return [...out];
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Qisqa so'zda xatoga yo'l yo'q (son/sun), uzunroqda 1–2 harf xato "imlo xatosi" hisoblanadi
const typoLimit = (len) => (len <= 3 ? 0 : len <= 7 ? 1 : 2);
// Telefonda tutuq belgisi ko'pincha tushib qoladi: "ogil" ~ "o'g'il" — imlo xatosi, xato emas
const noApostrophe = (s) => s.replace(/'/g, "");

/** Lug'atdagi barcha to'g'ri javoblar: "good" — "food" ning imlo xatosi emas, boshqa so'z */
const knownCache = { en: null, uz: null, size: 0 };
function knownAnswers(dir) {
  if (knownCache.size !== WORDS.size) Object.assign(knownCache, { en: null, uz: null, size: WORDS.size });
  if (!knownCache[dir]) {
    knownCache[dir] = new Set();
    for (const w of WORDS.values()) for (const v of answerVariants(WRITE_DIRS[dir].answer(w), dir)) knownCache[dir].add(v);
  }
  return knownCache[dir];
}

/** { verdict: "ok" | "typo" | "no", best } — best: javobga eng yaqin to'g'ri variant */
function checkAnswer(input, target, dir, known = knownAnswers(dir)) {
  const variants = answerVariants(target, dir);
  const clean = (s) => (dir === "en" ? stripArticle(normText(s)) : normText(s));
  const judge = (part) => {
    let best = { d: Infinity, v: variants[0] };
    for (const v of variants) {
      const d = part === v ? 0 : editDistance(noApostrophe(part), noApostrophe(v)) + 0.5;
      if (d < best.d) best = { d, v };
    }
    if (best.d === 0) return { verdict: "ok", best: best.v };
    const typo = best.d - 0.5 <= typoLimit(noApostrophe(best.v).length) && !known.has(part);
    return { verdict: typo ? "typo" : "no", best: best.v };
  };
  if (clean(input) === clean(target)) return { verdict: "ok", best: normText(target) };
  // "uka, aka" kabi bir nechta javob: har bir qismi alohida to'g'ri variantga mos kelishi kerak
  const parts = input.split(/[,;/]/).map(clean).filter(Boolean);
  if (!parts.length) return { verdict: "no", best: variants[0] };
  const res = parts.map(judge);
  const verdict = res.some((r) => r.verdict === "no") ? "no" : res.some((r) => r.verdict === "typo") ? "typo" : "ok";
  return { verdict, best: res.map((r) => r.best).join(", ") };
}

/** To'g'ri javobni ko'rsatadi, foydalanuvchi adashgan harflarni belgilab */
function diffMarks(input, target) {
  const a = input, b = target;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const wrong = new Set();
  let i = a.length, j = b.length;
  while (j > 0) {
    if (i > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1]) wrong.add(j - 1);
      i--, j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) i--;
    else wrong.add(--j);
  }
  const frag = document.createDocumentFragment();
  [...b].forEach((ch, k) => frag.append(wrong.has(k) ? el("mark", "", ch) : ch));
  return frag;
}

/** Misol gapda so'z o'rniga bo'sh joy; so'z topilmasa null (gap javobni oshkor qilmasin) */
function clozeExample(example, term) {
  const base = term.split(/[\s/]+/)[0].replace(/[^a-z']/gi, "");
  const idx = base.length > 2 ? example.toLowerCase().indexOf(base.toLowerCase().slice(0, Math.max(3, base.length - 2))) : -1;
  if (idx < 0) return null;
  let end = idx;
  while (end < example.length && /[a-z'-]/i.test(example[end])) end++;
  const frag = document.createDocumentFragment();
  frag.append(example.slice(0, idx), el("span", "blank", " "), example.slice(end));
  return frag;
}

/** Yordam: javobning birinchi harflari, qolgani "_" — "f a _ _ _ _" */
function hintMask(answer, shown) {
  let k = 0;
  return [...answer].map((ch) => (/\s/.test(ch) ? "  " : k++ < shown ? ch : "_")).join(" ");
}

const write = { phase: "ask", hints: 0, verdict: null, input: "" };

function startWrite(ids, title, dir, pack = null, kind = "write") {
  if (!ids.length) return;
  Object.assign(session, { ids, i: 0, ok: 0, no: 0, results: new Map(), title, kind, pack, dir, busy: false });
  $("write").hidden = false;
  $("write-title").textContent = title;
  $("w-tally-ok").textContent = "0";
  $("w-tally-no").textContent = "0";
  document.body.style.overflow = "hidden";
  showWriteCard();
  icons();
}

/** Bo'lim uchun navbat: shu yo'nalishda vaqti kelganlar, keyin hali yozilmaganlar */
function startUnitWrite(pack, dir) {
  const ids = packIds.get(pack.level);
  let queue = [...writeDueIds(dir, ids), ...ids.filter((id) => wstatus(dir, id) === "new")];
  if (!queue.length) {
    queue = [...ids].sort(() => Math.random() - 0.5);
    toast("Bo'lim to'liq o'zlashtirilgan — qayta mashq rejimi");
  }
  startWrite(queue, `${unitNumber(pack)}. ${unitName(pack)} · yozish`, dir, pack);
}

function currentWord() {
  return WORDS.get(session.ids[session.i]);
}

function showWriteCard() {
  if (session.i >= session.ids.length) return finishWrite();
  const dir = WRITE_DIRS[session.dir];
  const w = currentWord();
  const p = db.write[session.dir][w.id];
  const pack = packByLevel.get(w.pack);
  Object.assign(write, { phase: "ask", hints: 0, verdict: null, input: "" });

  $("w-dir").textContent = dir.short;
  $("w-box").textContent = wstatus(session.dir, w.id) === "new" ? "Yangi" : `${p.box}-quti`;
  $("w-ask").textContent = dir.ask;
  $("w-prompt").textContent = dir.prompt(w);
  $("w-say").hidden = session.dir !== "uz";
  $("w-chip").textContent = pack ? pack.subtitle || pack.title : "Mening so'zim";
  const example = w.example ? (session.dir === "en" ? clozeExample(w.example, w.term) : highlight(w.example, w.term)) : null;
  $("w-example").replaceChildren(example || "");
  $("w-example").hidden = !example;

  const input = $("w-input");
  input.value = "";
  input.readOnly = false;
  input.className = "write-input";
  input.placeholder = dir.placeholder;
  input.lang = session.dir;
  $("w-hint").textContent = "";
  $("w-feedback").hidden = true;
  $("w-ask-actions").hidden = false;
  $("w-after-actions").hidden = true;

  $("write-count").textContent = `${session.i + 1}/${session.ids.length}`;
  $("write-bar").style.width = `${(session.i / session.ids.length) * 100}%`;

  const card = $("w-card");
  card.classList.remove("enter", "shake");
  void card.offsetWidth;
  card.classList.add("enter");
  input.focus({ preventScroll: true });
}

const FEEDBACK = {
  ok: { cls: "ok", icon: "circle-check", title: "To'g'ri!" },
  override: { cls: "ok", icon: "circle-check", title: "To'g'ri deb hisoblandi" },
  typo: { cls: "typo", icon: "spell-check", title: "Deyarli to'g'ri — imloga e'tibor bering" },
  hint: { cls: "typo", icon: "lightbulb", title: "Yordam bilan topdingiz — tez orada yana so'raladi" },
  no: { cls: "no", icon: "circle-x", title: "Noto'g'ri" },
  skip: { cls: "no", icon: "eye", title: "To'g'ri javob" },
};

function showFeedback() {
  const w = currentWord();
  const dir = WRITE_DIRS[session.dir];
  const { verdict, input, best } = write;
  const f = FEEDBACK[verdict];

  $("w-input").className = `write-input is-${f.cls}`;
  const box = $("w-feedback");
  box.className = `write-feedback ${f.cls}`;
  box.hidden = false;
  $("wf-head").replaceChildren(ic(f.icon), el("b", "", f.title));

  const yours = $("wf-yours");
  yours.hidden = !(verdict === "typo" || verdict === "no");
  if (verdict === "typo") yours.replaceChildren("Siz: ", el("s", "", input), "  →  ", diffMarks(normText(input), best));
  else if (verdict === "no") yours.replaceChildren("Siz: ", el("s", "", input));
  $("wf-answer").textContent = dir.answer(w);
  if (session.dir === "en" && w.example) $("w-example").replaceChildren(highlight(w.example, w.term));
  $("w-example").hidden = !w.example;

  $("w-ask-actions").hidden = true;
  $("w-after-actions").hidden = false;
  $("w-override").hidden = verdict !== "no";
  $("w-after-actions").classList.toggle("single", verdict !== "no");
  icons();
}

function checkWrite() {
  const raw = $("w-input").value.trim();
  if (!raw) {
    $("w-input").focus();
    return;
  }
  const w = currentWord();
  const res = checkAnswer(raw, WRITE_DIRS[session.dir].answer(w), session.dir);
  const verdict = res.verdict === "no" ? "no" : write.hints ? "hint" : res.verdict;
  revealWrite(verdict, raw, res.best);
}

function revealWrite(verdict, input = "", best = "") {
  if (write.phase !== "ask") return;
  Object.assign(write, { phase: "result", verdict, input, best });
  $("w-input").readOnly = true;
  $("w-input").focus({ preventScroll: true });
  const good = ["ok", "typo", "override"].includes(verdict);
  navigator.vibrate?.(good ? 12 : [20, 40, 20]);
  const flash = $("w-flash");
  flash.className = "flash";
  void flash.offsetWidth;
  flash.className = `flash ${good ? "ok" : "no"}`;
  if (!good) {
    const card = $("w-card");
    card.classList.remove("enter", "shake");
    void card.offsetWidth;
    card.classList.add("shake");
  }
  if (session.dir === "en") speak(currentWord().term);
  showFeedback();
}

function nextWrite() {
  if (write.phase !== "result") return;
  const id = session.ids[session.i];
  const good = ["ok", "typo", "override"].includes(write.verdict);
  applyWrite(session.dir, id, write.verdict);
  session.results.set(id, good);
  if (good) bump($("w-tally-ok"), ++session.ok);
  else bump($("w-tally-no"), ++session.no);
  session.i++;
  showWriteCard();
}

function closeWrite() {
  $("write").hidden = true;
  document.body.style.overflow = "";
  render();
}

function finishWrite() {
  $("write").hidden = true;
  celebrate();
}

function writeEnter() {
  if (write.phase === "ask") checkWrite();
  else nextWrite();
}
$("w-form").addEventListener("submit", (e) => {
  e.preventDefault();
  writeEnter();
});
// Enter ni o'zimiz ushlaymiz: natija holatida "Tekshirish" yashirin bo'lsa ham ishlashi uchun
$("w-input").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  writeEnter();
});
$("w-help").addEventListener("click", () => {
  const answer = answerVariants(WRITE_DIRS[session.dir].answer(currentWord()), session.dir).sort((a, b) => a.length - b.length)[0];
  const letters = answer.replace(/\s/g, "").length;
  if (write.hints >= letters - 1) return;
  write.hints++;
  $("w-hint").textContent = hintMask(answer, write.hints);
  $("w-input").focus();
});
$("w-skip").addEventListener("click", () => revealWrite("skip"));
$("w-override").addEventListener("click", () => {
  write.verdict = "override";
  showFeedback();
  $("w-input").focus();
});
$("w-next").addEventListener("click", nextWrite);
$("w-say").addEventListener("click", () => speak(currentWord().term));
$("write-close").addEventListener("click", closeWrite);
$("write").addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeWrite();
});

// --- Rejim tanlash oynasi ---

function openModes(title, sub, options) {
  $("mode-title").textContent = title;
  $("mode-sub").textContent = sub;
  $("mode-list").replaceChildren(
    ...options.map((o) => {
      const btn = el("button", "mode-opt");
      btn.type = "button";
      btn.disabled = !!o.disabled;
      const icon = el("span", "mode-ic");
      icon.append(ic(o.icon));
      const text = el("span", "mode-text");
      text.append(el("b", "", o.title), el("small", "", o.desc));
      if (o.meta) text.append(el("small", "mode-meta", o.meta));
      btn.append(icon, text, el("span", "mode-count", o.count));
      btn.addEventListener("click", () => {
        $("mode-sheet").hidden = true;
        o.run();
      });
      return btn;
    }),
  );
  $("mode-sheet").hidden = false;
  icons();
}

$("mode-sheet").addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) $("mode-sheet").hidden = true;
});

function openUnitWrite(pack) {
  const ids = packIds.get(pack.level);
  openModes(
    "Yozib mashq qilish",
    `${unitNumber(pack)}. ${unitName(pack)} · ${ids.length} so'z`,
    Object.entries(WRITE_DIRS).map(([key, d]) => {
      const due = writeDueIds(key, ids).length;
      const fresh = ids.filter((id) => wstatus(key, id) === "new").length;
      const learned = ids.filter((id) => wstatus(key, id) === "ok").length;
      return {
        icon: key === "en" ? "keyboard" : "pen-line",
        title: d.label,
        desc: d.desc,
        meta: `${learned}/${ids.length} o'zlashtirilgan${due ? ` · ${due} navbatda` : ""}`,
        count: due + fresh || "↻",
        run: () => startUnitWrite(pack, key),
      };
    }),
  );
}

$("unit-write").addEventListener("click", () => openUnitWrite(route.pack));

// --- Tabrik ---

function finishSession() {
  $("study").hidden = true;
  celebrate();
}

// Harflar so'z ichida guruhlanadi: tor ekranda sarlavha so'z o'rtasidan bo'linmasin
function splitLetters(node, text) {
  let l = 0;
  const parts = [];
  text.split(" ").forEach((word, k) => {
    if (k) {
      const space = el("span", "space", "\u00a0");
      space.style.setProperty("--l", l++);
      parts.push(space);
    }
    const wrap = el("span", "word");
    for (const ch of word) {
      const span = el("span", "", ch);
      span.style.setProperty("--l", l++);
      wrap.append(span);
    }
    parts.push(wrap);
  });
  node.replaceChildren(...parts);
}

function tagList(ids) {
  return ids.map((id) => {
    const w = WORDS.get(id);
    const tag = el("span", "", w.term + " ");
    tag.append(el("i", "", w.translation));
    return tag;
  });
}

function celebrate() {
  const total = session.ok + session.no;
  const pct = total ? Math.round((session.ok / total) * 100) : 0;
  const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
  const pack = session.pack;
  const writing = session.kind.startsWith("write");
  $("cel-ok-label").textContent = writing ? "to'g'ri" : "bilaman";
  $("cel-no-label").textContent = writing ? "xato" : "bilmayman";

  $("cel-ribbon").textContent = !pack ? "Takrorlash tugadi" : writing ? `${unitNumber(pack)}-bo'lim · yozish` : `${unitNumber(pack)}-bo'lim tugallandi`;
  const title = ["Yaxshi boshlanish!", "Zo'r ish!", "Mukammal!"][stars - 1];
  const titleNode = $("cel-title");
  titleNode.classList.toggle("wave", stars === 3);
  splitLetters(titleNode, title);
  $("cel-sub").textContent = !pack ? `${total} ta so'z ${writing ? "yozildi" : "takrorlandi"}` : `${unitName(pack)} — ${total} ta so'z`;

  $("cel-stars").replaceChildren(...[0, 1, 2].map((k) => ic("star", k < stars ? "lit" : "")));
  $("cel-ok").dataset.value = 0;
  $("cel-no").dataset.value = 0;
  $("cel-pct").dataset.value = 0;
  setTimeout(() => {
    countTo($("cel-ok"), session.ok);
    countTo($("cel-no"), session.no);
    countTo($("cel-pct"), pct, "%");
  }, reduceMotion ? 0 : 1900);
  $("cel-ok").textContent = "0";
  $("cel-no").textContent = "0";
  $("cel-pct").textContent = "0%";

  const known = [...session.results].filter(([, v]) => v).map(([id]) => id);
  const unknown = [...session.results].filter(([, v]) => !v).map(([id]) => id);
  $("cel-no-wrap").hidden = !unknown.length;
  $("cel-ok-wrap").hidden = !known.length;
  $("cel-no-list").replaceChildren(...tagList(unknown));
  $("cel-ok-list").replaceChildren(...tagList(known));

  $("cel-retry").hidden = !unknown.length || (!pack && !writing);
  $("cel-retry").onclick = () => {
    closeCelebrate(false);
    if (writing) startWrite(unknown, `${session.title} · xatolar`, session.dir, pack, session.kind);
    else startRetry(pack, unknown);
  };

  const book = pack && bookOf.get(pack.level);
  const nextP = book && book.packs[book.packs.indexOf(pack) + 1];
  $("cel-next").hidden = !nextP || session.kind === "review" || session.kind === "write-review";
  $("cel-next").onclick = () => {
    closeCelebrate(false);
    go(`#/unit/${nextP.level}`);
    if (writing) startUnitWrite(nextP, session.dir);
    else startUnit(nextP);
  };
  $("cel-close").replaceChildren(ic(pack ? "layers" : "house"), el("span", "", pack ? "Bo'limlarga" : "Bosh sahifa"));
  $("cel-close").onclick = () => {
    closeCelebrate(false);
    go(book ? `#/book/${book.id}` : "#/");
  };

  const cel = $("celebrate");
  cel.hidden = false;
  cel.scrollTop = 0;
  icons();
  fireworks(stars);
}

function closeCelebrate(rerender = true) {
  $("celebrate").hidden = true;
  fxStop = true;
  document.body.style.overflow = "";
  if (rerender) render();
}

// Mushaklar, konfetti to'plari va medal atrofidagi oltin uchqunlar (canvas)
let fxStop = false;

function fireworks(stars) {
  if (reduceMotion) return;
  fxStop = false;
  const canvas = $("fx");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const COLORS = ["#8b6cff", "#ff5ca8", "#ffb347", "#22d39a", "#4cc2ff", "#ffd23f", "#ffffff"];
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const parts = [];
  const rockets = [];

  const confettiCannon = (x, dir) => {
    for (let k = 0; k < 90; k++) {
      const angle = -Math.PI / 2 + dir * (0.25 + Math.random() * 0.45);
      const speed = 10 + Math.random() * 12;
      parts.push({ kind: "confetti", x, y: H + 10, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 6 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, color: pick(COLORS), life: 1, tilt: Math.random() * 6 });
    }
  };

  const burst = (x, y, color, count = 70, power = 6) => {
    for (let k = 0; k < count; k++) {
      const angle = (Math.PI * 2 * k) / count + Math.random() * 0.1;
      const speed = power * (0.5 + Math.random() * 0.6);
      parts.push({ kind: "spark", x, y, px: x, py: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color: Math.random() < 0.25 ? "#ffffff" : color, life: 1, decay: 0.012 + Math.random() * 0.012 });
    }
  };

  const launch = () => {
    const x = W * (0.15 + Math.random() * 0.7);
    rockets.push({ x, y: H, px: x, py: H, vx: (Math.random() - 0.5) * 2, vy: -(H * 0.016 + Math.random() * 4), color: pick(COLORS), target: H * (0.12 + Math.random() * 0.3) });
  };

  // Ssenariy: konfetti to'plari -> medal atrofida oltin portlash -> mushaklar seriyasi
  confettiCannon(0, 1);
  confettiCannon(W, -1);
  setTimeout(() => !fxStop && burst(W / 2, Math.min(170, H * 0.25), "#ffc53d", 60, 7), 650);
  const shots = 4 + stars * 3;
  for (let k = 0; k < shots; k++) setTimeout(() => !fxStop && launch(), 900 + k * 420);
  setTimeout(() => {
    if (fxStop || stars < 3) return;
    confettiCannon(0, 1);
    confettiCannon(W, -1);
  }, 2600);

  const start = performance.now();
  const frame = (t) => {
    if (fxStop) {
      ctx.clearRect(0, 0, W, H);
      return;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    for (let k = rockets.length - 1; k >= 0; k--) {
      const r = rockets[k];
      r.px = r.x;
      r.py = r.y;
      r.x += r.vx;
      r.y += r.vy;
      r.vy += 0.12;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r.px, r.py + 10);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
      if (r.y <= r.target || r.vy >= 0) {
        burst(r.x, r.y, r.color);
        rockets.splice(k, 1);
      }
    }

    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      if (p.kind === "spark") {
        p.px = p.x;
        p.py = p.y;
        p.vx *= 0.97;
        p.vy = p.vy * 0.97 + 0.08;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.x += p.vx + Math.sin(p.tilt += 0.1) * 0.6;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > H + 40) p.life = 0;
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.tilt)));
        ctx.restore();
      }
      if (p.life <= 0) parts.splice(k, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    if (parts.length || rockets.length || t - start < 900 + shots * 420 + 400) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
}

// --- Lug'at ---

let wordFilter = "all";
const WORD_LIMIT = 120;

function renderWords() {
  const query = $("search").value.trim().toLowerCase();
  const now = Date.now();
  const match = (w) => {
    const st = status(w.id);
    if (wordFilter === "ok" && st !== "ok") return false;
    if (wordFilter === "no" && st !== "no") return false;
    if (wordFilter === "new" && st !== "new") return false;
    if (wordFilter === "due" && !isDue(w.id, now)) return false;
    if (wordFilter === "mine" && w.pack) return false;
    return !query || w.term.toLowerCase().includes(query) || w.translation.toLowerCase().includes(query);
  };

  const words = [...WORDS.values()].filter(match);
  $("words-meta").textContent = words.length > WORD_LIMIT
    ? `${words.length} ta so'z · birinchi ${WORD_LIMIT} tasi ko'rsatilgan, qidiruvdan foydalaning`
    : `${words.length} ta so'z`;
  $("word-list").replaceChildren(...words.slice(0, WORD_LIMIT).map(wordRow));
}

$("search").addEventListener("input", () => {
  renderWords();
  icons();
});
$("filters").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-filter]");
  if (!chip) return;
  wordFilter = chip.dataset.filter;
  document.querySelectorAll("#filters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderWords();
  icons();
});

// --- So'z qo'shish ---

function openSheet() {
  $("sheet").hidden = false;
  setTimeout(() => $("add-form").term.focus(), 100);
}

$("open-add").addEventListener("click", openSheet);
$("sheet").addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) $("sheet").hidden = true;
});

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const term = form.term.value.trim();
  const translation = form.translation.value.trim();
  const example = form.example.value.trim() || undefined;
  if (!term || !translation) return;

  const key = term.toLowerCase();
  if ([...WORDS.values()].some((w) => w.term.toLowerCase() === key)) {
    toast("Bu so'z lug'atda allaqachon bor");
    return;
  }
  const id = `u:${key}`;
  db.custom[id] = { term, translation, example };
  saveDb();
  buildIndex();
  toast(`Qo'shildi: ${term} — ${translation}`);
  form.reset();
  $("sheet").hidden = true;
  render();
});

// --- Statistika ---

const WEEKDAYS = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];

function renderStats() {
  const s = getStats();
  countTo($("st-streak"), s.streak);
  countTo($("st-due"), s.due);
  countTo($("st-known"), s.known);
  countTo($("st-unknown"), s.unknown);

  const days = Array.from({ length: 7 }, (_, k) => {
    const d = new Date(Date.now() - (6 - k) * DAY_MS);
    return { label: WEEKDAYS[d.getDay()], count: db.history[dayKey(d)] || 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  $("week").replaceChildren(
    ...days.map((d) => {
      const col = el("div", "day");
      const bar = el("div", d.count ? "day-bar" : "day-bar empty");
      requestAnimationFrame(() => (bar.style.height = `${Math.max(4, (d.count / max) * 110)}px`));
      col.append(el("b", "", d.count || ""), bar, el("small", "", d.label));
      return col;
    }),
  );

  const bmax = Math.max(1, ...Object.values(s.boxes));
  const rows = [];
  for (let i = 1; i <= MAX_BOX; i++) {
    const row = el("div", "box-row");
    const track = el("div", "box-track");
    const fill = el("div", "box-fill");
    fill.style.background = `var(--box-${i})`;
    track.append(fill);
    setWidth(fill, s.boxes[i] / bmax);
    row.append(el("span", "", `${i}-quti`), track, el("span", "box-count", s.boxes[i]));
    rows.push(row);
  }
  $("boxes").replaceChildren(...rows);

  $("write-stats").replaceChildren(
    ...Object.entries(WRITE_DIRS).map(([key, d]) => {
      const list = Object.entries(db.write[key]).filter(([id, p]) => WORDS.has(id) && p.ok + p.no > 0);
      const learned = list.filter(([id]) => wstatus(key, id) === "ok").length;
      const ok = list.reduce((n, [, p]) => n + p.ok, 0);
      const answers = list.reduce((n, [, p]) => n + p.ok + p.no, 0);
      const card = el("div", "ws-card glass");
      const head = el("div", "ws-head");
      head.append(ic(key === "en" ? "keyboard" : "pen-line"), el("b", "", d.label));
      const nums = el("div", "ws-nums");
      for (const [value, label] of [[learned, "o'zlashtirilgan"], [writeDueIds(key).length, "navbatda"], [answers ? `${Math.round((ok / answers) * 100)}%` : "—", "aniqlik"]]) {
        const cell = el("div");
        cell.append(el("b", "", String(value)), el("small", "", label));
        nums.append(cell);
      }
      card.append(head, nums);
      return card;
    }),
  );
}

// --- Zaxira nusxa ---

// Zaxira PDF: o'qish uchun hisobot + "Tiklash" uchun db fayl oxirida (%%EOF dan keyin) PDF izohi sifatida.
// PDF o'quvchilar %%EOF dan keyingi izohni e'tiborsiz qoldiradi.
const PDF_DATA_MARK = "%VOCAB-DATA:";

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

// Standart PDF shrifti (WinAnsi) ʻ ʼ kabi belgilarni chiqara olmaydi
const pdfText = (s) => String(s ?? "").replace(/[ʻʼ‘’`]/g, "'");

const PDF_AUTHOR = "Xolboyev Javohir";
const STATUS_LABEL = { ok: "bilaman", no: "bilmayman" };
const PDF_COLOR = {
  ink: [15, 23, 42],
  muted: [100, 116, 139],
  line: [226, 232, 240],
  soft: [241, 245, 249],
  zebra: [248, 250, 252],
  navy: [30, 58, 138],
  accent: [37, 99, 235],
  sky: [14, 165, 233],
  teal: [20, 184, 166],
  ok: [5, 150, 105],
  no: [220, 38, 38],
  box: [null, [165, 216, 250], [125, 211, 252], [56, 189, 248], [14, 165, 233], [37, 99, 235], [29, 78, 216], [30, 58, 138]],
};
const BOOK_COLOR = { evu: PDF_COLOR.accent, basic: PDF_COLOR.teal };

function buildPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const C = PDF_COLOR;
  const s = getStats();
  const now = Date.now();
  const left = 15, right = 195, width = right - left, bottom = 276;
  let y = 0;

  const fill = (c) => doc.setFillColor(...c);
  const ink = (c) => doc.setTextColor(...c);
  const font = (style, size) => doc.setFont("helvetica", style).setFontSize(size);
  const fit = (text, w) => doc.splitTextToSize(pdfText(text), w)[0] || "";

  // to'q ko'k -> osmon -> firuza gradient
  const gradient = (x, gy, w, h) => {
    const stops = [C.navy, C.sky, C.teal];
    const steps = 80;
    for (let i = 0; i < steps; i++) {
      const t = (i / (steps - 1)) * 2;
      const [a, b] = t < 1 ? [stops[0], stops[1]] : [stops[1], stops[2]];
      const k = t < 1 ? t : t - 1;
      fill(a.map((v, j) => Math.round(v + (b[j] - v) * k)));
      doc.rect(x + (i * w) / steps, gy, w / steps + 0.4, h, "F");
    }
  };

  const newPage = () => {
    doc.addPage();
    gradient(0, 0, 210, 3);
    y = 16;
  };
  const ensure = (h) => {
    if (y + h <= bottom) return false;
    newPage();
    return true;
  };
  const heading = (text, sub) => {
    ensure(18);
    y += 6;
    font("bold", 14);
    ink(C.ink);
    doc.text(text, left, y);
    if (sub) {
      font("normal", 9);
      ink(C.muted);
      doc.text(sub, right, y, { align: "right" });
    }
    fill(C.accent);
    doc.roundedRect(left, y + 2, 12, 1.2, 0.6, 0.6, "F");
    y += 9;
  };
  const bar = (x, by, w, h, ratio, color) => {
    fill(C.line);
    doc.roundedRect(x, by, w, h, h / 2, h / 2, "F");
    if (ratio > 0) {
      fill(color);
      doc.roundedRect(x, by, Math.max(h, w * Math.min(ratio, 1)), h, h / 2, h / 2, "F");
    }
  };

  // --- Sarlavha ---
  gradient(0, 0, 210, 46);
  ink([255, 255, 255]);
  font("bold", 8.5);
  doc.text("VOCAB  ·  LEITNER TIZIMI", left, 14);
  font("bold", 24);
  doc.text("O'rganish hisoboti", left, 27);
  font("normal", 10);
  doc.text(`Sana: ${dayKey()}   ·   ${Object.keys(db.progress).length} ta so'z progressi`, left, 36);
  y = 56;

  // --- Kartochkalar ---
  const cards = [
    ["Streak", `${s.streak} kun`, C.teal],
    ["Bilaman", s.known, C.ok],
    ["Bilmayman", s.unknown, C.no],
    ["Navbatda", s.due, C.sky],
    ["Yodlangan", s.mastered, C.navy],
  ];
  const gap = 4, cw = (width - gap * (cards.length - 1)) / cards.length;
  cards.forEach(([label, value, color], i) => {
    const x = left + i * (cw + gap);
    fill(C.soft);
    doc.roundedRect(x, y, cw, 24, 3, 3, "F");
    fill(color);
    doc.roundedRect(x + 4, y + 5, 6, 1.6, 0.8, 0.8, "F");
    font("bold", 17);
    ink(C.ink);
    doc.text(String(value), x + 4, y + 15);
    font("normal", 8.5);
    ink(C.muted);
    doc.text(label, x + 4, y + 20.5);
  });
  y += 32;

  // --- So'nggi 7 kun va qutilar ---
  const pw = (width - 6) / 2, ph = 60;
  for (const px of [left, left + pw + 6]) {
    fill(C.soft);
    doc.roundedRect(px, y, pw, ph, 3, 3, "F");
  }
  font("bold", 11);
  ink(C.ink);
  doc.text("So'nggi 7 kun", left + 5, y + 8);
  doc.text("Leitner qutilari", left + pw + 11, y + 8);
  font("normal", 8.5);
  ink(C.muted);
  doc.text(`Bugun: ${s.today} / ${DAILY_GOAL}`, left + pw - 5, y + 8, { align: "right" });

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    days.push({ label: WEEKDAYS[d.getDay()], n: db.history[dayKey(d)] || 0, today: i === 0 });
  }
  const dmax = Math.max(DAILY_GOAL, ...days.map((d) => d.n));
  const chartH = 32, base = y + 50, slot = (pw - 10) / 7, bw = 6;
  // kunlik maqsad chizig'i
  const goalY = base - (DAILY_GOAL / dmax) * chartH;
  doc.setDrawColor(...C.line).setLineWidth(0.3).setLineDashPattern([1, 1], 0);
  doc.line(left + 5, goalY, left + pw - 5, goalY);
  doc.setLineDashPattern([], 0);
  days.forEach((d, i) => {
    const x = left + 5 + i * slot + (slot - bw) / 2;
    const h = (d.n / dmax) * chartH;
    fill(C.line);
    doc.roundedRect(x, base - chartH, bw, chartH, 1.5, 1.5, "F");
    if (d.n > 0) {
      fill(d.today ? C.sky : C.accent);
      doc.roundedRect(x, base - Math.max(h, 3), bw, Math.max(h, 3), 1.5, 1.5, "F");
    }
    font(d.today ? "bold" : "normal", 7.5);
    ink(d.today ? C.ink : C.muted);
    doc.text(d.label, x + bw / 2, base + 5, { align: "center" });
    if (d.n > 0) doc.text(String(d.n), x + bw / 2, base - Math.max(h, 3) - 1.5, { align: "center" });
  });

  const bmax = Math.max(1, ...Object.values(s.boxes));
  for (let i = 1; i <= MAX_BOX; i++) {
    const ry = y + 16 + (i - 1) * ((ph - 22) / (MAX_BOX - 1));
    const bx = left + pw + 11;
    font("normal", 9);
    ink(C.ink);
    doc.text(`${i}-quti`, bx, ry + 2);
    bar(bx + 16, ry - 0.2, pw - 38, 3, s.boxes[i] / bmax, C.box[i]);
    font("bold", 9);
    doc.text(String(s.boxes[i]), left + 2 * pw + 1, ry + 2, { align: "right" });
  }
  y += ph + 4;

  // --- Kitoblar ---
  heading("Kitoblar", "ma'lumot qaysi kitob so'zlari asosida");
  for (const book of BOOKS.filter((b) => !b.soon)) {
    ensure(30);
    const b = bookStats(book);
    const color = BOOK_COLOR[book.id] || C.accent;
    fill(C.soft);
    doc.roundedRect(left, y, width, 26, 3, 3, "F");
    fill(color);
    doc.roundedRect(left, y, 2.5, 26, 1.2, 1.2, "F");
    font("bold", 12);
    ink(C.ink);
    doc.text(pdfText(book.title), left + 7, y + 8);
    font("normal", 8.5);
    ink(C.muted);
    doc.text(pdfText(`${book.level}  ·  ${book.author}`), left + 7, y + 13.5);
    const pct = b.total ? Math.round((b.studied / b.total) * 100) : 0;
    font("bold", 16);
    ink(color);
    doc.text(`${pct}%`, right - 5, y + 10, { align: "right" });
    bar(left + 7, y + 17, width - 14, 2.4, b.total ? b.studied / b.total : 0, color);
    font("normal", 8);
    ink(C.muted);
    doc.text(`${b.studied} / ${b.total} so'z o'rganilgan`, left + 7, y + 23.5);
    doc.text(`${b.unitsDone} / ${b.units} bo'lim tugallangan`, right - 5, y + 23.5, { align: "right" });
    y += 30;
  }

  // --- So'zlar: kitob -> bo'lim bo'yicha ---
  const groups = [];
  for (const book of BOOKS) {
    const units = book.packs
      .map((p) => ({ pack: p, ids: packIds.get(p.level).filter((id) => status(id) !== "new") }))
      .filter((u) => u.ids.length);
    if (units.length) groups.push({ title: book.title, color: BOOK_COLOR[book.id] || C.accent, units });
  }
  const own = Object.keys(db.custom).filter((id) => WORDS.has(id) && status(id) !== "new");
  if (own.length) groups.push({ title: "O'z so'zlarim", color: C.sky, units: [{ pack: null, ids: own }] });
  const total = groups.reduce((n, g) => n + g.units.reduce((m, u) => m + u.ids.length, 0), 0);

  const cols = [
    ["So'z", 3, 50],
    ["Tarjima", 54, 62],
    ["Quti", 118, 16],
    ["Holat", 136, 24],
    ["Keyingi", 160, 20],
  ];
  const colHeader = () => {
    font("bold", 7.5);
    ink(C.muted);
    for (const [title, x] of cols) doc.text(title.toUpperCase(), left + x, y);
    y += 3.5;
  };

  ensure(total ? 70 : 30); // sarlavha birinchi jadvaldan ajralib qolmasin
  heading("O'rganilgan so'zlar", `${total} ta so'z`);
  if (!total) {
    font("normal", 10);
    ink(C.muted);
    doc.text("Hali so'z o'rganilmagan.", left, y);
    y += 8;
  }
  for (const g of groups) {
    ensure(42);
    y += 5;
    font("bold", 11.5);
    ink(g.color);
    doc.text(pdfText(g.title), left, y);
    doc.setDrawColor(...g.color).setLineWidth(0.4);
    doc.line(left, y + 2, right, y + 2);
    y += 7;
    for (const u of g.units) {
      // bo'lim sarlavhasi sahifa oxirida yolg'iz qolmasin: kamida 3 qator sig'sin
      ensure(34);
      fill(C.soft);
      doc.roundedRect(left, y, width, 7.5, 2, 2, "F");
      font("bold", 9.5);
      ink(C.ink);
      const name = u.pack ? `${u.pack.title}  —  ${u.pack.subtitle}` : "Qo'shilgan so'zlar";
      doc.text(fit(name, width - 30), left + 3, y + 5);
      font("normal", 8.5);
      ink(C.muted);
      doc.text(`${u.ids.length} ta so'z`, right - 3, y + 5, { align: "right" });
      y += 12;
      colHeader();
      u.ids.forEach((id, i) => {
        if (ensure(6)) colHeader();
        const w = WORDS.get(id);
        const p = db.progress[id];
        const st = status(id);
        if (i % 2) {
          fill(C.zebra);
          doc.rect(left, y - 0.5, width, 6, "F");
        }
        const ty = y + 3.6;
        font("bold", 9);
        ink(C.ink);
        doc.text(fit(w.term, cols[0][2] - 2), left + cols[0][1], ty);
        font("normal", 9);
        doc.text(fit(w.translation, cols[1][2] - 2), left + cols[1][1], ty);
        fill(C.box[p.box]);
        doc.circle(left + cols[2][1] + 1.2, ty - 1.1, 1.2, "F");
        doc.text(String(p.box), left + cols[2][1] + 4, ty);
        font("bold", 8.5);
        ink(st === "ok" ? C.ok : C.no);
        doc.text(STATUS_LABEL[st], left + cols[3][1], ty);
        font("normal", 8.5);
        ink(p.next <= now ? C.sky : C.muted);
        doc.text(p.next <= now ? "hozir" : dayKey(new Date(p.next)), left + cols[4][1], ty);
        y += 6;
      });
      y += 4;
    }
  }

  // --- Imzo ---
  ensure(38);
  y += 4;
  fill(C.soft);
  doc.roundedRect(left, y, width, 34, 3, 3, "F");
  font("bold", 10);
  ink(C.ink);
  doc.text("Hisobot haqida", left + 6, y + 9);
  font("normal", 8.5);
  ink(C.muted);
  const used = groups.map((g) => g.title).join(", ") || "-";
  const about = doc.splitTextToSize(
    pdfText(`Ushbu hisobot Vocab ilovasida Leitner tizimi bo'yicha to'plangan progress asosida tayyorlandi. Manba: ${used}.`),
    95
  );
  doc.text(about, left + 6, y + 15);
  const sx = right - 62;
  font("normal", 8.5);
  doc.text("Tayyorlab berdi:", sx, y + 9);
  doc.setFont("times", "bolditalic").setFontSize(20);
  ink(C.accent);
  doc.text(PDF_AUTHOR, sx, y + 21);
  doc.setDrawColor(...C.ink).setLineWidth(0.3);
  doc.line(sx, y + 24, right - 6, y + 24);
  font("normal", 8);
  ink(C.muted);
  doc.text("Imzo", sx, y + 29);
  doc.text(dayKey(), right - 6, y + 29, { align: "right" });

  // --- Pastki qism ---
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...C.line).setLineWidth(0.3);
    doc.line(left, 284, right, 284);
    font("normal", 8);
    ink(C.muted);
    doc.text("Vocab  ·  O'rganish hisoboti", left, 289);
    doc.text(`${i} / ${pages}`, right, 289, { align: "right" });
  }

  const pdf = new Uint8Array(doc.output("arraybuffer"));
  const tail = new TextEncoder().encode(`\n${PDF_DATA_MARK}${toBase64(JSON.stringify(db))}\n`);
  return new Blob([pdf, tail], { type: "application/pdf" });
}

/** Zaxira faylidan db: PDF (ichiga yashirilgan) yoki eski JSON */
function readBackup(text) {
  if (!text.startsWith("%PDF")) return JSON.parse(text);
  const at = text.lastIndexOf(PDF_DATA_MARK);
  if (at < 0) throw new Error("PDF ichida zaxira yo'q");
  return JSON.parse(fromBase64(text.slice(at + PDF_DATA_MARK.length).trim()));
}

$("export").addEventListener("click", () => {
  let blob;
  try {
    blob = buildPdf();
  } catch {
    toast("PDF yaratib bo'lmadi");
    return;
  }
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `vocab-zaxira-${dayKey()}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("import").addEventListener("click", () => $("import-file").click());

$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try {
    data = normalize(readBackup(await file.text()));
  } catch {
    toast("Fayl noto'g'ri");
    return;
  }
  if (!confirm("Hozirgi progress zaxiradagi bilan almashtiriladi. Davom etasizmi?")) return;
  db = data;
  saveDb();
  buildIndex();
  render();
  toast(`Tiklandi: ${Object.keys(db.progress).length} ta so'z progressi`);
});

// --- Boshlash ---

loadDb();
buildIndex();
onRoute();
if (!storageOk) toast("Brauzer xotirasi yopiq: progress saqlanmaydi.");
