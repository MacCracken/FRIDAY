// Headless full-stack UI integration check.
//
// Loads the REAL cyrius-emitted web/app.js into a minimal DOM + fetch shim
// pointed at a running build/yeo-cy-test, then DRIVES the rendered dashboard
// (list / add / open detail / edit / delete) and asserts both the rendered DOM
// and the backend agree. Proves the whole stack comes together:
//   web/app.tsx --(cyrius --target=js)--> web/app.js --> browser JS
//   --> fetch --> sandhi router --> patra --> JSON --> JSX render.
//
// Run from the project root (after ./build.sh):  node tests/ui_check.mjs
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const BASE = "http://127.0.0.1:8080";
const pass = [], fail = [];
const ok = (n) => { pass.push(n); console.log(`  \x1b[32mPASS\x1b[0m ${n}`); };
const bad = (n, why = "") => { fail.push([n, why]); console.log(`  \x1b[31mFAIL\x1b[0m ${n}  ${why}`); };
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// ── minimal DOM shim (covers exactly what the h() runtime + app use) ──
function mkEl(tag) {
  return {
    tag, nodeType: 1, className: "", value: "",
    attrs: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    append(...xs) { for (const x of xs) this.children.push(x); },
    replaceChildren(...xs) { this.children = xs.slice(); },
  };
}
const appEl = mkEl("div"); appEl.attrs.id = "app";
function findById(n, id) {
  if (!n || n.nodeType !== 1) return null;
  if (n.attrs && n.attrs.id === id) return n;
  for (const c of n.children) { const r = findById(c, id); if (r) return r; }
  return null;
}
const documentShim = { createElement: mkEl, getElementById: (id) => findById(appEl, id) };
const windowShim = { listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; } };
let _hash = "#/";
const locationShim = {
  get hash() { return _hash; },
  set hash(v) { _hash = v; const f = windowShim.listeners.hashchange; if (f) f(); },
};
const fetchShim = (url, init) => fetch(url.startsWith("http") ? url : BASE + url, init);

// ── tree query helpers ──
function text(n) {
  if (typeof n === "string") return n;
  if (!n || !n.children) return "";
  return n.children.map(text).join("");
}
function findAll(n, pred, acc = []) {
  if (n && n.nodeType === 1) {
    if (pred(n)) acc.push(n);
    for (const c of n.children) findAll(c, pred, acc);
  }
  return acc;
}
const byClass = (root, cls) => findAll(root, (n) => (n.className || "").split(" ").indexOf(cls) >= 0);
const byTag = (root, tag) => findAll(root, (n) => n.tag === tag);
const fire = (el, ev, evt = {}) => (el && el.listeners[ev] ? el.listeners[ev]({ preventDefault() {}, ...evt }) : undefined);

async function waitReady(t = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch {}
    await tick(50);
  }
  return false;
}

// ── run ──
const srv = spawn("./build/yeo-cy-test", { stdio: "ignore" });
let code = 1;
try {
  if (!await waitReady()) throw new Error("server not ready on :8080");

  // install shims and load the REAL emitted bundle
  const src = readFileSync("web/app.js", "utf8");
  // eslint-disable-next-line no-new-func
  new Function("document", "window", "location", "fetch", src)(documentShim, windowShim, locationShim, fetchShim);
  await tick(); // initial route() (home) settles

  const marker = "ui-" + Math.floor(Date.now() / 1000) + "-" + Math.floor(Math.random() * 1e6);

  // 1. list view renders (add form present)
  locationShim.hash = "#/notes";
  await tick(100);
  const addForm = byClass(appEl, "addform")[0];
  (addForm ? ok : bad)("1. #/notes renders the add form (GET list)");

  // 2. add a note through the form -> appears in the list (POST + re-render)
  const input = documentShim.getElementById("b");
  if (input) input.value = marker;
  await fire(byClass(appEl, "addform")[0], "submit");
  await tick(120);
  const rowA = byClass(appEl, "body").find((a) => text(a) === marker);
  (rowA ? ok : bad)(`2. add note via form -> rendered in list (POST) [${marker}]`);
  const newId = rowA ? parseInt((rowA.attrs.href || "").slice(8), 10) : -1;
  (newId > 0 ? ok : bad)(`3. rendered note links to #/notes/${newId} (id from POST echo)`);

  // 4. open the detail route -> GET /api/notes/:id, edit form prefilled
  locationShim.hash = `#/notes/${newId}`;
  await tick(100);
  const editInput = documentShim.getElementById("edit");
  (editInput && editInput.value === marker ? ok : bad)("4. #/notes/:id detail loads (GET by id), edit prefilled");
  const title = byTag(appEl, "h1")[0];
  (title && text(title) === `Note #${newId}` ? ok : bad)("4b. detail shows Note #id");

  // 5. edit via the detail form -> PUT, list shows the new body
  const edited = marker + "-edited";
  if (editInput) editInput.value = edited;
  await fire(byClass(appEl, "editform")[0], "submit");
  await tick(150); // onSave PUTs then sets location.hash=#/notes -> re-render
  const rowE = byClass(appEl, "body").find((a) => text(a) === edited);
  (rowE ? ok : bad)("5. edit via detail form -> updated body in list (PUT)");
  // cross-check the backend actually holds the edit
  const beNote = await (await fetch(`${BASE}/api/notes/${newId}`)).json();
  (beNote.body === edited ? ok : bad)("5b. backend reflects the edit (UI<->patra agree)");

  // 6. delete via the row button -> DELETE, gone from list + backend
  const delRow = byClass(appEl, "note").find((li) => (byClass(li, "body")[0] && text(byClass(li, "body")[0]) === edited));
  await fire(byClass(delRow, "del")[0], "click");
  await tick(150);
  const stillThere = byClass(appEl, "body").some((a) => text(a) === edited);
  (!stillThere ? ok : bad)("6. delete via row button -> gone from list (DELETE)");
  const beStatus = (await fetch(`${BASE}/api/notes/${newId}`)).status;
  (beStatus === 404 ? ok : bad)(`6b. backend 404s the deleted note (UI<->patra agree, got ${beStatus})`);

  // 7. XSS-safety: a note body with HTML/script renders as a single TEXT node —
  // the h() runtime appends String(x) (never innerHTML), so user content is never
  // parsed as markup. (Backend storage injection-safety is covered by verify.py.)
  const xss = `<img src=x onerror=alert(1)> & <b>${marker}</b>`;
  await fetchShim("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: xss }) });
  locationShim.hash = "#/notes";
  await tick(120);
  const xrow = byClass(appEl, "body").find((a) => text(a) === xss);
  const oneTextChild = !!xrow && xrow.children.length === 1 && typeof xrow.children[0] === "string";
  (oneTextChild ? ok : bad)("7. HTML/script note body renders as a single text node (XSS-safe by construction)");

  code = fail.length ? 1 : 0;
} catch (e) {
  bad("harness", String(e && e.message || e));
} finally {
  srv.kill();
}

console.log(`\n=== ${pass.length} passed, ${fail.length} failed ===`);
for (const [n, why] of fail) console.log(`  FAILED: ${n} ${why}`);
process.exit(code);
