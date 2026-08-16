# Changelog

## v1.5.0 — 2026-08-17

### Added

- **Limit a pair to certain collections.** Each side of a pair now has an *In collection* setting: leave it on *All* (the previous behaviour) or limit it to one collection. This fixes the case where a field name is reused across collections but the pairing only makes sense from one of them, e.g. `Related Company` exists on People, Actions and Invoices while `Employees` exists only on Companies. Scoped as `Related Company in Person ↔ Employees in Companies`, only people are mirrored into a company's Employees, and adding a non-person to Employees writes nothing back.
- **Redesigned settings dialog.** One grid with labelled columns (Field · In collection · Pairs with · In collection), so each pair is a single row instead of two, and the scope is named once in the header rather than repeated under every field.
- **New collection picker.** An *All collections / One collection* switch on top, with Thymer's native picker embedded as the list: search, keyboard navigation, and each collection's own icon. Under *All collections* the list stays visible but inert, so the default needs no reading.
- **Version in the manifest**, so Thymer shows the plugin's version and can flag updates.

### Fixed

- **Reciprocals were silently dropped on single-value fields.** When a back-link had to land in a field that allows only one value and that value was already set to a different page, the write was silently discarded by the app, leaving the pair one-sided (page A listed B, but B did not list A). The plugin now checks whether the destination accepts multiple values: if it does not and is already taken, it leaves the existing value alone and shows a toast naming the page, the field and what is already there. Nothing is overwritten and nothing fails quietly.
- That check reads from two independent sources (the runtime property API and the collection's own schema), so it cannot quietly switch itself off. If both were ever unavailable it says so once instead of reverting to the old behaviour.

### Changed

- **The settings dialog follows your theme.** Every colour is derived from Thymer's own variables, so it matches Light, Dark and custom themes such as Neon Noir or Tokyo Techno instead of a fixed palette. The picker uses the native picker background.
- The picker opens directly below its button, shrinking its list to fit and sliding up over the row near the bottom of the screen, so the switch is always reachable and the popup is never cut off.

## v1.0.0 — 2026-06-24

- Mirror two page-link (record) property fields as inverses, e.g. Supports ↔ Enabler.
- No fields are paired by default — nothing is mirrored until you configure your own pair(s) in the settings dialog.
- Both directions: set a link in either field and the reciprocal back-link is added on the target page.
- Fully two-way: removing a link (including emptying a field) removes the reciprocal on the other page too.
- Existing values are always preserved — back-links are appended, never overwritten.
- Matching is by property name, so a pair works across every collection and "tree"; the partner link lands wherever the target page has that field.
- Delta-driven sync (per-field baseline + change diff) so deletions never resurrect or oscillate, and it always converges with no duplicate links.
- Visual settings dialog ("Bidirectional Fields: Settings") to add pairs, picking from your existing page-link fields or any custom name; saved to the plugin config and applied immediately.
