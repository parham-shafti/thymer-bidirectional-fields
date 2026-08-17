/**
 * Bidirectional Fields — workspace-wide App Plugin
 * -----------------------------------------------
 * Keeps two *record-type* (page-link) property fields in sync as inverses of
 * each other. Configure one or more name pairs, e.g. ["Supports","Enabler"]:
 *
 *   - If page A's "Supports" links to page B, then B's "Enabler" gets A.
 *   - If page A's "Enabler" links to page B, then B's "Supports" gets A.
 *
 * Both directions, fully mirrored: adding a link appends the reciprocal on the
 * other page (existing values preserved, never overwritten); REMOVING a link
 * removes the reciprocal on the other page too. Net invariant: T in A.X <=> A in T.Y.
 *
 * Matching is by property *name*, so the same pair works across every collection
 * (and across "trees"): the counterpart link is written wherever the target page
 * actually has that field. If the target's collection has no such field, that
 * side is silently skipped.
 *
 * --- How it stays correct (delta-driven) ---
 * Naive "ensure both sides agree" reconciliation oscillates on deletion: one rule
 * says "a back-link implies the forward link" (re-add) while another says "no
 * forward link implies remove the back-link" (remove), and they fight. Instead we
 * mirror only what actually CHANGED in the edited field:
 *
 *   - A MutationObserver watches the open property panels.
 *   - The first time a page is seen (panel render, or plugin load) we capture a
 *     baseline of its paired fields — no writes.
 *   - On a later edit we diff new vs baseline: added values -> add reciprocal,
 *     removed values -> remove reciprocal. Then update the baseline.
 *
 * Writes we make update our own cache immediately, so when the target page's panel
 * re-renders, its reconcile sees no delta and does nothing — no bounce, no loop.
 *
 * Single-value partner fields: if the destination field allows only one value and
 * already holds a different one, the reciprocal is NOT written (appending would be
 * silently coerced by the SDK, so our write is dropped). The conflict is surfaced
 * as a toast instead, so nothing the user set is corrupted or overwritten.
 *
 * Configuration: plugin config `custom.pairs`. Each pair is either a two-name
 * array (applies in every collection) or an object with an optional collection
 * guid per side, which limits the pair to pages in that collection:
 *   { "custom": { "pairs": [
 *       ["Supports","Enabler"],
 *       { "a":"Related Company", "aCol":"<Persons guid>", "b":"Employees", "bCol":"<Companies guid>" }
 *   ] } }
 * With the scoped pair above, a Related Company set on a PERSON writes the person
 * into the company's Employees; the same field on an Action does nothing.
 * No pairs are configured by default — nothing is mirrored until you add a pair
 * (via the settings dialog). Same name twice = a self-symmetric field.
 *
 * No `export` keyword — Thymer's Custom Code editor cannot apply it.
 * Read record links via prop.texts(); write via prop.set([...]) (prop.value is
 * undefined at runtime — the SDK types.d.ts is stale).
 *
 * Verified selectors (Property Arranger, Thymer 1.0.16, web/desktop, 2026-06):
 *   - property row ......... .id-prop-row[data-field-id]
 *   - owning record guid ... panel .panel-heading[data-banner-drop]
 *                            (data-is-collection === "true" => collection panel, skip)
 */
/* Settings dialog styling — the layout of design_handoff_collection_scope (2a),
 * with every colour derived from the host theme so it follows Light/Dark and
 * any custom theme (Neon Noir, Tokyo Techno, ...) instead of a fixed teal:
 *   accent  = --link-color / --button-primary-*  (the theme's own accent)
 *   surface = --modal-bg, lifted a touch on dark themes so it reads as a panel
 *   greys   = --text-color mixed to transparency (lifts on dark, darkens on light)
 * Theme is resolved at open time and stamped as .bl-dark / .bl-light on the
 * backdrop. Radii are 4px throughout, no exceptions. Font: Space Grotesk if
 * the host has it, else the host UI font. The collection picker is the shared
 * option-menu (native cmdpal markup), which the app styles for us. */
const DASH_CSS = `
.bl-backdrop { position: fixed; inset: 0; z-index: 10000; background: var(--full-scrim, rgba(0,0,0,0.45)); display: flex; align-items: flex-start; justify-content: center;
  --bl-surface: var(--modal-bg); --bl-pop: var(--modal-bg);
  --bl-hair: color-mix(in srgb, var(--text-color) 10%, transparent);
  --bl-chip: color-mix(in srgb, var(--text-color) 6%, transparent); --bl-chip-border: color-mix(in srgb, var(--text-color) 6%, transparent); --bl-chip-hover: color-mix(in srgb, var(--text-color) 10%, transparent);
  --bl-ctrl-border: color-mix(in srgb, var(--text-color) 16%, transparent); --bl-ctrl-border-hover: color-mix(in srgb, var(--text-color) 30%, transparent);
  --bl-dash: color-mix(in srgb, var(--text-color) 16%, transparent); --bl-dash-hover: color-mix(in srgb, var(--text-color) 40%, transparent);
  /* Design: text on the accent is near-black (#10171b), not white. Thymer's own
     --button-primary-fg-color is near-white on some themes, so it is not used here.
     Accents are saturated mid-tones (teal, magenta, yellow), which dark text reads on. */
  --bl-accent: var(--button-primary-bg-color); --bl-on-accent: #10171b;
  --bl-accent-text: var(--link-color); --bl-accent-soft: var(--link-color);
  --bl-accent-tint: color-mix(in srgb, var(--link-color) 8%, transparent);
  --bl-accent-tint-border: color-mix(in srgb, var(--link-color) 35%, transparent);
  --bl-accent-tint-border-hover: color-mix(in srgb, var(--link-color) 55%, transparent);
  --bl-focus: color-mix(in srgb, var(--link-color) 55%, transparent);
  --bl-t1: var(--text-color); --bl-t2: color-mix(in srgb, var(--text-color) 82%, transparent);
  --bl-t3: color-mix(in srgb, var(--text-color) 62%, transparent); --bl-t4: color-mix(in srgb, var(--text-color) 55%, transparent);
  --bl-t5: color-mix(in srgb, var(--text-color) 46%, transparent); --bl-t6: color-mix(in srgb, var(--text-color) 38%, transparent);
  --bl-badge: color-mix(in srgb, var(--text-color) 8%, transparent); --bl-hover: color-mix(in srgb, var(--text-color) 6%, transparent); }
.bl-backdrop.bl-dark {
  --bl-surface: color-mix(in srgb, var(--modal-bg) 95%, var(--text-color)); --bl-pop: color-mix(in srgb, var(--modal-bg) 92%, var(--text-color));
  --bl-hair: color-mix(in srgb, var(--text-color) 7%, transparent);
  --bl-ctrl-border: color-mix(in srgb, var(--text-color) 9%, transparent); --bl-ctrl-border-hover: color-mix(in srgb, var(--text-color) 18%, transparent);
  --bl-dash: color-mix(in srgb, var(--text-color) 14%, transparent); --bl-dash-hover: color-mix(in srgb, var(--text-color) 28%, transparent);
  --bl-accent-soft: color-mix(in srgb, var(--link-color) 78%, var(--text-color)); }
.bl-shell { margin-top: 6vh; width: 1020px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px); display: flex; flex-direction: column; overflow: hidden; background: var(--bl-surface); color: var(--bl-t1); border: 1px solid var(--bl-hair); border-radius: 4px; box-shadow: 0 24px 60px -24px rgba(0,0,0,.7); font-family: "Space Grotesk", var(--font-sans); font-size: 14px; }
.bl-shell * { box-sizing: border-box; }
/* Thymer sets p/input font-family with !important app-wide; a scoped !important is the only way to keep the dialog in one face. */
.bl-backdrop .bl-shell p, .bl-backdrop .bl-shell input, .bl-backdrop .bl-popover input { font-family: "Space Grotesk", var(--font-sans) !important; }
.bl-shell button:focus-visible, .bl-shell input:focus-visible { outline: 2px solid var(--bl-focus); outline-offset: 2px; }
.bl-head { padding: 34px 40px 26px; border-bottom: 1px solid var(--bl-hair); }
.bl-title { margin: 0 0 14px; font-size: 30px; line-height: 1.2; font-weight: 700; color: var(--bl-t1); }
.bl-desc { margin: 0; max-width: 820px; font-size: 15px; line-height: 1.65; color: var(--bl-t3); text-wrap: pretty; }
.bl-body { flex: 1; min-height: 0; overflow: auto; padding: 26px 40px 30px; }
.bl-sec { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.bl-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .14em; color: var(--bl-t5); }
.bl-count-pill { font-size: 11px; font-weight: 500; padding: 4px 8px; color: var(--bl-t2); background: var(--bl-badge); border-radius: 4px; }
/* ONE grid for header + rows, so the labels can never drift from the columns. */
.bl-grid { display: grid; grid-template-columns: minmax(140px,1fr) max-content 26px minmax(140px,1fr) max-content 28px; align-items: center; gap: 8px 10px; }
.bl-gh { font-size: 10.5px; line-height: 1; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--bl-t6); padding-left: 2px; }
.bl-gdiv { grid-column: 1 / -1; height: 1px; background: var(--bl-hair); margin: 2px 0 4px; }
.bl-field { all: unset; box-sizing: border-box; min-width: 0; padding: 10px 14px; cursor: pointer; font-family: inherit; font-size: 14px; line-height: 1.2; font-weight: 600; color: var(--bl-accent-text); background: var(--bl-chip); border: 1px solid var(--bl-chip-border); border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background .12s ease, border-color .12s ease, color .12s ease; }
.bl-field:hover { background: var(--bl-chip-hover); color: var(--bl-chip-hover-text); }
.bl-field.empty { color: var(--bl-t4); font-weight: 400; background: transparent; border: 1px dashed var(--bl-dash); }
.bl-field.open { border-color: var(--bl-accent-tint-border-hover); }
.bl-scope { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 150px; padding: 10px 16px; cursor: pointer; font-family: inherit; font-size: 14px; line-height: 1.2; font-weight: 400; color: var(--bl-t4); background: transparent; border: 1px solid var(--bl-ctrl-border); border-radius: 4px; white-space: nowrap; transition: background .12s ease, border-color .12s ease, color .12s ease; }
.bl-scope .caret { font-size: 10px; color: var(--bl-t6); }
.bl-scope:hover, .bl-scope.open, .bl-scope.qb-open { border-color: var(--bl-ctrl-border-hover); }
.bl-scope.set { font-weight: 500; color: var(--bl-accent-soft); background: var(--bl-accent-tint); border-color: var(--bl-accent-tint-border); }
.bl-scope.set .caret { color: var(--bl-accent-text); }
.bl-scope.set:hover, .bl-scope.set.open, .bl-scope.set.qb-open { border-color: var(--bl-accent-tint-border-hover); }
.bl-arrow { text-align: center; font-size: 14px; color: var(--bl-t6); }
.bl-pair-remove { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; height: 100%; min-height: 28px; cursor: pointer; font-size: 15px; color: var(--bl-t6); border-radius: 4px; transition: color .12s ease; }
.bl-pair-remove:hover { color: var(--bl-t1); }
.bl-add { all: unset; box-sizing: border-box; display: block; width: calc(100% - 38px); margin: 14px 0 0; padding: 12px; text-align: center; font-family: inherit; font-size: 13px; font-weight: 500; color: var(--bl-t3); cursor: pointer; border: 1px dashed var(--bl-dash); border-radius: 4px; transition: border-color .12s ease, color .12s ease; }
.bl-add:hover { border-color: var(--bl-dash-hover); }
.bl-hint { margin: 18px 0 0; max-width: 820px; font-size: 13.5px; line-height: 1.65; color: var(--bl-t5); text-wrap: pretty; }
.bl-empty { color: var(--bl-t5); font-style: italic; font-size: 13px; padding: 6px 2px 12px; }
.bl-foot { display: flex; justify-content: flex-end; gap: 12px; padding: 20px 40px; border-top: 1px solid var(--bl-hair); }
.bl-btn { all: unset; box-sizing: border-box; padding: 11px 26px; font-family: inherit; font-size: 14px; font-weight: 500; color: var(--bl-t2); cursor: pointer; border: 1px solid var(--bl-dash); border-radius: 4px; transition: color .12s ease, border-color .12s ease; }
.bl-btn:hover { color: var(--bl-t1); border-color: var(--bl-dash-hover); }
.bl-btn[disabled] { opacity: .5; cursor: default; }
.bl-btn-primary { padding: 12px 30px; font-weight: 600; background: var(--bl-accent); border-color: var(--bl-accent); color: var(--bl-on-accent); transition: filter .12s ease; }
.bl-btn-primary:hover { filter: brightness(1.06); color: var(--bl-on-accent); }
/* popovers */
.bl-popover { position: fixed; z-index: 10001; display: flex; flex-direction: column; overflow: hidden; background: var(--cmdpal-bg-color, var(--bl-pop)); color: var(--cmdpal-fg-color, inherit); border: 1px solid var(--bl-ctrl-border); border-radius: 4px; box-shadow: 0 18px 40px rgba(0,0,0,.5); font-family: "Space Grotesk", var(--font-sans); }
.bl-search { margin: 10px 10px 6px; padding: 9px 11px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--bl-ctrl-border); border-radius: 4px; }
.bl-search:focus-within { border-color: var(--bl-accent-tint-border-hover); }
.bl-search svg { flex: none; opacity: .5; }
.bl-search input { all: unset; flex: 1; min-width: 0; font-family: inherit; font-size: 13px; color: var(--bl-t1); }
.bl-search input::placeholder { color: var(--bl-t5); }
.bl-seg { display: flex; margin: 10px 10px 8px; padding: 3px; background: var(--bl-hover); border-radius: 4px; }
.bl-seg button { all: unset; box-sizing: border-box; flex: 1; padding: 8px; text-align: center; font-family: inherit; font-size: 12.5px; font-weight: 500; color: var(--bl-t3); border-radius: 4px; cursor: pointer; transition: background .12s ease, color .12s ease; }
.bl-seg button.on { background: var(--bl-accent); color: var(--bl-on-accent); font-weight: 600; }
.bl-seg-note { margin: 0 12px 10px; font-size: 12px; line-height: 1.5; color: var(--bl-t5); }
.bl-pop-sep { height: 1px; background: var(--bl-hair); }
/* The shared option-menu (native cmdpal) embedded as the picker's list: strip
 * its floating chrome so it sits flush inside our popover, keep its rows. */
.bl-embed { padding: 6px 4px 0; transition: opacity .12s ease; }
.bl-embed.inert { opacity: .45; pointer-events: none; }
.bl-embed .cmdpal--inline { position: static !important; width: 100% !important; max-width: none !important; background: transparent !important; border: 0 !important; box-shadow: none !important; border-radius: 0 !important; padding-top: 0 !important; }
.bl-embed .cmdpal--inline-input-container { margin: 0 6px 6px; border: 1px solid var(--bl-ctrl-border); border-radius: 4px; }
.bl-embed .cmdpal--inline-input { padding: 9px 11px; }
.bl-pop-list { max-height: 260px; overflow-y: auto; padding: 0 6px 6px; }
.bl-pop-item { display: flex; align-items: center; gap: 8px; padding: 9px 11px; cursor: pointer; border-radius: 4px; font-size: 13.5px; color: var(--bl-t2); }
.bl-pop-item:hover, .bl-pop-item.kb { background: var(--bl-hover); }
.bl-pop-item .plus { width: 10px; text-align: center; color: var(--bl-accent-text); }
.bl-pop-item .nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl-pop-item.dim .nm { opacity: .5; }
.bl-pop-item.cur .nm { color: var(--bl-accent-soft); font-weight: 500; }
.bl-pop-foot { padding: 8px 12px; font-size: 11.5px; color: var(--bl-t5); border-top: 1px solid var(--bl-hair); }
.bl-pop-foot.act { cursor: pointer; color: var(--bl-accent-text); }
/* Narrow windows: the six columns cannot fit, so each pair stacks onto two
 * lines. DOM order is fieldA, scopeA, arrow, fieldB, scopeB, remove, which in a
 * 3-column grid lands exactly as: [field A][scope A][⇔] / [field B][scope B][×].
 * The second pair of column headers is dropped; the first two still describe
 * both lines. */
@media (max-width: 900px) {
  .bl-shell { margin-top: 2vh; }
  .bl-head { padding: 24px 20px 18px; }
  .bl-body { padding: 20px 20px 24px; }
  .bl-foot { padding: 16px 20px; }
  .bl-title { font-size: 24px; }
  .bl-desc { font-size: 13.5px; }
  .bl-grid { grid-template-columns: minmax(0,1fr) max-content 28px; gap: 6px 8px; }
  .bl-grid > .bl-gh:nth-child(n+4) { display: none; }
  .bl-scope { min-width: 118px; padding: 10px 12px; }
  .bl-field { padding: 10px 12px; }
  /* the second line of each pair carries the gap that separates the pairs */
  .bl-field.bl-b, .bl-scope.bl-b, .bl-pair-remove { margin-bottom: 14px; }
  .bl-add { width: calc(100% - 36px); }
}
`;

// <<<SHARED option-menu — GENERATED, DO NOT EDIT HERE.
// Source: shared/option-menu.js  |  regenerate: node tools/sync-option-menu.mjs
const bfM = { el: null, key: null, outside: null, type: '', typeAt: 0, focusAfter: null, closeExtra: null };

const bfENUM_COLORS = ["red", "orange", "green", "cyan", "blue", "purple", "pink",
	"fuchsia", "rose", "stone", "teal", "sky", "indigo", "zinc", "yellow"];

function bfEnumVar(idx) {
	const n = bfENUM_COLORS[parseInt(idx, 10)] || "zinc";
	return "var(--enum-" + n + "-fg)";
}

function bfMenu(anchor, items, current, onPick, cfg) {
	bfCloseMenu();
	cfg = cfg || {};
	anchor.classList.add("qb-open");
	// Picking with the MOUSE leaves focus on <body>, so the rebuild that follows
	// has nothing to restore and Tab starts over from the top of the panel.
	// Remember the control the menu belongs to and hand focus back to it, so Tab
	// carries on to the next column from where you just were.
	bfM.focusAfter = (cfg.controlRef ? cfg.controlRef(anchor) : null);
	// Thymer's own picker markup, class for class — the app styles it for us.
	const menu = document.createElement("div");
	menu.className = "cmdpal--inline active qb-menu" + (cfg.dark ? " qb-menu-dark" : "");
	menu.style.position = "fixed";
	menu.addEventListener("mousedown", (e) => e.stopPropagation());
	bfM.el = menu;

	let search = null;
	if (cfg.search) {
		const ic = document.createElement("div");
		ic.className = "cmdpal--inline-input-container";
		const row = document.createElement("div");
		row.className = "cmdpal--inline-input-row";
		search = document.createElement("input");
		search.className = "cmdpal--inline-input";
		search.type = "text";
		search.spellcheck = false;
		search.placeholder = cfg.searchPlaceholder || "Search option ...";
		search.addEventListener("keydown", (e) => {
			// arrows + Enter belong to the list; the rest is typing
			if (["ArrowDown", "ArrowUp", "Enter", "Escape"].indexOf(e.key) < 0) e.stopPropagation();
		});
		search.addEventListener("input", () => paint());
		row.appendChild(search);
		ic.appendChild(row);
		menu.appendChild(ic);
	}
	const scroller = document.createElement("div");
	scroller.className = "autocomplete clickable";
	scroller.style.position = "relative";
	scroller.style.overflow = "hidden";
	const vnode = document.createElement("div");
	vnode.className = "vscroll-node";
	vnode.style.height = "100%";
	const list = document.createElement("div");
	list.className = "vcontent";
	vnode.appendChild(list);
	scroller.appendChild(vnode);
	menu.appendChild(scroller);

	let cells = [], active = -1;
	// Native marks the row under the cursor with `autocomplete--option-selected`
	// — the green fill and light text. Walking the list moves that mark, so the
	// row you are on always reads in the contrast colour, never grey.
	const highlight = (i, scroll) => {
		if (!cells.length) return;
		active = (i + cells.length) % cells.length;
		cells.forEach((c, k) => c.classList.toggle("autocomplete--option-selected", k === active));
		if (scroll !== false && cells[active].scrollIntoView) cells[active].scrollIntoView({ block: "nearest" });
	};
	const paint = () => {
		const q = (search && search.value || "").trim();
		// "+" is an AND across parts, and ranking is prefix-first — the same
		// contract as the Move To / Quick Capture picker.
		const parts = q ? q.toLowerCase().split("+").map((s) => s.trim()).filter(Boolean) : [];
		const scored = [];
		for (const it of items) {
			// Match against the label plus any alternate text (a keyword's @form).
			const lab = ((it.label || "") + (it.alt ? " " + it.alt : "")).toLowerCase();
			if (!parts.length) { scored.push({ it, s: 0 }); continue; }
			let total = 0, ok = true;
			for (const p of parts) {
				let s = 0;
				if (lab === p) s = 100;
				else if (lab.indexOf(p) === 0) s = 45;
				else if (new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(lab)) s = 25;
				else if (lab.indexOf(p) >= 0) s = 8;
				if (!s) { ok = false; break; }
				total += s;
			}
			if (ok) scored.push({ it, s: total });
		}
		if (parts.length) scored.sort((a, b) => b.s - a.s || a.it.label.length - b.it.label.length || a.it.label.localeCompare(b.it.label));
		list.innerHTML = "";
		cells = [];
		if (!scored.length) {
			const e = document.createElement("div");
			e.className = "qb-menu-empty";
			e.textContent = "No matches";
			list.appendChild(e);
			return;
		}
		scored.slice(0, 200).forEach(({ it }) => {
			const row = document.createElement("div");
			row.className = "autocomplete--option";
			row.setAttribute("data-v", it.v == null ? "" : String(it.v));
			if (cfg.dots !== false || it.icon || it.glyph) {
				const ic = document.createElement("span");
				ic.className = "autocomplete--option-icon";
				if (it.glyph) {
					ic.textContent = it.glyph;
				} else if (it.icon) {
					const g = document.createElement("span");
					g.className = "ti " + it.icon;
					ic.appendChild(g);
				} else {
					// No glyph on this option — a dot in its enum colour, like native.
					const d = document.createElement("span");
					d.className = "qb-mi-dot";
					d.style.color = bfEnumVar(it.color);
					ic.appendChild(d);
				}
				row.appendChild(ic);
			}
			const lb = document.createElement("span");
			lb.className = "autocomplete--option-label";
			lb.textContent = it.label;
			row.appendChild(lb);
			row.addEventListener("mouseenter", () => highlight(cells.indexOf(row), false));
			row.addEventListener("click", (e) => {
				e.stopPropagation();
				bfCloseMenu();
				onPick(it.v);
			});
			list.appendChild(row);
			cells.push(row);
		});
		// Start on whatever is already chosen, else the first row.
		const at = cells.findIndex((c) => c.getAttribute("data-v") === String(current == null ? "" : current));
		highlight(at >= 0 ? at : 0, false);
	};
	paint();

	// Up/Down walk the list, Enter takes the highlighted row — the menu is
	// keyboard-drivable whether or not it has a search box.
	const onKey = (e) => {
		if (!bfM.el) return;
		if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); highlight(active + 1); }
		else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); highlight(active - 1); }
		else if (e.key === "Enter") {
			if (active < 0 || !cells[active]) return;
			e.preventDefault(); e.stopPropagation();
			cells[active].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		} else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); bfCloseMenu(); }
		else if (!search && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// TYPE-AHEAD for the menus that have no search box — the joiner
			// (AND/OR/NOT), Show/NOT, the operators. They are three or four
			// items wide, so a search row would dwarf them, but a keyboard
			// user still has to be able to say which one ("man ska kunna
			// skriva AND/OR/NOT", his ask 2026-08-15). Same behaviour as a
			// native select: the letters pick the first label that starts
			// with what you typed, Enter takes it.
			const now = Date.now();
			if (now - (bfM.typeAt || 0) > 800) bfM.type = "";
			bfM.typeAt = now;
			bfM.type = (bfM.type || "") + e.key.toLowerCase();
			const hit = cells.findIndex((c) =>
				(c.textContent || "").trim().toLowerCase().indexOf(bfM.type) === 0);
			// One repeated letter walks the matches, the way a select does.
			if (hit < 0 && bfM.type.length > 1
				&& bfM.type.split("").every((ch) => ch === bfM.type[0])) {
				bfM.type = e.key.toLowerCase();
				const from = active + 1;
				const n = cells.length;
				for (let k = 0; k < n; k++) {
					const idx = (from + k) % n;
					if ((cells[idx].textContent || "").trim().toLowerCase().indexOf(bfM.type) === 0) {
						e.preventDefault(); e.stopPropagation(); highlight(idx);
						return;
					}
				}
				return;
			}
			if (hit >= 0) { e.preventDefault(); e.stopPropagation(); highlight(hit); }
		}
	};
	bfM.key = onKey;
	bfM.type = ""; bfM.typeAt = 0;
	document.addEventListener("keydown", onKey, true);

	document.body.appendChild(menu);
	/* cfg.alignTo lets a host line the menu up with the FIELD rather than with
	 * the control that opened it. A "+" button at the end of a row is a tiny
	 * anchor, and hanging a 300px menu off its left edge puts the menu far out
	 * to the right of the thing it belongs to (his 2026-08-15 report). */
	const r = (cfg.alignTo || anchor).getBoundingClientRect();
	const M = 8;
	// Native picker width, never narrower than the control it belongs to.
	menu.style.width = Math.max(r.width, cfg.width != null ? cfg.width : 320) + "px";
	menu.style.maxWidth = "calc(100vw - 20px)";
	// The list scrolls at the native 350px, or shrinks to fit a short one. Measured
	// from the rendered content, not counted: native rows are 26px and the estimate
	// here was 30, which left a visible strip of dead space under a short list.
	const wanted = list.scrollHeight || (list.children.length * 26);
	scroller.style.height = Math.min(350, Math.max(30, wanted)) + "px";
	const h = menu.offsetHeight;
	// Value menus align on their RIGHT edge with the control; the rest hang left.
	const left = cfg.alignRight ? (r.right - menu.offsetWidth) : r.left;
	menu.style.left = Math.max(M, Math.min(left, window.innerWidth - menu.offsetWidth - M)) + "px";
	let top = r.bottom + 4;
	if (top + h > window.innerHeight - M) top = Math.max(M, r.top - 4 - h);
	menu.style.top = top + "px";
	if (search) search.focus();

	bfM.outside = (e) => {
		if (menu.contains(e.target) || anchor.contains(e.target)) return;
		bfCloseMenu();
	};
	document.addEventListener("mousedown", bfM.outside, true);
}

function bfCloseMenu() {
	if (bfM.closeExtra) { try { bfM.closeExtra(); } catch (e) {} }
	if (bfM.key) { document.removeEventListener("keydown", bfM.key, true); bfM.key = null; }
	if (bfM.outside) { document.removeEventListener("mousedown", bfM.outside, true); bfM.outside = null; }
	if (bfM.el) { bfM.el.remove(); bfM.el = null; }
	document.querySelectorAll(".qb-sel.qb-open").forEach((b) => b.classList.remove("qb-open"));
}

// The menu's stylesheet, appended to the host's CSS string.
const bfMENU_CSS = `
.qb-sel.qb-open, .qb-val:focus { border-color: var(--ed-button-primary-bg, #4caea1); }
.qb-menu { z-index: 100002; padding-bottom: 10px; border-radius: 4px; }
.qb-menu .vscroll-node { overflow-y: auto; scrollbar-width: none; }
.qb-menu .vscroll-node::-webkit-scrollbar { width: 0; height: 0; }
.qb-menu .autocomplete--option { cursor: pointer; }
.qb-menu .autocomplete--option { gap: 11px; }
.qb-menu .cmdpal--inline-input { font-size: var(--text-size-smaller, .8125rem); }
.qb-menu-empty { padding: 6px 10px; opacity: .6; }
.qb-menu .autocomplete--option-icon {
	flex: 0 0 16px; width: 16px; min-width: 16px; height: 16px;
	display: inline-flex; align-items: center; justify-content: center;
}
.qb-menu .autocomplete--option-icon > .ti { line-height: 1; }
.qb-mi-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.qb-menu.qb-menu-dark .autocomplete--option { color: #AFAFB0; justify-content: center; font-weight: 600; letter-spacing: .04em; }
.qb-menu.qb-menu-dark .autocomplete--option:hover { background: #3B3B42; }
.qb-menu.qb-menu-dark .autocomplete--option-selected:hover { background: #313E44; color: var(--ed-button-primary-bg, #4caea1); }
.qb-menu.qb-menu-dark .autocomplete--option-selected[data-v="NOT"]:hover { color: var(--enum-red-fg, #e06c6c); }
`;
// >>>SHARED

class Plugin extends AppPlugin {
  _DEFAULT_PAIRS = []; // nothing is mirrored until the user configures a pair
  _pairs = [];          // canonical [[a, b], ...]
  _partner = new Map(); // fieldName -> partner fieldName
  _fields = [];         // all paired field names

  _observer = null;
  _pending = new Map();      // recGuid -> debounce timeout id
  _firstPending = new Map(); // recGuid -> time first scheduled (for max-wait)
  _DEBOUNCE_MS = 250;
  _MAX_WAIT_MS = 800;        // fire even if mutations keep thrashing (empty-field re-render loop)

  _cache = new Map();   // `${recGuid}\n${field}` -> last-known array of linked guids
  _seeded = new Set();  // recGuids whose baseline has been captured
  _conflicts = [];      // single-value destinations we skipped this reconcile

  // collectionGuid -> Map(fieldLabel -> many). Backstop for isMultiValue() so the
  // single-value guard can never quietly switch itself off.
  _schema = new Map();
  _schemaRefreshing = false;
  _guardWarned = false;

  _cmdSettings = null;

  // settings dialog state
  _settingsEl = null;
  _shellEl = null;
  _popEl = null;
  _popAnchor = null;
  _model = null;
  _avail = [];

  onLoad() {
    this._loadPairs();
    this._loadSchema();
    try { this.ui.injectCSS(DASH_CSS + bfMENU_CSS); } catch (e) { console.error("[bilinks] injectCSS", e); }
    bfM.closeExtra = () => { try { this.closePopover(); } catch (e) {} };

    this._observer = new MutationObserver((muts) => {
      try { this._onMutations(muts); } catch (e) { console.error("[bilinks] observe", e); }
    });
    this._observer.observe(document.body, { childList: true, subtree: true });

    // Capture baselines for pages already open, so their first edit diffs correctly.
    try { this._seedOpenPanels(); } catch (e) { console.error("[bilinks] seed", e); }

    try {
      this._cmdSettings = this.ui.addCommandPaletteCommand({
        label: "Bidirectional Fields: Settings",
        icon: "ti-arrows-exchange",
        onSelected: () => this.openSettings(),
      });
    } catch (e) { console.error("[bilinks] addCommandPaletteCommand failed", e); }
  }

  onUnload() {
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    for (const t of this._pending.values()) clearTimeout(t);
    this._pending.clear();
    this._firstPending.clear();
    this._cache.clear();
    this._seeded.clear();
    if (this._cmdSettings && this._cmdSettings.remove) this._cmdSettings.remove();
    this.closeSettings();
  }

  /* ---------- configuration ---------- */

  // A pair is {a, aCol, b, bCol}: two field names, each with an OPTIONAL collection
  // guid that limits which pages the rule applies to (null = any collection). The
  // older ["A","B"] shape is still accepted and means "any ↔ any".
  _loadPairs() {
    let pairs = this._DEFAULT_PAIRS;
    try {
      const custom = this.getConfiguration && this.getConfiguration().custom;
      const raw = custom && custom.pairs;
      if (Array.isArray(raw)) {
        // An explicit (even empty) array is honoured; only an absent key falls back to default.
        pairs = raw.map((p) => this._normalizePair(p)).filter(Boolean);
      }
    } catch (e) { console.error("[bilinks] config read failed, using defaults", e); }
    this._applyPairs(pairs);
  }

  _normalizePair(p) {
    if (Array.isArray(p)) {
      if (p.length !== 2 || !p[0] || !p[1]) return null;
      return { a: String(p[0]), aCol: null, b: String(p[1]), bCol: null };
    }
    if (p && typeof p === "object" && p.a && p.b) {
      return { a: String(p.a), aCol: p.aCol ? String(p.aCol) : null,
               b: String(p.b), bCol: p.bCol ? String(p.bCol) : null };
    }
    return null;
  }

  // Set the active pairs and rebuild the lookup. `_partner` maps a field name to
  // the list of rules it takes part in: for an edit to `field` on a page in
  // `myCol` (or any, if null), mirror onto `partner` of targets in `theirCol`
  // (or any). Each pair contributes one rule per direction.
  _applyPairs(pairs) {
    // Accept either shape here too, so no caller can hand us un-normalized pairs.
    this._pairs = (Array.isArray(pairs) ? pairs : []).map((p) => this._normalizePair(p)).filter(Boolean);
    this._partner = new Map();
    const add = (field, rule) => {
      if (!this._partner.has(field)) this._partner.set(field, []);
      this._partner.get(field).push(rule);
    };
    for (const p of this._pairs) {
      add(p.a, { partner: p.b, myCol: p.aCol, theirCol: p.bCol });
      add(p.b, { partner: p.a, myCol: p.bCol, theirCol: p.aCol });
    }
    this._fields = Array.from(this._partner.keys());
  }

  // Does `rec` sit in collection `col`? A null col matches everything.
  _inCollection(rec, col) {
    if (!col) return true;
    return this._collectionGuid(rec) === col;
  }

  /* ---------- change detection ---------- */

  // We can't reliably resolve the edited record from a mutation target — during a
  // re-render the node is often already detached (closest() returns null), which is
  // exactly what happens when a multi-value field is emptied. So instead: detect
  // that *some* property-area change happened, then reconcile every open page,
  // resolved from the stable, always-attached .panel-heading elements. Reconcile
  // is delta-based, so pages that didn't change are no-ops.
  _onMutations(muts) {
    let relevant = false;
    for (const m of muts) {
      const t = m.target;
      if (t && t.closest && t.closest(".panel-properties, .id-prop-row, .page-props-cell")) { relevant = true; break; }
      if (this._looksLikeProps(m.addedNodes) || this._looksLikeProps(m.removedNodes)) { relevant = true; break; }
    }
    if (!relevant) return;
    document.querySelectorAll(".panel-heading[data-banner-drop]").forEach((h) => {
      if (h.getAttribute("data-is-collection") === "true") return;
      const g = h.getAttribute("data-banner-drop");
      if (!g) return;
      if (!this._seeded.has(g)) this._seedRecord(g); // baseline before first edit is processed
      this._schedule(g);
    });
  }

  _looksLikeProps(nodes) {
    for (const n of nodes) {
      if (n && n.nodeType === 1) {
        const c = typeof n.className === "string" ? n.className : (n.className && n.className.baseVal) || "";
        if (/prop/.test(c)) return true;
      }
    }
    return false;
  }

  _now() { try { return performance.now(); } catch (_) { return 0; } }

  _schedule(recGuid) {
    const now = this._now();
    if (!this._firstPending.has(recGuid)) this._firstPending.set(recGuid, now);
    if (this._pending.has(recGuid)) {
      // Keep debouncing, but don't let a continuous re-render loop postpone us forever.
      if (now - this._firstPending.get(recGuid) < this._MAX_WAIT_MS) clearTimeout(this._pending.get(recGuid));
      else return; // max wait reached — let the pending timer fire
    }
    const t = setTimeout(() => {
      this._pending.delete(recGuid);
      this._firstPending.delete(recGuid);
      try { this._reconcile(recGuid); } catch (e) { console.error("[bilinks] reconcile", e); }
    }, this._DEBOUNCE_MS);
    this._pending.set(recGuid, t);
  }

  /* ---------- baseline seeding ---------- */

  _seedOpenPanels() {
    document.querySelectorAll(".panel-heading[data-banner-drop]").forEach((h) => {
      if (h.getAttribute("data-is-collection") === "true") return;
      const g = h.getAttribute("data-banner-drop");
      if (g && !this._seeded.has(g)) this._seedRecord(g);
    });
  }

  _seedRecord(recGuid) {
    this._seeded.add(recGuid);
    const rec = this.data.getRecord(recGuid);
    if (!rec) return;
    for (const F of this._fields) {
      const prop = rec.prop(F);
      this._cache.set(this._key(recGuid, F), prop ? this._linkedGuids(prop) : []);
    }
  }

  _key(recGuid, field) { return recGuid + "\n" + field; }

  /* ---------- value helpers ---------- */

  // Record-type fields expose their linked page guids via texts() (prop.value is
  // undefined at runtime). Empty field -> [].
  _linkedGuids(prop) {
    if (!prop) return [];
    try {
      const t = prop.texts();
      return Array.isArray(t) ? t.filter((x) => typeof x === "string" && x.length > 0) : [];
    } catch (e) { return []; }
  }

  /* ---------- core sync (delta-driven) ---------- */

  _reconcile(recGuid) {
    const rec = this.data.getRecord(recGuid);
    if (!rec) return;
    this._conflicts = [];
    let added = 0, removed = 0;
    for (const F of this._fields) {
      const prop = rec.prop(F);
      if (!prop) continue;
      const cur = this._linkedGuids(prop);
      const key = this._key(recGuid, F);
      const old = this._cache.get(key);
      if (old === undefined) { this._cache.set(key, cur); continue; } // adopt baseline, no writes
      // Only rules whose source scope includes this page apply. A rule with a
      // collection on the far side is checked per target inside add/remove.
      const rules = (this._partner.get(F) || []).filter((r) => this._inCollection(rec, r.myCol));
      if (rules.length) {
        for (const v of cur) {
          if (v === recGuid || old.indexOf(v) !== -1) continue;
          for (const r of rules) if (this._addLink(v, r.partner, recGuid, r.theirCol)) added++;
        }
        for (const v of old) {
          if (v === recGuid || cur.indexOf(v) !== -1) continue;
          for (const r of rules) if (this._removeLink(v, r.partner, recGuid, r.theirCol)) removed++;
        }
      }
      this._cache.set(key, cur);
    }
    if (added || removed) this._toast(added, removed);
    if (this._conflicts.length) this._toastConflicts(this._conflicts);
  }

  // Append src into target.partnerField (existing values preserved). Updates our
  // cache so the target's own reconcile sees no delta from this write.
  _addLink(targetGuid, partnerField, src, targetCol) {
    const t = this.data.getRecord(targetGuid);
    if (!t) return false;
    if (!this._inCollection(t, targetCol)) return false; // outside the pair's scope
    const prop = t.prop(partnerField);
    if (!prop) return false;
    const cur = this._linkedGuids(prop);
    const key = this._key(targetGuid, partnerField);
    if (cur.indexOf(src) !== -1) { this._cache.set(key, cur); return false; }
    // Single-value destination already holding a different value: appending would be
    // silently coerced (old value kept, our write dropped), leaving the pair one-sided.
    // Don't corrupt or overwrite — skip and surface the conflict.
    if (cur.length && !this._isMulti(prop, t, partnerField)) {
      this._conflicts.push({ target: targetGuid, field: partnerField, src, held: cur[0] });
      this._cache.set(key, cur);
      return false;
    }
    const next = cur.concat([src]);
    prop.set(next);
    this._cache.set(key, next);
    return true;
  }

  // Does this field accept multiple values? Two independent sources, because a
  // guard that can silently switch itself off has the same shape as the bug it
  // replaces: (1) the runtime accessor, (2) the collection schema's `many` flag.
  // If BOTH are unavailable we still append (multi-value is the common case), but
  // we say so once instead of quietly reverting to the old behaviour.
  _isMulti(prop, rec, label) {
    try { if (typeof prop.isMultiValue === "function") return prop.isMultiValue(); } catch (e) {}
    const fromSchema = this._manyFromSchema(rec, label);
    if (fromSchema !== null) return fromSchema;
    this._warnGuardUnavailable(label);
    return true;
  }

  // Cached schema lookup: collection guid -> field label -> many.
  // Matched by LABEL, never by field id: ids differ per collection and some
  // collections genuinely share them.
  _manyFromSchema(rec, label) {
    const colGuid = this._collectionGuid(rec);
    if (!colGuid) return null;
    const fields = this._schema.get(colGuid);
    if (!fields) { this._loadSchema(); return null; } // unknown collection: refresh for next time
    const many = fields.get(label);
    return many === undefined ? null : many;
  }

  // Public path first (the built-in "Collection" property holds the guid),
  // private row as backup. Reshape resolves collections the same way.
  _collectionGuid(rec) {
    try {
      const p = rec.prop("Collection");
      const g = p && (p.choice ? p.choice() : null);
      if (g) return g;
    } catch (e) {}
    try {
      const row = rec._getRow && rec._getRow();
      if (row && row.pguid) return row.pguid;
    } catch (e) {}
    return null;
  }

  _loadSchema() {
    if (this._schemaRefreshing) return;
    this._schemaRefreshing = true;
    Promise.resolve()
      .then(() => this.data.getAllCollections())
      .then((cols) => {
        const next = new Map();
        for (const c of cols || []) {
          const cfg = (c.getConfiguration && c.getConfiguration()) || {};
          const fields = new Map();
          for (const f of cfg.fields || []) {
            if (f && f.label) fields.set(f.label, !!f.many);
          }
          next.set(c.getGuid(), fields);
        }
        this._schema = next;
      })
      .catch((e) => console.error("[bilinks] schema load failed", e))
      .then(() => { this._schemaRefreshing = false; });
  }

  _warnGuardUnavailable(label) {
    if (this._guardWarned) return;
    this._guardWarned = true;
    console.warn("[bilinks] cannot determine whether '" + label + "' is multi-value " +
      "(isMultiValue() and the collection schema were both unavailable); appending as usual, " +
      "so a single-value field that is already set may not receive its back-link.");
    try {
      this.ui.addToaster({
        title: "Bidirectional Fields",
        message: "Could not check whether “" + label + "” allows multiple values, so links are being added without that safeguard. Reciprocals may be missed on single-value fields.",
        dismissible: true,
      });
    } catch (_) {}
  }

  // Remove src from target.partnerField. Updates cache likewise.
  _removeLink(targetGuid, partnerField, src, targetCol) {
    const t = this.data.getRecord(targetGuid);
    if (!t) return false;
    if (!this._inCollection(t, targetCol)) return false; // outside the pair's scope
    const prop = t.prop(partnerField);
    if (!prop) return false;
    const cur = this._linkedGuids(prop);
    const key = this._key(targetGuid, partnerField);
    if (cur.indexOf(src) === -1) { this._cache.set(key, cur); return false; }
    const next = cur.filter((g) => g !== src);
    prop.set(next);
    this._cache.set(key, next);
    return true;
  }

  _toast(added, removed) {
    try {
      const parts = [];
      if (added) parts.push("+" + added);
      if (removed) parts.push("−" + removed);
      this.ui.addToaster({
        title: "Bidirectional Fields",
        message: parts.join(" / ") + " back-link" + (added + removed === 1 ? "" : "s") + ".",
        dismissible: false,
        autoDestroyTime: 2200,
      });
    } catch (_) {}
  }

  // Surface reciprocals we couldn't write because the destination is single-value
  // and already occupied. Visible, dismissible, and never silently discarded.
  _toastConflicts(conflicts) {
    try {
      let message;
      if (conflicts.length === 1) {
        const c = conflicts[0];
        message = "“" + this._title(c.target) + "” · " + c.field +
          " allows only one value (already “" + this._title(c.held) +
          "”), so “" + this._title(c.src) + "” wasn’t linked back.";
      } else {
        message = conflicts.length + " reciprocal links weren’t added: the target field allows only one value and is already set.";
      }
      this.ui.addToaster({
        title: "Bidirectional Fields",
        message: message,
        dismissible: true,
        autoDestroyTime: 7000,
      });
    } catch (_) {}
  }

  // Best-effort readable page name for a guid; falls back to the guid.
  _title(guid) {
    try {
      const r = this.data.getRecord(guid);
      if (r && typeof r.getName === "function") {
        const n = r.getName();
        if (n) return n;
      }
    } catch (e) {}
    return guid;
  }

  /* =================== settings dialog =================== */

  async openSettings() {
    this.closeSettings();

    // Candidate field names: record-type (page-link) properties across all
    // collections, plus any names already paired. Also a collection list for the
    // scope pickers, and which record fields each collection has (to filter the
    // field picker once a scope is chosen).
    const names = new Set();
    this._cols = [];              // [{guid, name, fields:Set<label>}]
    try {
      const cols = await this.data.getAllCollections();
      for (const c of cols) {
        const cfg = (c.getConfiguration && c.getConfiguration()) || {};
        const fields = new Set();
        for (const f of (cfg.fields || [])) {
          if (f && f.label && f.type === "record" && f.active !== false) { names.add(f.label); fields.add(f.label); }
        }
        this._cols.push({ guid: c.getGuid(), name: c.getName(), icon: (cfg.icon && String(cfg.icon)) || null, fields });
      }
      this._cols.sort((x, y) => x.name.localeCompare(y.name));
    } catch (e) { console.error("[bilinks] gather fields", e); }
    for (const p of this._pairs) { if (p.a) names.add(p.a); if (p.b) names.add(p.b); }
    this._avail = Array.from(names).sort((a, b) => a.localeCompare(b));

    this._model = this._pairs.map((p) => ({ a: p.a || "", aCol: p.aCol || null, b: p.b || "", bCol: p.bCol || null }));
    if (!this._model.length) this._model.push({ a: "", aCol: null, b: "", bCol: null });

    const backdrop = document.createElement("div");
    backdrop.className = "bl-backdrop";
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) this.closeSettings(); });
    this._shellEl = document.createElement("div");
    this._shellEl.className = "bl-shell";
    backdrop.appendChild(this._shellEl);
    document.body.appendChild(backdrop);
    this._settingsEl = backdrop;
    backdrop.classList.add(this._isDarkTheme() ? "bl-dark" : "bl-light");
    this._settingsKeyHandler = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (bfM.el) bfCloseMenu();
        else if (this._popEl) this.closePopover();
        else this.closeSettings();
      }
    };
    document.addEventListener("keydown", this._settingsKeyHandler, true);

    this.renderSettings();
  }

  closeSettings() {
    bfCloseMenu();
    this.closePopover();
    if (this._settingsEl) { this._settingsEl.remove(); this._settingsEl = null; this._shellEl = null; }
    if (this._settingsKeyHandler) { document.removeEventListener("keydown", this._settingsKeyHandler, true); this._settingsKeyHandler = null; }
  }

  mk(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  // Is the active Thymer theme dark? Decided from the resolved surface colour
  // rather than the theme's name, so it holds for any custom or third-party theme.
  _isDarkTheme() {
    const lum = this._luminance(this._readVar("--modal-bg")) ;
    if (lum != null) return lum < 0.5;
    const textLum = this._luminance(this._readVar("--text-color"));
    if (textLum != null) return textLum >= 0.5; // light text implies a dark surface
    try {
      const t = JSON.parse(localStorage.getItem("theme") || "{}");
      if (t.appearance === "dark") return true;
      if (t.appearance === "light") return false;
    } catch (e) {}
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
    return true;
  }

  _readVar(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
    catch (e) { return ""; }
  }

  // Rough relative luminance from any of the colour syntaxes Thymer emits
  // (color(display-p3 r g b) with 0-1 channels, rgb()/rgba(), or hex). null if unparsed.
  _luminance(str) {
    if (!str) return null;
    let r, g, b;
    let m = str.match(/color\(\s*[\w-]+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    else if ((m = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i))) {
      r = +m[1] / 255; g = +m[2] / 255; b = +m[3] / 255;
    } else if ((m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))) {
      let h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      r = parseInt(h.slice(0, 2), 16) / 255;
      g = parseInt(h.slice(2, 4), 16) / 255;
      b = parseInt(h.slice(4, 6), 16) / 255;
    } else return null;
    if ([r, g, b].some((v) => typeof v !== "number" || isNaN(v))) return null;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  searchIcon() {
    const span = document.createElement("span");
    span.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
    span.style.display = "flex";
    return span;
  }

  renderSettings() {
    if (!this._shellEl) return;
    bfCloseMenu();
    this.closePopover();
    const shell = this._shellEl;
    shell.innerHTML = "";

    const head = this.mk("div", "bl-head");
    head.appendChild(this.mk("h2", "bl-title", "Bidirectional Fields"));
    head.appendChild(this.mk("p", "bl-desc", "Pair two page-link property fields so they mirror each other. Set a link in one field on a page and the matching back-link is added on the other page, and removed when you remove it. Both directions. Each side works across all collections unless you limit it to one."));
    shell.appendChild(head);

    const body = this.mk("div", "bl-body");

    const sec = this.mk("div", "bl-sec");
    sec.appendChild(this.mk("span", "bl-label", "Field pairs"));
    sec.appendChild(this.mk("span", "bl-count-pill", String(this._model.length)));
    body.appendChild(sec);

    // Header and rows share ONE grid so the labels can never drift from the columns.
    const grid = this.mk("div", "bl-grid");
    for (const t of ["Field", "In collection", "", "Pairs with", "In collection", ""]) grid.appendChild(this.mk("div", "bl-gh", t));
    grid.appendChild(this.mk("div", "bl-gdiv"));
    this._model.forEach((p, i) => this.renderPairRow(grid, p, i));
    body.appendChild(grid);

    const add = this.mk("button", "bl-add", "+ Add Pair");
    add.addEventListener("click", () => {
      this._model.push({ a: "", aCol: null, b: "", bCol: null });
      this.renderSettings();
      // focus goes to the new row's field A
      const fields = this._shellEl && this._shellEl.querySelectorAll(".bl-grid .bl-field");
      if (fields && fields.length >= 2) fields[fields.length - 2].focus();
    });
    body.appendChild(add);

    body.appendChild(this.mk("p", "bl-hint", "Pick from your existing record (page-link) properties, or type any name. A pair with the same name on both sides makes a single self-symmetric field."));
    shell.appendChild(body);

    const foot = this.mk("div", "bl-foot");
    const cancel = this.mk("button", "bl-btn", "Cancel");
    cancel.addEventListener("click", () => this.closeSettings());
    const save = this.mk("button", "bl-btn bl-btn-primary", "Save");
    save.addEventListener("click", () => this.saveSettings(save));
    foot.append(cancel, save);
    shell.appendChild(foot);
  }

  // Appends the six cells of one pair to the shared grid:
  // field A · scope A · ⇔ · field B · scope B · remove.
  renderPairRow(grid, p, i) {
    grid.appendChild(this.fieldSlot(p, "a", "aCol"));
    grid.appendChild(this.scopeSlot(p, "aCol", "a"));
    grid.appendChild(this.mk("div", "bl-arrow", "\u21D4"));
    grid.appendChild(this.fieldSlot(p, "b", "bCol"));
    grid.appendChild(this.scopeSlot(p, "bCol", "b"));
    const x = this.mk("button", "bl-pair-remove", "\u00D7");
    x.title = "Remove pair";
    x.addEventListener("click", () => { this._model.splice(i, 1); this.renderSettings(); });
    grid.appendChild(x);
  }

  fieldSlot(p, key, colKey) {
    const btn = this.mk("button", "bl-field bl-" + key + (p[key] ? "" : " empty"), p[key] || "Choose field\u2026");
    btn.title = p[key] || "";
    btn.addEventListener("click", () => this.openFieldPicker(btn, p, key, colKey));
    return btn;
  }

  // Scope dropdown: reads "All" (quiet) or the collection name (teal), with a caret.
  scopeSlot(p, colKey, fieldKey) {
    const col = p[colKey] ? this._colByGuid(p[colKey]) : null;
    const btn = this.mk("button", "bl-scope bl-" + fieldKey + (p[colKey] ? " set" : ""));
    btn.appendChild(this.mk("span", "lbl", p[colKey] ? (col ? col.name : "Unknown collection") : "All"));
    btn.appendChild(this.mk("span", "caret", "\u25BE"));
    btn.title = p[colKey] ? "Limited to " + (col ? col.name : "a collection") : "All collections";
    btn.addEventListener("click", () => this.openScopePicker(btn, p, colKey, fieldKey));
    return btn;
  }

  _colByGuid(guid) {
    return (this._cols || []).find((c) => c.guid === guid) || null;
  }

  // Collection picker (design 1e, with the shared option-menu as its list): a
  // two-option switch on top. "All collections" applies at once; "One
  // collection" activates the list below, which is the shared native cmdpal
  // menu (theme colours, each collection's own icon, search, keyboard walking)
  // embedded flush inside our popover. Under "All" the list stays visible but
  // inert, so the default needs no reading. Closing without a choice changes
  // nothing: we only write on a choice.
  openScopePicker(anchor, p, colKey, fieldKey) {
    const r0 = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(360, Math.round(r0.width)), window.innerWidth - 24);
    let mode = p[colKey] ? "one" : "all";
    const f = p[fieldKey];
    const cols = this._cols || [];
    const has = f ? cols.filter((c) => c.fields.has(f)) : cols;
    const not = f ? cols.filter((c) => !c.fields.has(f)) : [];
    const items = has.concat(not).map((c) => ({ v: c.guid, label: c.name, icon: c.icon || "ti-folder" }));

    let bAll, bOne, note, embed;
    this.openPopover(anchor, width, (pop) => {
      const seg = this.mk("div", "bl-seg");
      bAll = this.mk("button", null, "All collections");
      bOne = this.mk("button", null, "One collection");
      seg.append(bAll, bOne);
      pop.appendChild(seg);
      note = this.mk("div", "bl-seg-note", "The field pairs on every page, whatever collection it belongs to.");
      pop.appendChild(note);
      pop.appendChild(this.mk("div", "bl-pop-sep"));
      embed = this.mk("div", "bl-embed");
      pop.appendChild(embed);
    });
    const pop = this._popEl;
    if (!pop) return;

    // Under "All", arrows/Enter must not walk or pick from the inert list. This
    // listener is registered BEFORE the menu's, so it runs first and can stop it;
    // it does not preventDefault, so Enter/Space still activate the focused button.
    this._scopeKey = (e) => {
      if (mode !== "all") return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") e.stopImmediatePropagation();
    };
    document.addEventListener("keydown", this._scopeKey, true);

    // Mount the shared menu, then move it into our popover and neutralise its
    // own positioning. The popover is passed as the menu's anchor so clicks on
    // the switch count as "inside" for the menu's outside-click handler.
    // bfMenu begins with bfCloseMenu(), whose closeExtra hook would close the
    // popover we just opened; suspend the hook for the mount, restore it after.
    bfM.closeExtra = null;
    bfMenu(pop, items, p[colKey] || "", (v) => {
      p[colKey] = v ? String(v) : null;
      this.renderSettings();
    }, { search: true, searchPlaceholder: "Search collections\u2026", dots: false, width, controlRef: () => anchor });
    bfM.closeExtra = () => { try { this.closePopover(); } catch (e) {} };
    const menu = bfM.el;
    if (menu) {
      embed.appendChild(menu);
      menu.style.position = "static"; menu.style.left = ""; menu.style.top = ""; menu.style.width = ""; menu.style.maxWidth = "";
    }
    const input = embed.querySelector("input");

    const paint = () => {
      bAll.classList.toggle("on", mode === "all");
      bOne.classList.toggle("on", mode === "one");
      note.style.display = mode === "all" ? "" : "none";
      embed.classList.toggle("inert", mode === "all");
      if (input) input.disabled = mode === "all";
      this._placeScopePopover(pop, anchor, width);
    };
    bAll.addEventListener("click", () => { p[colKey] = null; this.renderSettings(); }); // terminal: revert to All
    bOne.addEventListener("click", () => { mode = "one"; paint(); if (input) input.focus(); });
    paint();
    setTimeout(() => { if (mode === "one") { if (input) input.focus(); } else bOne.focus(); }, 0);
  }

  openFieldPicker(anchor, p, key, colKey) {
    // If this side is scoped to a collection, offer that collection's record
    // fields first; the rest stay reachable further down.
    const scoped = colKey && p[colKey] ? this._colByGuid(p[colKey]) : null;
    const rank = (n) => (scoped && scoped.fields.has(n) ? 0 : 1);
    this.openPopover(anchor, 280, (pop) => {
      const search = this.mk("div", "bl-search");
      search.appendChild(this.searchIcon());
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Search or type a field name…";
      search.appendChild(input);
      pop.appendChild(search);

      const list = this.mk("div", "bl-pop-list");
      pop.appendChild(list);
      const foot = this.mk("div", "bl-pop-foot");
      pop.appendChild(foot);

      const choose = (name) => { p[key] = name; this.renderSettings(); };
      const fill = () => {
        list.innerHTML = "";
        const q = input.value.trim();
        const ql = q.toLowerCase();
        const items = this._avail
          .filter((n) => !ql || n.toLowerCase().includes(ql))
          .sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
        for (const n of items) {
          const item = this.mk("div", "bl-pop-item" + (scoped && !scoped.fields.has(n) ? " dim" : ""));
          item.appendChild(this.mk("span", "plus", "+"));
          item.appendChild(this.mk("span", "nm", n));
          if (scoped && !scoped.fields.has(n)) item.title = "Not a field of " + scoped.name;
          item.addEventListener("click", () => choose(n));
          list.appendChild(item);
        }
        if (!items.length) list.appendChild(this.mk("div", "bl-empty", q ? "No matching property." : "No record properties found."));
        const exact = this._avail.some((n) => n.toLowerCase() === ql);
        if (q && !exact) {
          foot.className = "bl-pop-foot act";
          foot.textContent = 'Use “' + q + '” as a custom name';
          foot.onclick = () => choose(q);
        } else {
          foot.className = "bl-pop-foot";
          foot.textContent = items.length + " field" + (items.length === 1 ? "" : "s") + " · click to choose";
          foot.onclick = null;
        }
        return items;
      };
      let current = fill();
      input.addEventListener("input", () => { current = fill(); });
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const q = input.value.trim();
        if (current.length) choose(current[0]);
        else if (q) choose(q);
      });
    });
  }

  /* --- portaled, flip-aware popover (mirrors Smart Titles) --- */

  openPopover(anchor, width, build) {
    bfCloseMenu();
    this.closePopover();
    const pop = this.mk("div", "bl-popover");
    pop.style.width = width + "px";
    build(pop);
    this._settingsEl.appendChild(pop);
    this._positionPopover(pop, anchor, width);

    this._popEl = pop;
    this._popAnchor = anchor;
    anchor.classList.add("open");
    this._popOutsideHandler = (e) => { if (pop.contains(e.target) || anchor.contains(e.target)) return; this.closePopover(); };
    this._popScrollHandler = (e) => { if (e && e.target && pop.contains(e.target)) return; this.closePopover(); };
    setTimeout(() => {
      document.addEventListener("mousedown", this._popOutsideHandler, true);
      document.addEventListener("scroll", this._popScrollHandler, true);
      window.addEventListener("resize", this._popScrollHandler);
    }, 0);
    const inp = pop.querySelector("input");
    if (inp) inp.focus();
  }

  // Align to the trigger's left edge; if that would spill past the dialog,
  // align to its right edge instead. Flip above when there is no room below.
  _positionPopover(pop, anchor, width) {
    const r = anchor.getBoundingClientRect();
    const ph = pop.offsetHeight;
    const shellR = this._shellEl ? this._shellEl.getBoundingClientRect() : null;
    let left = r.left;
    if (shellR && left + width > shellR.right - 8) left = r.right - width;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom;
    let top;
    if (below < ph + 12 && r.top > below) top = Math.max(8, r.top - ph - 6);
    else top = Math.min(r.bottom + 6, window.innerHeight - ph - 8);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  // Placement for the scope picker. The switch is ALWAYS at the top, so the
  // popover never flips above the trigger. Open below the button; if that runs
  // past the bottom, first shrink the embedded list, but only down to a
  // comfortable height, then slide the whole popover up over the row so it
  // keeps a real bottom margin instead of hugging the edge with a squeezed list.
  _placeScopePopover(pop, anchor, width) {
    const M = 8, GAP = 6, MB = 28, COMFORT = 260, MIN_LIST = 160;
    const r = anchor.getBoundingClientRect();
    const scroller = pop.querySelector(".bl-embed .autocomplete");
    if (scroller && !scroller.dataset.natural) scroller.dataset.natural = String(scroller.offsetHeight || 350);
    const natural = scroller ? parseFloat(scroller.dataset.natural) : 0;
    if (scroller) scroller.style.height = natural + "px";
    let ph = pop.offsetHeight;
    let top = r.bottom + GAP;
    const limit = window.innerHeight - MB;
    if (top + ph > limit && scroller) {                 // shrink, but stay comfortable
      scroller.style.height = Math.max(COMFORT, natural - (top + ph - limit)) + "px";
      ph = pop.offsetHeight;
    }
    if (top + ph > limit) {                              // still too low: slide up over the row
      top = limit - ph;
      if (top < M && scroller) {                         // tiny viewport: go to the floor
        scroller.style.height = Math.max(MIN_LIST, parseFloat(scroller.style.height) - (M - top)) + "px";
        ph = pop.offsetHeight;
        top = Math.max(M, limit - ph);
      }
    }
    const shellR = this._shellEl ? this._shellEl.getBoundingClientRect() : null;
    let left = r.left;
    if (shellR && left + width > shellR.right - 8) left = r.right - width;
    left = Math.min(Math.max(M, left), window.innerWidth - width - M);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  closePopover() {
    const pop = this._popEl;
    if (!pop) return;
    this._popEl = null; // clear FIRST: bfCloseMenu -> closeExtra re-enters here and must no-op
    if (this._scopeKey) { document.removeEventListener("keydown", this._scopeKey, true); this._scopeKey = null; }
    bfCloseMenu(); // the embedded native list, if any, goes with the popover
    pop.remove();
    if (this._popAnchor) {
      this._popAnchor.classList.remove("open");
      // Return focus to the trigger (Escape / outside click), if it still exists.
      try { if (this._popAnchor.isConnected && document.activeElement === document.body) this._popAnchor.focus(); } catch (e) {}
      this._popAnchor = null;
    }
    if (this._popOutsideHandler) { document.removeEventListener("mousedown", this._popOutsideHandler, true); this._popOutsideHandler = null; }
    if (this._popScrollHandler) {
      document.removeEventListener("scroll", this._popScrollHandler, true);
      window.removeEventListener("resize", this._popScrollHandler);
      this._popScrollHandler = null;
    }
  }

  async saveSettings(saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      // Unscoped pairs keep the compact ["A","B"] form; scoped ones are objects.
      const pairs = this._model
        .map((p) => ({ a: (p.a || "").trim(), aCol: p.aCol || null, b: (p.b || "").trim(), bCol: p.bCol || null }))
        .filter((p) => p.a && p.b);
      const stored = pairs.map((p) => (p.aCol || p.bCol) ? p : [p.a, p.b]);
      const conf = this.getConfiguration() || {};
      conf.custom = conf.custom || {};
      conf.custom.pairs = stored;

      const all = await this.data.getAllGlobalPlugins();
      const self = all.find((g) => g.guid === this.getGuid());
      if (!self) throw new Error("plugin handle not found");
      await self.saveConfiguration(conf);

      // Apply live — saveConfiguration may not reload this instance.
      this._applyPairs(pairs);
      this._cache.clear();
      this._seeded.clear();
      try { this._seedOpenPanels(); } catch (e) {}

      this.closeSettings();
      this.ui.addToaster({
        title: "Bidirectional Fields",
        message: "Saved " + pairs.length + " pair" + (pairs.length === 1 ? "" : "s") + ".",
        dismissible: true,
        autoDestroyTime: 2500,
      });
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      this.ui.addToaster({
        title: "Bidirectional Fields",
        message: "Could not save: " + (e && (e.message || e)),
        dismissible: true,
      });
    }
  }
}
