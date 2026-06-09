// SecureYeoman dashboard shell — the single source of truth for the frontend.
//
// web/app.js is GENERATED from this file by `cyrius build --target=js`
// (cyrius 6.1.11+ TS/TSX → browser-JS + JSX emitter); do not hand-edit app.js.
// JSX lowers to the emitter's `h(tag, props, ...children)` runtime, which
// appends string children as text nodes (never innerHTML) — user-supplied note
// bodies are XSS-safe by construction.
//
// A tiny hash router swaps views into #app without server round-trips:
//   #/        → Home  (service status + note count)
//   #/notes   → Notes (list + add form)
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

async function listNotes(): Promise<Note[]> {
  return api<Note[]>("/api/notes");
}

async function addNote(body: string): Promise<Note> {
  return api<Note>("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
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

function NoteRow({ note }: { note: Note }): JSX.Element {
  const when = new Date(note.created * 1000).toLocaleString();
  return (
    <li className="note" data-id={note.id}>
      <span className="body">{note.body}</span>
      <time>{when}</time>
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
    mount("home", <section className="view"><p className="err">{`error: ${e.message}`}</p></section>);
  }
}

async function showNotes(): Promise<void> {
  let notes: Note[];
  try {
    notes = await listNotes();
  } catch (e) {
    mount("notes", <section className="view"><p className="err">{`error: ${e.message}`}</p></section>);
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
      document.getElementById("app").append(
        (<p className="err">{`error: ${err.message}`}</p>) as Node,
      );
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

function route(): void {
  if (location.hash === "#/notes") {
    showNotes();
  } else {
    showHome();
  }
}

window.addEventListener("hashchange", route);
route();
