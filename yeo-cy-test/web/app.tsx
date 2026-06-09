// Canonical typed frontend for yeo-cy-test — the single source of truth.
//
// web/app.js is GENERATED from this file by `cyrius build --target=js`
// (cyrius 6.1.11+ TS/TSX → browser-JS emitter); do not hand-edit app.js.
// JSX lowers to the emitter's `h(tag, props, ...children)` runtime, which
// appends string children as text nodes (never innerHTML) — so interpolating
// a user-supplied note body is XSS-safe by construction.
interface Note {
  id: number;
  body: string;
  created: number;
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

function NoteRow({ note }: { note: Note }): JSX.Element {
  const when = new Date(note.created * 1000).toLocaleString();
  return (
    <li className="note" data-id={note.id}>
      <span className="body">{note.body}</span>
      <time>{when}</time>
    </li>
  );
}

// Workaround (cyrius emit bug, see FINDINGS.md): the TS/TSX→JS emitter
// misplaces `async` when an `async function` contains a nested arrow —
// it strips async from the owning function and stamps it on the inner
// arrow. So the `notes.map((note) => …)` arrow is hoisted out of the
// async `render` into this plain sync helper; both emit correctly.
function noteRows(notes: Note[]): JSX.Element[] {
  return notes.map((note) => NoteRow({ note }));
}

async function render(): Promise<void> {
  const list = document.getElementById("list");
  const status = document.getElementById("status");
  try {
    const notes = await listNotes();
    list.replaceChildren(...noteRows(notes));
    status.textContent = `${notes.length} note(s)`;
  } catch (e) {
    status.textContent = `error: ${e.message}`;
  }
}

function init(): void {
  const form = document.getElementById("f");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("b") as HTMLInputElement;
    const body = input.value.trim();
    if (!body) return;
    try {
      await addNote(body);
      input.value = "";
      await render();
    } catch (err) {
      document.getElementById("status").textContent = `error: ${err.message}`;
    }
  });
  render();
}

init();
