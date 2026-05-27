// Canonical typed frontend source for yeo-cy-test.
// Validated by `cycc --parse-ts`; see web/app.js for the served artifact.
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

export { Note, listNotes, addNote, NoteRow };
