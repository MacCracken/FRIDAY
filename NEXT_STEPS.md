# NEXT_STEPS

> **F.R.I.D.A.Y.** — Fully Responsive Integrated Digitally Adaptable Yeoman

---

## v1.3.1 — Completed (2026-02-12)

- **Dynamic model discovery** — `fetchAvailableModels()` on all providers (Anthropic, OpenAI, Ollama, OpenCode); parallel fetching in `getAvailableModelsAsync()`
- **Dashboard dropdown highlighting** — lighter blue highlight with left border on active personality and model selections
- **Sidebar collapsed spacing** — reduced icon spacing when sidebar is collapsed

## v1.3.0 — Completed (2026-02-12)

- **Coding IDE View** — Monaco editor at `/code` with personality-scoped chat sidebar, `useChat` hook, "Send to Chat" and "Insert at Cursor" actions
- **Voice Interface** — browser-native SpeechRecognition + speechSynthesis, `useVoice` hook, VoiceToggle component on Chat and Code pages, localStorage persistence
- **Dashboard improvements** — enhanced layout, status bar updates

See [CHANGELOG.md](CHANGELOG.md) for full details.

---

## v1.4.0 — Planned

- [ ] Storybook for component development
- [ ] Test connection button for integrations (requires backend endpoint)
- [ ] Node detail expansion in MetricsGraph
- [ ] HTML prompt injection protection — DOMPurify sanitization
- [ ] CLI enhancements — expanded command set, interactive mode, plugin management
- [ ] Outbound webhooks for events

---

*See [docs/development/roadmap.md](docs/development/roadmap.md) for the full roadmap.*
