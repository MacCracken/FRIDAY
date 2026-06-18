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
const jsonInit = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
async function listNotes() {
  return api("/api/notes");
}
async function getNote(id) {
  return api(`/api/notes/${id}`);
}
async function addNote(body) {
  return api("/api/notes", jsonInit("POST", body));
}
async function updateNote(id, body) {
  return api(`/api/notes/${id}`, jsonInit("PUT", body));
}
async function deleteNote(id) {
  const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
function Header(active) {
  const cls = (name) => (name === active ? "tab active" : "tab");
  return (h("header", { className: "topbar" }, h("span", { className: "brand" }, "SecureYeoman"), h("nav", null, h("a", { className: cls("home"), href: "#/" }, "Home"), h("a", { className: cls("notes"), href: "#/notes" }, "Notes"))));
}
function mount(active, view) {
  const app = document.getElementById("app");
  app.replaceChildren(Header(active), view);
}
function showErr(active, msg) {
  mount(active, h("section", { className: "view" }, h("p", { className: "err" }, `error: ${msg}`)));
}
function fmtTime(created) {
  return new Date(created * 1000).toLocaleString();
}
function NoteRow({ note }) {
  const onDelete = async () => {
    try {
      await deleteNote(note.id);
      await showNotes();
    } catch(e) {
      showErr("notes", e.message);
    }
  };
  return (h("li", { className: "note", "data-id": note.id }, h("a", { className: "body", href: `#/notes/${note.id}` }, note.body), h("span", { className: "meta" }, h("time", null, fmtTime(note.created)), h("button", { className: "del", onclick: onDelete }, "delete"))));
}
async function showHome() {
  try {
    const health = await api("/api/health");
    const notes = await listNotes();
    mount("home", h("section", { className: "view" }, h("h1", null, "Dashboard"), h("dl", { className: "stats" }, h("dt", null, "Service"), h("dd", null, health.service), h("dt", null, "Status"), h("dd", { className: "ok" }, health.status), h("dt", null, "Version"), h("dd", null, health.version), h("dt", null, "Notes"), h("dd", null, `${notes.length}`))));
  } catch(e) {
    showErr("home", e.message);
  }
}
async function showNotes() {
  let notes;
  try {
    notes = await listNotes();
  } catch(e) {
    showErr("notes", e.message);
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
      showErr("notes", err.message);
    }
  };
  mount("notes", h("section", { className: "view" }, h("h1", null, "Notes"), h("form", { className: "addform", onsubmit: onAdd }, h("input", { id: "b", placeholder: "write a note…", autocomplete: "off" }), h("button", null, "Add")), h("ul", { className: "notes" }, notes.map((note) => NoteRow({ note }))), h("footer", { className: "count" }, `${notes.length} note(s)`)));
}
async function showNote(id) {
  let note;
  try {
    note = await getNote(id);
  } catch(e) {
    showErr("notes", `note ${id}: ${e.message}`);
    return;
  }
  const onSave = async (ev) => {
    ev.preventDefault();
    const input = document.getElementById("edit");
    const body = input.value.trim();
    if (!body) return;
    try {
      await updateNote(id, body);
      location.hash = "#/notes";
    } catch(err) {
      showErr("notes", err.message);
    }
  };
  const onDelete = async () => {
    try {
      await deleteNote(id);
      location.hash = "#/notes";
    } catch(err) {
      showErr("notes", err.message);
    }
  };
  mount("notes", h("section", { className: "view" }, h("h1", null, `Note #${id}`), h("form", { className: "editform", onsubmit: onSave }, h("input", { id: "edit", value: note.body, autocomplete: "off" }), h("button", null, "Save")), h("p", { className: "when" }, `created ${fmtTime(note.created)}`), h("p", { className: "actions" }, h("a", { className: "back", href: "#/notes" }, "← all notes"), h("button", { className: "del", onclick: onDelete }, "delete"))));
}
function route() {
  const h = location.hash;
  if (h.indexOf("#/notes/") === 0) {
    const id = parseInt(h.slice(8), 10);
    if (Number.isNaN(id)) {
      showNotes();
    } else {
      showNote(id);
    }
  } else if (h === "#/notes") {
    showNotes();
  } else {
    showHome();
  }
}
window.addEventListener("hashchange", route);
route();
