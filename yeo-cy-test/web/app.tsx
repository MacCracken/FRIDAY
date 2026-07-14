// SecureYeoman dashboard — the single source of truth for the frontend.
//
// web/app.js is GENERATED from this file by `cyrius build --target=js`
// (cyrius 6.1.11+ TS/TSX → browser-JS + JSX emitter); do not hand-edit app.js.
// JSX lowers to the emitter's `h(tag, props, ...children)` runtime, which
// appends string children as text nodes (never innerHTML) — user-supplied note
// bodies are XSS-safe by construction. (h() skips null/false children, so the
// RBAC-conditional controls below render nothing when not permitted.)
//
// A hash router swaps views into #app without server round-trips, exercising the
// full /api/notes CRUD against the Cyrius (sandhi + patra) backend:
//   #/            → Home   (live service status + note count)
//   #/notes       → Notes  (list [public] + add [auth]; per-row open / delete [admin])
//   #/notes/:id   → Note   (detail: view [public] + edit (PUT) [auth] + delete [admin])
//   #/login       → Sign in (POST /api/login → HS256 JWT); #/logout clears the session
//
// Note READS are public; WRITES are RBAC-gated by the backend (create/update need any
// authenticated session, DELETE needs role=admin — see src/auth.cyr + verify.py #19).
// The session token is held IN MEMORY (a page reload requires re-login — acceptable for
// the probe; a real deploy would use a Secure/HttpOnly cookie). The UI mirrors the
// backend's rules (hides controls the session can't use), but the backend is the
// authority — it enforces 401/403 regardless of what the UI shows.
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

// ── auth session (in-memory) ──
let token: string | null = null;
let role: string | null = null;

// Attach the Bearer token to a mutating request's headers (no-op when signed out;
// the backend then replies 401, which the callers surface).
function authHeaders(base: Record<string, string>): Record<string, string> {
  if (token) base["Authorization"] = "Bearer " + token;
  return base;
}

const jsonInit = (method: string, body: string): RequestInit => ({
  method,
  headers: authHeaders({ "Content-Type": "application/json" }),
  body: JSON.stringify({ body }),
});

async function login(password: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(`sign-in failed (HTTP ${res.status})`);
  token = ((await res.json()) as { token: string }).token;
  // Resolve the role for RBAC-aware controls via the Bearer-gated /api/me.
  const me = await fetch("/api/me", { headers: { "Authorization": "Bearer " + token } });
  role = me.ok ? ((await me.json()) as { role: string }).role : null;
}

function logout(): void {
  token = null;
  role = null;
}

const isAuthed = (): boolean => token !== null;
const isAdmin = (): boolean => role === "admin";

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
  const res = await fetch(`/api/notes/${id}`, { method: "DELETE", headers: authHeaders({}) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function Header(active: string): JSX.Element {
  const cls = (name: string) => (name === active ? "tab active" : "tab");
  const session = isAuthed()
    ? <a className="tab session" href="#/logout">{`${role} · sign out`}</a>
    : <a className={cls("login")} href="#/login">Sign in</a>;
  return (
    <header className="topbar">
      <span className="brand">SecureYeoman</span>
      <nav>
        <a className={cls("home")} href="#/">Home</a>
        <a className={cls("notes")} href="#/notes">Notes</a>
        {session}
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
  // DELETE is admin-only (backend enforces it); only surface the control to admins.
  const del = isAdmin()
    ? <button className="del" onclick={onDelete}>delete</button>
    : null;
  return (
    <li className="note" data-id={note.id}>
      <a className="body" href={`#/notes/${note.id}`}>{note.body}</a>
      <span className="meta">
        <time>{fmtTime(note.created)}</time>
        {del}
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
          <dt>Session</dt>
          <dd>{isAuthed() ? `${role}` : "signed out"}</dd>
        </dl>
      </section>,
    );
  } catch (e) {
    showErr("home", e.message);
  }
}

async function showLogin(): Promise<void> {
  const onLogin = async (ev: Event): Promise<void> => {
    ev.preventDefault();
    const input = document.getElementById("pw") as HTMLInputElement;
    const pw = input.value;
    if (!pw) return;
    try {
      await login(pw);
      location.hash = "#/notes";
    } catch (e) {
      showErr("login", e.message);
    }
  };
  mount(
    "login",
    <section className="view">
      <h1>Sign in</h1>
      <form className="loginform" onsubmit={onLogin}>
        <input id="pw" type="password" placeholder="password" autocomplete="off" />
        <button>Sign in</button>
      </form>
      <p className="hint">{"admin → changeme · user → user1234"}</p>
    </section>,
  );
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

  // Adding a note needs an authenticated session; otherwise prompt to sign in.
  const adder = isAuthed()
    ? <form className="addform" onsubmit={onAdd}>
        <input id="b" placeholder="write a note…" autocomplete="off" />
        <button>Add</button>
      </form>
    : <p className="signin-hint"><a href="#/login">Sign in</a> to add notes</p>;

  mount(
    "notes",
    <section className="view">
      <h1>Notes</h1>
      {adder}
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

  // Editing needs a session (any role); deleting needs admin. Read stays public.
  const editor = isAuthed()
    ? <form className="editform" onsubmit={onSave}>
        <input id="edit" value={note.body} autocomplete="off" />
        <button>Save</button>
      </form>
    : <p className="signin-hint"><a href="#/login">Sign in</a> to edit</p>;
  const del = isAdmin()
    ? <button className="del" onclick={onDelete}>delete</button>
    : null;

  mount(
    "notes",
    <section className="view">
      <h1>{`Note #${id}`}</h1>
      {editor}
      <p className="when">{`created ${fmtTime(note.created)}`}</p>
      <p className="actions">
        <a className="back" href="#/notes">← all notes</a>
        {del}
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
