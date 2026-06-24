# Changelog

## v1.0.0 — 2026-06-24

- Mirror two page-link (record) property fields as inverses, e.g. Supports ↔ Enabler.
- Both directions: set a link in either field and the reciprocal back-link is added on the target page.
- Fully two-way: removing a link (including emptying a field) removes the reciprocal on the other page too.
- Existing values are always preserved — back-links are appended, never overwritten.
- Matching is by property name, so a pair works across every collection and "tree"; the partner link lands wherever the target page has that field.
- Delta-driven sync (per-field baseline + change diff) so deletions never resurrect or oscillate, and it always converges with no duplicate links.
- Visual settings dialog ("Bidirectional Fields: Settings") to add pairs, picking from your existing page-link fields or any custom name; saved to the plugin config and applied immediately.
- "Bidirectional Fields: Sync open pages" command to backfill reciprocal links for pages open in a panel.
