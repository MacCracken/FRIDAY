function h(t, p, ...c) {
  if (typeof t === "function") return t(Object.assign({}, p, { children: c }));
  const e = document.createElement(t);
  for (const k in (p || {})) {
    const v = p[k];
    if (k === "className") e.className = v;
    else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in e) e[k] = v;
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  const add = (x) => { if (x == null || x === false || x === true) return; if (Array.isArray(x)) x.forEach(add); else e.append(x.nodeType ? x : String(x)); };
  c.forEach(add);
  return e;
}

const api = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json());
};
async function listNotes() {
  return api("/api/notes");
}
async function addNote(body) {
  return api("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
}
function Header(active) {
  const cls = (name) => (name === active ? "tab active" : "tab");
  return (h("header", { className: "topbar" }, h("span", { className: "brand" }, "SecureYeoman"), h("nav", null, h("a", { className: cls("home"), href: "#/" }, "Home"), h("a", { className: cls("notes"), href: "#/notes" }, "Notes"))));
}
function mount(active, view) {
  const app = document.getElementById("app");
  app.replaceChildren(Header(active), view);
}
function NoteRow({ note }) {
  const when = new Date(note.created * 1000).toLocaleString();
  return (h("li", { className: "note", "data-id": note.id }, h("span", { className: "body" }, note.body), h("time", null, when)));
}
async function showHome() {
  try {
    const health = await api("/api/health");
    const notes = await listNotes();
    mount("home", h("section", { className: "view" }, h("h1", null, "Dashboard"), h("dl", { className: "stats" }, h("dt", null, "Service"), h("dd", null, health.service), h("dt", null, "Status"), h("dd", { className: "ok" }, health.status), h("dt", null, "Version"), h("dd", null, health.version), h("dt", null, "Notes"), h("dd", null, `${notes.length}`))));
  } catch(e) {
    mount("home", h("section", { className: "view" }, h("p", { className: "err" }, `error: ${e.message}`)));
  }
}
async function showNotes() {
  let notes;
  try {
    notes = await listNotes();
  } catch(e) {
    mount("notes", h("section", { className: "view" }, h("p", { className: "err" }, `error: ${e.message}`)));
    return;
  }
  const onAdd = async (ev) => {
    ev.preventDefault();
    const input = document.getElementById("b");
    const body = input.value.trim();
    if (!body) return;
    try {
      await addNote(body);
      await showNotes();
    } catch(err) {
      document.getElementById("app").append((h("p", { className: "err" }, `error: ${err.message}`)));
    }
  };
  mount("notes", h("section", { className: "view" }, h("h1", null, "Notes"), h("form", { className: "addform", onsubmit: onAdd }, h("input", { id: "b", placeholder: "write a note…", autocomplete: "off" }), h("button", null, "Add")), h("ul", { className: "notes" }, notes.map((note) => NoteRow({ note }))), h("footer", { className: "count" }, `${notes.length} note(s)`)));
}
function route() {
  if (location.hash === "#/notes") {
    showNotes();
  } else {
    showHome();
  }
}
window.addEventListener("hashchange", route);
route();
