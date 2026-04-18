# Go-Live Checklist

> Pre-release checklist for SecureYeoman's first public release. Items are grouped by domain. All must be complete before cutting the release tag.

---

## 1. Business & Legal

- [ ] **S-Corp / business entity confirmed** — LightOcean Studios S-Corp details provided for payment provider merchant of record setup
- [ ] **Payment provider account created** — Store configured with business legal name, tax ID, bank account for payouts. ~~LemonSqueezy rejected (2026-03-18).~~ Evaluating: Polar, Paddle, Stripe.
- [ ] **Products created in payment provider** — 3 products with variants:
  - Pro ($20/yr, annual subscription)
  - Solopreneur ($100/yr, annual subscription)
  - Enterprise ($1,000/yr, annual subscription)
- [ ] **Webhook configured** — Payment provider webhook pointing to licensing service URL with signing secret
- [ ] **Test mode purchase verified** — End-to-end: checkout → webhook → key minted → dashboard retrieval → auto-apply → enforcement check
- [ ] **AGPL-3.0 license file** — Verify `LICENSE` file is present and correct in repo root
- [ ] **Privacy policy** — Published at secureyeoman.ai (minimal: what data is collected, how it's stored, no phone-home)
- [ ] **Terms of service** — Published at secureyeoman.ai (license tiers, acceptable use, support terms)

## 2. Licensing Service

- [ ] **`secureyeoman-licensing` deployed** — Hosting decided (Cloudflare Worker, Railway, VPS, etc.)
- [ ] **Ed25519 keypair generated** — Private key in licensing service env, public key embedded in SY core `license-manager.ts`
- [ ] **Database provisioned** — SQLite file on persistent volume (or migrate to Postgres if scaling concerns)
- [ ] **Webhook endpoint accessible** — Payment provider can reach webhook endpoint from the internet
- [ ] **Key retrieval routes accessible** — Dashboard can reach `GET /api/v1/licenses/by-order/:id`
- [ ] **Rate limiting / auth on retrieval routes** — Production hardening (API key, IP allowlist, or rate limit)
- [ ] **Manual key issuance tested** — `npx tsx src/cli/mint.ts --org "Test" --tier enterprise --expires 365` produces valid key

## 3. Dashboard Build

- [ ] **Checkout URL env vars** — Set provider checkout URLs for Pro, Solopreneur, and Enterprise variants
- [ ] **`VITE_LICENSING_API_URL`** — Set to licensing service base URL for key retrieval polling
- [ ] **Checkout tested** — Opens provider checkout, completes test purchase, key auto-applied

## 4. License Enforcement

- [ ] **`SECUREYEOMAN_LICENSE_ENFORCEMENT`** — Defaults to `false` in `.env.example` and `.env.expanded.example`
- [ ] **Enforcement-off behavior verified** — All 22 features accessible without a key (community tier)
- [ ] **Enforcement-on + no key verified** — All gated routes return 402 with `enterprise_license_required`
- [ ] **Enforcement-on + valid key verified** — All gated routes return normal responses
- [ ] **Dashboard FeatureLock verified** — Lock overlays appear when enforcement on + feature missing
- [ ] **Startup log line** — License tier, enforcement state, and org logged at boot (already done)

## 5. Quality Gates

- [ ] **All tests pass** — `npx vitest run` (core:unit + core:db + core:e2e + dashboard + mcp)
- [ ] **Typecheck clean** — `npm run typecheck`
- [ ] **Lint clean** — `npm run lint` (0 errors)
- [ ] **Format clean** — `npm run format` (0 changes)
- [ ] **Security audit** — `npm audit` (0 vulnerabilities)
- [ ] **Manual test checklist** — All items in `docs/development/roadmap.md` Phase XX verified
- [ ] **Docker image builds** — `docker compose --env-file .env.dev build` succeeds
- [ ] **Docker compose up** — Full stack starts clean (core + MCP + dashboard + postgres)
- [ ] **Health endpoint** — `GET /health` returns expected fields (version, networkMode, etc.)

## 6. Distribution

- [ ] **GitHub repos transferred** — `secureyeoman` and `secureyeoman-community-repo` transferred to `yeoman.maccracken` org
- [ ] **GHCR images published** — `ghcr.io/yeoman.maccracken/secureyeoman:latest` and tagged with SemVer (e.g. `0.5.0`)
- [ ] **Install script** — `curl -fsSL https://secureyeoman.ai/install | bash` works from clean machine
- [ ] **Edge binary published** — `secureyeoman-<version>-edge-linux-x64` on GitHub Releases (Rust `sy-edge`; arm64/armv7/riscv64 cross-compile deferred)
- [ ] **Agent binary published** — `secureyeoman-<version>-agent-{linux-x64,linux-arm64,darwin-arm64}` on GitHub Releases
- [ ] **CI/CD pipeline** — `ci.yml` and `release-binary.yml` workflows passing on new org

## 7. Website (secureyeoman.ai)

- [ ] **Landing page current** — `site/index.html` reflects latest feature set and pricing
- [ ] **Pricing section** — Tier comparison table (Community/Pro/Solopreneur/Enterprise) with feature breakdown
- [ ] **Install instructions** — One-liner curl command, Docker, Helm
- [ ] **Whitepaper** — `site/whitepaper.html` is current
- [ ] **llms.txt** — `site/llms.txt` is current (for AI crawlers)
- [ ] **Sitemap** — `site/sitemap.xml` updated with all pages

## 8. Community & Support

- [ ] **Community repo seeded** — `secureyeoman-community-repo` has example skills, workflows, swarm templates
- [ ] **GitHub Issues enabled** — Issue templates for bug reports, feature requests, security vulnerabilities
- [ ] **Security contact** — `security@secureyeoman.ai` email routed and monitored
- [ ] **README** — Getting started, architecture overview, contributing link, license badge

## 9. Post-Launch (Day 1)

- [ ] **Announcement post** — Per marketing strategy launch sequence
- [ ] **Monitor webhook delivery** — Check payment provider webhook logs for failed deliveries
- [ ] **Monitor licensing service** — Check SQLite for first real purchases
- [ ] **Monitor GitHub** — Respond to first issues/stars/forks within 24h

---

## Version

Release version: `npm run version:set YYYY.M.D`

Tag: `git tag -a YYYY.M.D -m "First public release"`

Push: `git push origin main --tags`

---

*See also: [Roadmap](roadmap.md) | [Marketing Strategy](../marketing-strategy.md) | [Changelog](../../CHANGELOG.md)*
