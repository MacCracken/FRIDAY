# ADR 028: Marketplace Skill Installation

## Status

Accepted

## Context

ADR 007 introduced the Skill Marketplace concept with search, browse, and install/uninstall operations. However, the initial implementation had two gaps:

1. **No seed content** — The marketplace launched empty with no skills to discover.
2. **Cosmetic install** — `MarketplaceManager.install()` only toggled an `installed` flag in the marketplace SQLite database. It did not create an actual `Skill` record in BrainStorage, so "installed" marketplace skills never appeared in the Skills view.

## Decision

### Bridge marketplace install to Brain skills

- `MarketplaceManager` accepts an optional `BrainManager` dependency.
- `install(id)` now calls `brainManager.createSkill()` after setting the marketplace flag, copying name, description, instructions, and tools into the Brain's skills table with `source: 'marketplace'`.
- `uninstall(id)` finds the corresponding Brain skill by matching `source: 'marketplace'` and skill name, then deletes it.

### New `marketplace` skill source

- `SkillSourceSchema` is extended from `['user', 'ai_proposed', 'ai_learned']` to include `'marketplace'`.
- The dashboard SkillsManager shows a "Marketplace" label and filter option for marketplace-sourced skills.

### Seed built-in example skill

- `MarketplaceStorage.seedBuiltinSkills()` idempotently inserts a "Summarize Text" utility skill.
- Called during `SecureYeoman.initialize()` after marketplace manager creation.

## Consequences

- Marketplace skills are now first-class Brain skills, visible in the Skills view and included in prompt composition.
- The `marketplace` source type allows users to distinguish marketplace-installed skills from user-created or AI-proposed ones.
- Uninstalling a marketplace skill cleanly removes it from both the marketplace registry and Brain storage.
- The seeded example skill provides immediate value on first launch.
