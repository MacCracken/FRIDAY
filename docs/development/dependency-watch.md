# Dependency Watch

> Tracked third-party dependencies with known issues that require upstream resolution before action can be taken.

Check these whenever running `npm update` or when the relevant packages release a new version. Do **not** attempt to force-fix entries here — each has been analysed and accepted as a known risk.

---

| Dependency | Severity | Advisory | Issue | Blocked By | Check When |
|---|---|---|---|---|---|
| `mermaid` 10.9.0-rc.1 – 10.9.3 (via `@excalidraw/mermaid-to-excalidraw` → `@excalidraw/excalidraw`) | MODERATE | GHSA-7rqq-prvp-x9jh | Mermaid improperly sanitizes sequence diagram labels leading to XSS. `@excalidraw/mermaid-to-excalidraw` **hard-pins** `mermaid: 10.9.3` (exact, not a range), so npm's nested-override feature (`"@excalidraw/mermaid-to-excalidraw": { "mermaid": "..." }`) is ignored at install time — verified across three override syntaxes. Top-level `mermaid` override can't be used: the dashboard itself directly depends on `mermaid@^11.12.3`. Attack surface is user-supplied diagram content inside the Excalidraw widget. | `@excalidraw/mermaid-to-excalidraw` releasing with `mermaid: >=10.9.5` (or `@excalidraw/excalidraw` bumping to a version of `mermaid-to-excalidraw` that uses patched mermaid) | Any `@excalidraw/excalidraw` or `@excalidraw/mermaid-to-excalidraw` release |
| `yauzl` <3.2.1 (via `@capacitor/cli` → `native-run`) | MODERATE | GHSA-gmq8-994r-jv83 | Off-by-one error in ZIP parsing. Only affects Capacitor CLI (mobile build tooling), not production runtime. `npm audit fix --force` would downgrade `@capacitor/cli` to v2 (breaking). Not surfaced by `npm audit` (nested optional dev dep), but still present at `node_modules/yauzl@2.10.0`. | `native-run` releasing with `yauzl@>=3.2.1` | Any `@capacitor/cli` or `native-run` release |

---

## How to Use This File

1. **On `npm update`** — check every row. If the blocked-by condition has been resolved upstream, revisit the accepted-risk entry and decide whether to act.
2. **On a new CVE alert** — check whether the affected package appears here. If yes, update the `Issue` cell if the severity changed.
3. **To add an entry** — document the issue, the blocking condition, and when to re-check, then add a row here.

---

## npm audit Summary (2026-04-18)

`npm audit` reports 3 vulnerabilities, all moderate, all from the single mermaid XSS chain tracked above.

| Severity | Count | Source |
|----------|-------|--------|
| Critical | 0 | — |
| High | 0 | — |
| Moderate | 3 | `@excalidraw/excalidraw`, `@excalidraw/mermaid-to-excalidraw`, `mermaid` (same upstream GHSA-7rqq-prvp-x9jh) |
| Low | 0 | — |

**Recent fixes applied in the 0.5.0 audit (35 → 3 vulns):**

- `@anthropic-ai/sdk` 0.80→0.90 — patches memory-tool path-traversal (direct bump)
- `dompurify` 3.3.3→3.4.0 — seven XSS / prototype pollution / ADD_ATTR advisories
- `protobufjs` <7.5.5 → 8.0.1 override — fixes the critical `baileys` / `@whiskeysockets/libsignal-node` RCE chain
- `serialize-javascript` 6.0.2 → 7.0.5 override — RCE via `RegExp.flags` / `Date.prototype.toISOString`, CPU exhaustion
- `undici` 6.23.0 → 6.25.0 override (in `@discordjs/rest` + `discord.js` subtrees) — resolved all five undici advisories without waiting on `discord.js@15` stable
- `nanoid` 3.3.3 → 5.1.9 override — predictable results with non-integer values
- `lodash-es` 4.17.23 → 4.18.1 override — prototype pollution, code injection via `_.template`

Transitive cleanup via `npm audit fix` (non-breaking) dedup'd `@fastify/static`, `fastify`, `hono`, `@hono/node-server`, `axios`, `@xmldom/xmldom`, `follow-redirects`, `imapflow`, `nodemailer`, `brace-expansion`, `vite`, `chevrotain` family, `langium`, `lodash`.

**No actionable fixes available** for the remaining 3 without either (a) downgrading `@excalidraw/excalidraw` from 0.18.x to 0.17.6 (breaking major downgrade of a visible editor dep) or (b) upstream `@excalidraw/mermaid-to-excalidraw` bumping its hard-pinned mermaid.

---

*Last updated: 2026-04-18 — 2 active items (4 vulns: 3 moderate production, 1 moderate dev-only). Previous undici/discord.js entry resolved via override bump to 6.25.0 (no longer waiting on `discord.js@15` stable). mermaid XSS added as new tracked item after the 0.5.0 audit pass.*
