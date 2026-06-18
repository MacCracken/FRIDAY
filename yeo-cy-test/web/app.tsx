// SecureYeoman dashboard — the single source of truth for the frontend.
//
// web/app.js is GENERATED from this file by `cyrius build --target=js`
// (cyrius 6.1.11+ TS/TSX → browser-JS + JSX emitter); do not hand-edit app.js.
// JSX lowers to the emitter's `h(tag, props, ...children)` runtime, which
// appends string children as text nodes (never innerHTML) — user-supplied note
// bodies are XSS-safe by construction.
//
// A hash router swaps views into #app without server round-trips, exercising the
// full /api/notes CRUD against the Cyrius (sandhi + patra) backend:
//   #/            → Home   (live service status + note count)
//   #/notes       → Notes  (list + add; per-row open / delete)
//   #/notes/:id   → Note   (detail: view + edit (PUT) + delete (DELETE))
interface Note {
  id: number;
  body: string;
  created: number;
}

interface Health {
  status: string;
  service: string;
  version: string;
}

type Fetcher = <T>(url: string, init?: RequestInit) => Promise<T>;

const api: Fetcher = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

const jsonInit = (method: string, body: string): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ body }),
});

async function listNotes(): Promise<Note[]> {
  return api<Note[]>("/api/notes");
}

async function getNote(id: number): Promise<Note> {
  return api<Note>(`/api/notes/${id}`);
}

async function addNote(body: string): Promise<Note> {
  return api<Note>("/api/notes", jsonInit("POST", body));
}

async function updateNote(id: number, body: string): Promise<Note> {
  return api<Note>(`/api/notes/${id}`, jsonInit("PUT", body));
}

async function deleteNote(id: number): Promise<void> {
  const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function Header(active: string): JSX.Element {
  const cls = (name: string) => (name === active ? "tab active" : "tab");
  return (
    <header className="topbar">
      <span className="brand">SecureYeoman</span>
      <nav>
        <a className={cls("home")} href="#/">Home</a>
        <a className={cls("notes")} href="#/notes">Notes</a>
      </nav>
    </header>
  );
}

function mount(active: string, view: JSX.Element): void {
  const app = document.getElementById("app");
  app.replaceChildren(Header(active), view);
}

function showErr(active: string, msg: string): void {
  mount(active, <section className="view"><p className="err">{`error: ${msg}`}</p></section>);
}

function fmtTime(created: number): string {
  return new Date(created * 1000).toLocaleString();
}

function NoteRow({ note }: { note: Note }): JSX.Element {
  const onDelete = async (): Promise<void> => {
    try {
      await deleteNote(note.id);
      await showNotes();
    } catch (e) {
      showErr("notes", e.message);
    }
  };
  return (
    <li className="note" data-id={note.id}>
      <a className="body" href={`#/notes/${note.id}`}>{note.body}</a>
      <span className="meta">
        <time>{fmtTime(note.created)}</time>
        <button className="del" onclick={onDelete}>delete</button>
      </span>
    </li>
  );
}

async function showHome(): Promise<void> {
  try {
    const health = await api<Health>("/api/health");
    const notes = await listNotes();
    mount(
      "home",
      <section className="view">
        <h1>Dashboard</h1>
        <dl className="stats">
          <dt>Service</dt>
          <dd>{health.service}</dd>
          <dt>Status</dt>
          <dd className="ok">{health.status}</dd>
          <dt>Version</dt>
          <dd>{health.version}</dd>
          <dt>Notes</dt>
          <dd>{`${notes.length}`}</dd>
        </dl>
      </section>,
    );
  } catch (e) {
    showErr("home", e.message);
  }
}

async function showNotes(): Promise<void> {
  let notes: Note[];
  try {
    notes = await listNotes();
  } catch (e) {
    showErr("notes", e.message);
    return;
  }

  const onAdd = async (ev: Event): Promise<void> => {
    ev.preventDefault();
    const input = document.getElementById("b") as HTMLInputElement;
    const body = input.value.trim();
    if (!body) return;
    try {
      await addNote(body);
      await showNotes();
    } catch (err) {
      showErr("notes", err.message);
    }
  };

  mount(
    "notes",
    <section className="view">
      <h1>Notes</h1>
      <form className="addform" onsubmit={onAdd}>
        <input id="b" placeholder="write a note…" autocomplete="off" />
        <button>Add</button>
      </form>
      <ul className="notes">{notes.map((note) => NoteRow({ note }))}</ul>
      <footer className="count">{`${notes.length} note(s)`}</footer>
    </section>,
  );
}

async function showNote(id: number): Promise<void> {
  let note: Note;
  try {
    note = await getNote(id);
  } catch (e) {
    showErr("notes", `note ${id}: ${e.message}`);
    return;
  }

  const onSave = async (ev: Event): Promise<void> => {
    ev.preventDefault();
    const input = document.getElementById("edit") as HTMLInputElement;
    const body = input.value.trim();
    if (!body) return;
    try {
      await updateNote(id, body);
      location.hash = "#/notes";
    } catch (err) {
      showErr("notes", err.message);
    }
  };

  const onDelete = async (): Promise<void> => {
    try {
      await deleteNote(id);
      location.hash = "#/notes";
    } catch (err) {
      showErr("notes", err.message);
    }
  };

  mount(
    "notes",
    <section className="view">
      <h1>{`Note #${id}`}</h1>
      <form className="editform" onsubmit={onSave}>
        <input id="edit" value={note.body} autocomplete="off" />
        <button>Save</button>
      </form>
      <p className="when">{`created ${fmtTime(note.created)}`}</p>
      <p className="actions">
        <a className="back" href="#/notes">← all notes</a>
        <button className="del" onclick={onDelete}>delete</button>
      </p>
    </section>,
  );
}

function route(): void {
  const h = location.hash;
  if (h.indexOf("#/notes/") === 0) {
    const id = parseInt(h.slice(8), 10);
    if (Number.isNaN(id)) { showNotes(); } else { showNote(id); }
  } else if (h === "#/notes") {
    showNotes();
  } else {
    showHome();
  }
}

window.addEventListener("hashchange", route);
route();
