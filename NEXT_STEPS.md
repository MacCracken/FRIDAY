# NEXT_STEPS — Coding IDE View + Voice Interface

> **F.R.I.D.A.Y. v1.3.0** — Fully Responsive Integrated Digitally Adaptable Yeoman

---

## Objective

Add two features to the F.R.I.D.A.Y. v1.3.0 dashboard:

1. **Coding IDE View** — a new `/code` route with a code editor panel, an embedded chat sidebar, and a personality selector that lets the user pick which personality drives the assistant in that context.
2. **Voice Interface Toggle** — a microphone button available in both the Chat page (`/chat`) and the new Code page (`/code`) that enables speech-to-text input and text-to-speech output, toggled on/off per session.

---

## 1. Coding IDE View

### 1.1 New types

**File:** `packages/dashboard/src/types.ts`

```ts
export interface CodeSession {
  id: string;
  filename: string;
  language: string;
  content: string;
  personalityId: string | null;
  createdAt: number;
  updatedAt: number;
}
```

No backend persistence is required for v1.2 — sessions live in React state only.

### 1.2 CodePage component

**File:** `packages/dashboard/src/components/CodePage.tsx` (new)

Layout — a resizable two-panel split:

| Left panel (code editor) | Right panel (chat sidebar) |
|---|---|
| 65% default width | 35% default width |

**Left panel — Code Editor:**
- Use `@monaco-editor/react` (install as dependency)
- Language auto-detect from filename extension; manual override dropdown
- Editor theme should follow the dashboard dark/light theme
- Toolbar above the editor: filename input, language badge, "Send to Chat" button (sends selected text or full buffer to the chat sidebar as a code block)

**Right panel — Chat Sidebar:**
- Reuse the existing chat mutation (`sendChatMessage`) and message rendering logic from `ChatPage.tsx` — extract shared chat logic into a `useChat` hook first:
  - `packages/dashboard/src/hooks/useChat.ts` (new) — extracts `messages`, `input`, `setInput`, `handleSend`, `isPending` from `ChatPage.tsx`
- **Personality selector** at the top of the sidebar:
  - Dropdown populated by `fetchPersonalities()` (already exists in `api/client.ts`)
  - Shows the active personality by default; selecting a different one scopes that sidebar's system prompt
  - Selecting a personality does NOT change the global active personality — it is local to this code session
  - The selected personality's `name` displays next to the bot icon in assistant messages
- Chat input area identical to `/chat` but also supports the voice toggle (see Section 2)
- "Insert at Cursor" button on each assistant message — inserts the code-fenced content into the Monaco editor at the current cursor position

### 1.3 Shared chat hook

**File:** `packages/dashboard/src/hooks/useChat.ts` (new)

```ts
interface UseChatOptions {
  personalityId?: string | null;
}

interface UseChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  handleSend: () => void;
  isPending: boolean;
  clearMessages: () => void;
}

export function useChat(options?: UseChatOptions): UseChatReturn;
```

- Internally calls `sendChatMessage` via `useMutation`
- Passes selected `personalityId` as metadata so the backend can resolve the correct system prompt (or prepend it client-side from the cached personality data)
- After extracting this hook, refactor `ChatPage.tsx` to consume `useChat()` instead of inlining the mutation

### 1.4 Sidebar + Router wiring

**File:** `packages/dashboard/src/components/Sidebar.tsx`
- Add nav item after "Chat": `{ to: '/code', label: 'Code', icon: <Code className="w-5 h-5" /> }` (import `Code` from lucide-react)

**File:** `packages/dashboard/src/components/DashboardLayout.tsx`
- Add lazy import: `const CodePage = lazy(() => import('./CodePage').then(m => ({ default: m.CodePage })));`
- Add route: `<Route path="/code" element={<CodePage />} />`

### 1.5 Install dependency

From workspace root:
```bash
npm install @monaco-editor/react --workspace=packages/dashboard
```

---

## 2. Voice Interface Toggle

### 2.1 Voice hook

**File:** `packages/dashboard/src/hooks/useVoice.ts` (new)

```ts
interface UseVoiceReturn {
  voiceEnabled: boolean;
  toggleVoice: () => void;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  isSpeaking: boolean;
  supported: boolean;   // false if browser lacks SpeechRecognition / speechSynthesis
}

export function useVoice(): UseVoiceReturn;
```

Implementation details:
- **Speech-to-text:** Use the browser `webkitSpeechRecognition` / `SpeechRecognition` API
  - `continuous = false`, `interimResults = true`
  - On `result` event, pipe the transcript into the chat `setInput` (append, not replace, so the user can speak mid-sentence)
  - On `end` event, if `voiceEnabled` is still true, auto-restart (hands-free loop until manually toggled off)
- **Text-to-speech:** Use `window.speechSynthesis`
  - When an assistant message arrives and `voiceEnabled` is true, call `speak(message.content)`
  - Use the personality's `voice` field (from `Personality.voice`) as the `SpeechSynthesisUtterance.voice.name` hint if non-empty; fall back to system default
  - Provide `isSpeaking` state so the UI can show a pulsing indicator
- **Persistence:** Store `voiceEnabled` in `localStorage` key `friday-voice-enabled` so it persists across refreshes but can be toggled any time
- **Guard:** If `SpeechRecognition` or `speechSynthesis` is unavailable, `supported = false` and the toggle button renders as disabled with a tooltip "Voice not supported in this browser"

### 2.2 Voice toggle button

**File:** `packages/dashboard/src/components/VoiceToggle.tsx` (new)

```tsx
interface VoiceToggleProps {
  voiceEnabled: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  supported: boolean;
  onToggle: () => void;
}
```

- Renders a single icon button:
  - Off state: `Mic` icon (lucide), muted color
  - Listening state: `Mic` icon with a pulsing ring animation + accent color
  - Speaking state: `Volume2` icon with accent color
  - Unsupported: `MicOff` icon, disabled, with title tooltip
- Clicking toggles `voiceEnabled` and starts/stops listening accordingly

### 2.3 Integrate into ChatPage

**File:** `packages/dashboard/src/components/ChatPage.tsx`

- Import and call `useVoice()`
- Place `<VoiceToggle />` in the chat header, next to the "Model Info" button
- When `voiceEnabled` changes to `true`, call `startListening()`
- When a new assistant message arrives and `voiceEnabled` is true, call `speak(content)`
- Pass `voiceEnabled` state into the `useChat` hook or wire it alongside

### 2.4 Integrate into CodePage chat sidebar

**File:** `packages/dashboard/src/components/CodePage.tsx`

- Same `useVoice()` integration as ChatPage
- Place `<VoiceToggle />` in the sidebar header next to the personality selector
- Voice input feeds into the sidebar chat input; voice output reads assistant responses

---

## 3. Files Summary

| Action | File |
|--------|------|
| Edit | `packages/dashboard/src/types.ts` — add `CodeSession` |
| New | `packages/dashboard/src/hooks/useChat.ts` — shared chat hook |
| New | `packages/dashboard/src/hooks/useVoice.ts` — voice STT/TTS hook |
| New | `packages/dashboard/src/components/VoiceToggle.tsx` — mic button |
| New | `packages/dashboard/src/components/CodePage.tsx` — IDE view |
| Edit | `packages/dashboard/src/components/ChatPage.tsx` — refactor to `useChat`, add voice |
| Edit | `packages/dashboard/src/components/Sidebar.tsx` — add Code nav item |
| Edit | `packages/dashboard/src/components/DashboardLayout.tsx` — add lazy route |
| Install | `@monaco-editor/react` in dashboard workspace |

---

## 4. Verification

```bash
# Install new dependency
npm install @monaco-editor/react --workspace=packages/dashboard

# Type-check + build
cd packages/dashboard && npm run build

# Manual checks
# 1. Navigate to /code — editor loads, personality dropdown populated
# 2. Select a different personality — chat sidebar uses that personality's name/prompt
# 3. Type code in editor, select text, click "Send to Chat" — selected code appears in sidebar
# 4. Click mic toggle in /chat — browser asks for mic permission, starts listening
# 5. Speak — transcript appears in input field, sends on silence
# 6. Assistant responds — voice reads it aloud when toggle is on
# 7. Toggle voice off — listening stops, TTS stops
# 8. Repeat voice tests on /code sidebar
# 9. Verify all version strings still read v1.3.0
```

---

## 5. Constraints

- **No new backend routes required** — all features use existing endpoints (`/chat`, `/soul/personalities`, `/soul/personality`)
- **No external voice APIs** — browser-native `SpeechRecognition` + `speechSynthesis` only
- **Session-scoped state** — code editor content and code-page personality selection are not persisted to the server
- **Version consistency** — all references must read **F.R.I.D.A.Y. v1.3.0**; do not introduce any other version string
