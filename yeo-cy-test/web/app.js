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
function NoteRow({ note }) {
  const when = new Date(note.created * 1000).toLocaleString();
  return (h("li", { className: "note", "data-id": note.id }, h("span", { className: "body" }, note.body), h("time", null, when)));
}
function noteRows(notes) {
  return notes.map((note) => NoteRow({ note }));
}
async function render() {
  const list = document.getElementById("list");
  const status = document.getElementById("status");
  try {
    const notes = await listNotes();
    list.replaceChildren(...noteRows(notes));
    status.textContent = `${notes.length} note(s)`;
  } catch(e) {
    status.textContent = `error: ${e.message}`;
  }
}
function init() {
  const form = document.getElementById("f");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("b");
    const body = input.value.trim();
    if (!body) return;
    try {
      await addNote(body);
      input.value = "";
      await render();
    } catch(err) {
      document.getElementById("status").textContent = `error: ${err.message}`;
    }
  });
  render();
}
init();
