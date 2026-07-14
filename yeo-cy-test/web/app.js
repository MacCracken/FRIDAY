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
let token = null;
let role = null;
function authHeaders(base) {
  if (token) base["Authorization"] = "Bearer " + token;
  return base;
}
const jsonInit = (method, body) => ({ method, headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ body }) });
async function login(password) {
  const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  if (!res.ok) throw new Error(`sign-in failed (HTTP ${res.status})`);
  token = ((await res.json())).token;
  const me = await fetch("/api/me", { headers: { "Authorization": "Bearer " + token } });
  role = me.ok ? ((await me.json())).role : null;
}
function logout() {
  token = null;
  role = null;
}
const isAuthed = () => token !== null;
const isAdmin = () => role === "admin";
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
  const res = await fetch(`/api/notes/${id}`, { method: "DELETE", headers: authHeaders({}) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
function Header(active) {
  const cls = (name) => (name === active ? "tab active" : "tab");
  const session = isAuthed() ? h("a", { className: "tab session", href: "#/logout" }, `${role} · sign out`) : h("a", { className: cls("login"), href: "#/login" }, "Sign in");
  return (h("header", { className: "topbar" }, h("span", { className: "brand" }, "SecureYeoman"), h("nav", null, h("a", { className: cls("home"), href: "#/" }, "Home"), h("a", { className: cls("notes"), href: "#/notes" }, "Notes"), session)));
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
  const del = isAdmin() ? h("button", { className: "del", onclick: onDelete }, "delete") : null;
  return (h("li", { className: "note", "data-id": note.id }, h("a", { className: "body", href: `#/notes/${note.id}` }, note.body), h("span", { className: "meta" }, h("time", null, fmtTime(note.created)), del)));
}
async function showHome() {
  try {
    const health = await api("/api/health");
    const notes = await listNotes();
    mount("home", h("section", { className: "view" }, h("h1", null, "Dashboard"), h("dl", { className: "stats" }, h("dt", null, "Service"), h("dd", null, health.service), h("dt", null, "Status"), h("dd", { className: "ok" }, health.status), h("dt", null, "Version"), h("dd", null, health.version), h("dt", null, "Notes"), h("dd", null, `${notes.length}`), h("dt", null, "Session"), h("dd", null, isAuthed() ? `${role}` : "signed out"))));
  } catch(e) {
    showErr("home", e.message);
  }
}
async function showLogin() {
  const onLogin = async (ev) => {
    ev.preventDefault();
    const input = document.getElementById("pw");
    const pw = input.value;
    if (!pw) return;
    try {
      await login(pw);
      location.hash = "#/notes";
    } catch(e) {
      showErr("login", e.message);
    }
  };
  mount("login", h("section", { className: "view" }, h("h1", null, "Sign in"), h("form", { className: "loginform", onsubmit: onLogin }, h("input", { id: "pw", type: "password", placeholder: "password", autocomplete: "off" }), h("button", null, "Sign in")), h("p", { className: "hint" }, "admin → changeme · user → user1234")));
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
  const adder = isAuthed() ? h("form", { className: "addform", onsubmit: onAdd }, h("input", { id: "b", placeholder: "write a note…", autocomplete: "off" }), h("button", null, "Add")) : h("p", { className: "signin-hint" }, h("a", { href: "#/login" }, "Sign in"), "to add notes");
  mount("notes", h("section", { className: "view" }, h("h1", null, "Notes"), adder, h("ul", { className: "notes" }, notes.map((note) => NoteRow({ note }))), h("footer", { className: "count" }, `${notes.length} note(s)`)));
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
  const editor = isAuthed() ? h("form", { className: "editform", onsubmit: onSave }, h("input", { id: "edit", value: note.body, autocomplete: "off" }), h("button", null, "Save")) : h("p", { className: "signin-hint" }, h("a", { href: "#/login" }, "Sign in"), "to edit");
  const del = isAdmin() ? h("button", { className: "del", onclick: onDelete }, "delete") : null;
  mount("notes", h("section", { className: "view" }, h("h1", null, `Note #${id}`), editor, h("p", { className: "when" }, `created ${fmtTime(note.created)}`), h("p", { className: "actions" }, h("a", { className: "back", href: "#/notes" }, "← all notes"), del)));
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
  } else if (h === "#/login") {
    showLogin();
  } else if (h === "#/logout") {
    logout();
    location.hash = "#/";
  } else {
    showHome();
  }
}
window.addEventListener("hashchange", route);
route();
