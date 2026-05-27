// Served frontend artifact for yeo-cy-test.
//
// This is the hand-lowered, browser-runnable equivalent of web/app.tsx.
// Cyrius validates app.tsx (`cycc --parse-ts`) but has no TS->JS emit yet
// (see FINDINGS.md), so until that lands the deployable JS is authored here.
// Keep the two in sync; app.tsx is the typed source of truth.

async function api(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

const listNotes = () => api("/api/notes");

const addNote = (body) =>
  api("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });

// textContent (not innerHTML) — user-supplied bodies are never interpolated
// as markup, so this is XSS-safe by construction.
function noteRow(note) {
  const li = document.createElement("li");
  li.className = "note";
  li.dataset.id = note.id;

  const span = document.createElement("span");
  span.className = "body";
  span.textContent = note.body;

  const time = document.createElement("time");
  time.textContent = new Date(note.created * 1000).toLocaleString();

  li.append(span, time);
  return li;
}

async function render() {
  const list = document.getElementById("list");
  const status = document.getElementById("status");
  try {
    const notes = await listNotes();
    list.replaceChildren(...notes.map(noteRow));
    status.textContent = notes.length + " note(s)";
  } catch (e) {
    status.textContent = "error: " + e.message;
  }
}

document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("b");
  const body = input.value.trim();
  if (!body) return;
  try {
    await addNote(body);
    input.value = "";
    await render();
  } catch (err) {
    document.getElementById("status").textContent = "error: " + err.message;
  }
});

render();
