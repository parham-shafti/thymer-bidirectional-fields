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
 * Configuration: plugin config `custom.pairs`, an array of two-name arrays:
 *   { "custom": { "pairs": [["Supports","Enabler"], ["Blocks","Blocked by"]] } }
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
/* Settings dialog styling — mirrors the Smart Titles dashboard, themed entirely
 * with Thymer's own CSS tokens so it follows the active theme/accent. */
const DASH_CSS = `
.bl-backdrop { position: fixed; inset: 0; z-index: 10000; background: var(--full-scrim, rgba(0,0,0,0.45)); display: flex; align-items: flex-start; justify-content: center; }
.bl-shell { margin-top: 8vh; width: 640px; max-width: calc(100vw - 32px); max-height: calc(100vh - 80px); display: flex; flex-direction: column; overflow: hidden; background: var(--modal-bg); color: var(--text-color); border: 1px solid color-mix(in srgb, var(--button-2nd-border-color) 35%, var(--modal-bg)); border-radius: 9px; box-shadow: 0 24px 60px -24px rgba(0,0,0,.7); font-family: var(--font-sans); font-size: 14px; }
.bl-head { padding: 22px 24px 16px; border-bottom: 1px solid var(--cards-border-color); }
.bl-title { margin: 0 0 6px; font-size: 21px; font-weight: 700; color: var(--color-text-100, var(--text-color)); }
.bl-desc { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--color-text-600, var(--text-color)); }
.bl-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 24px 22px; }
.bl-sec { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.bl-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--color-text-800, var(--text-color)); }
.bl-count-pill { font-size: 11px; padding: 1px 7px; color: var(--color-text-600); background: var(--button-minimal-bg-color); border: 1px solid var(--button-border-color); border-radius: var(--button-radius, 5px); }
.bl-pair-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.bl-field { all: unset; box-sizing: border-box; flex: 1; min-width: 0; padding: 8px 11px; cursor: pointer; font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--link-color); background: var(--color-primary-950); border: 1px solid color-mix(in srgb, var(--color-primary-500) 38%, transparent); border-radius: var(--button-radius, 5px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
.bl-field:hover { filter: brightness(1.08); }
.bl-field.empty { color: var(--color-text-600); font-weight: 400; background: var(--button-minimal-bg-color); border: 1px dashed var(--button-2nd-border-color); }
.bl-field.open { border-color: var(--color-primary-500); }
.bl-arrow { flex: none; font-size: 15px; color: var(--color-text-600); }
.bl-pair-remove { all: unset; box-sizing: border-box; flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 13px; color: var(--color-text-800); border: 1px solid var(--button-border-color); border-radius: var(--button-radius, 5px); transition: color .13s, border-color .13s; }
.bl-pair-remove:hover { color: #ff8d7a; border-color: #ff8d7a; }
.bl-add { all: unset; box-sizing: border-box; display: block; width: 100%; margin-top: 4px; padding: 9px; text-align: center; font-size: 13px; color: var(--color-text-600); cursor: pointer; border: 1px dashed var(--button-2nd-border-color); border-radius: var(--button-radius, 5px); }
.bl-add:hover { color: var(--link-color); border-color: var(--color-primary-500); }
.bl-empty { color: var(--color-text-800); font-style: italic; font-size: 13px; padding: 6px 2px 12px; }
.bl-hint { margin-top: 16px; font-size: 12px; line-height: 1.5; color: var(--color-text-800); }
.bl-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 22px; border-top: 1px solid var(--cards-border-color); background: var(--cards-bg); }
.bl-btn { all: unset; box-sizing: border-box; padding: 6px 14px; font-size: 13px; font-weight: 600; color: var(--color-text-600); cursor: pointer; border: 1px solid var(--button-2nd-border-color); border-radius: var(--button-radius, 5px); transition: color .13s, border-color .13s; }
.bl-btn:hover { color: var(--text-color); border-color: var(--text-color); }
.bl-btn[disabled] { opacity: .5; cursor: default; }
.bl-btn-primary { background: var(--button-primary-bg-color); border-color: var(--button-primary-bg-color); color: var(--button-primary-fg-color); }
.bl-btn-primary:hover { filter: brightness(1.07); color: var(--button-primary-fg-color); }
.bl-popover { position: fixed; z-index: 10001; display: flex; flex-direction: column; overflow: hidden; background: var(--modal-bg); border: 1px solid var(--button-border-color); border-radius: 7px; box-shadow: 0 18px 44px -16px rgba(0,0,0,.8); }
.bl-search { margin: 8px 8px 6px; padding: 7px 9px; display: flex; align-items: center; gap: 6px; background: var(--button-minimal-bg-color); border: 1px solid var(--button-border-color); border-radius: var(--button-radius, 5px); }
.bl-search:focus-within { border-color: var(--color-primary-500); }
.bl-search svg { flex: none; opacity: .45; }
.bl-search input { all: unset; flex: 1; min-width: 0; font-size: 13px; font-family: var(--font-mono); color: var(--text-color); }
.bl-pop-list { max-height: 240px; overflow-y: auto; padding: 0 6px 6px; }
.bl-pop-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; border-radius: var(--button-radius, 5px); font-family: var(--font-mono); font-size: 13px; }
.bl-pop-item:hover { background: var(--cmdpal-hover-bg-color, var(--button-bg-hover-color)); }
.bl-pop-item .plus { color: var(--link-color); }
.bl-pop-item .nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl-pop-foot { padding: 7px 10px; font-size: 11px; color: var(--color-text-800); border-top: 1px solid var(--cards-border-color); }
.bl-pop-foot.act { cursor: pointer; color: var(--link-color); }
@media (max-width: 560px) { .bl-shell { margin-top: 2vh; } }
`;

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
    try { this.ui.injectCSS(DASH_CSS); } catch (e) { console.error("[bilinks] injectCSS", e); }

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

  _loadPairs() {
    let pairs = this._DEFAULT_PAIRS;
    try {
      const custom = this.getConfiguration && this.getConfiguration().custom;
      const raw = custom && custom.pairs;
      if (Array.isArray(raw)) {
        // An explicit (even empty) array is honoured; only an absent key falls back to default.
        pairs = raw
          .filter((p) => Array.isArray(p) && p.length === 2 && p[0] && p[1])
          .map((p) => [String(p[0]), String(p[1])]);
      }
    } catch (e) { console.error("[bilinks] config read failed, using defaults", e); }
    this._applyPairs(pairs);
  }

  // Set the active pairs and rebuild the lookup maps. Pass [] to disable all sync.
  _applyPairs(pairs) {
    this._pairs = Array.isArray(pairs) ? pairs : [];
    this._partner = new Map();
    for (const [x, y] of this._pairs) { this._partner.set(x, y); this._partner.set(y, x); }
    this._fields = Array.from(this._partner.keys());
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
    let added = 0, removed = 0;
    for (const F of this._fields) {
      const partner = this._partner.get(F);
      const prop = rec.prop(F);
      if (!prop) continue;
      const cur = this._linkedGuids(prop);
      const key = this._key(recGuid, F);
      const old = this._cache.get(key);
      if (old === undefined) { this._cache.set(key, cur); continue; } // adopt baseline, no writes
      for (const v of cur) {
        if (v !== recGuid && old.indexOf(v) === -1 && this._addLink(v, partner, recGuid)) added++;
      }
      for (const v of old) {
        if (v !== recGuid && cur.indexOf(v) === -1 && this._removeLink(v, partner, recGuid)) removed++;
      }
      this._cache.set(key, cur);
    }
    if (added || removed) this._toast(added, removed);
  }

  // Append src into target.partnerField (existing values preserved). Updates our
  // cache so the target's own reconcile sees no delta from this write.
  _addLink(targetGuid, partnerField, src) {
    const t = this.data.getRecord(targetGuid);
    if (!t) return false;
    const prop = t.prop(partnerField);
    if (!prop) return false;
    const cur = this._linkedGuids(prop);
    const key = this._key(targetGuid, partnerField);
    if (cur.indexOf(src) !== -1) { this._cache.set(key, cur); return false; }
    const next = cur.concat([src]);
    prop.set(next);
    this._cache.set(key, next);
    return true;
  }

  // Remove src from target.partnerField. Updates cache likewise.
  _removeLink(targetGuid, partnerField, src) {
    const t = this.data.getRecord(targetGuid);
    if (!t) return false;
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

  /* =================== settings dialog =================== */

  async openSettings() {
    this.closeSettings();

    // Candidate field names: record-type (page-link) properties across all
    // collections, plus any names already paired. Deduped + sorted.
    const names = new Set();
    try {
      const cols = await this.data.getAllCollections();
      for (const c of cols) {
        const cfg = (c.getConfiguration && c.getConfiguration()) || {};
        for (const f of (cfg.fields || [])) {
          if (f && f.label && f.type === "record" && f.active !== false) names.add(f.label);
        }
      }
    } catch (e) { console.error("[bilinks] gather fields", e); }
    for (const [a, b] of this._pairs) { if (a) names.add(a); if (b) names.add(b); }
    this._avail = Array.from(names).sort((a, b) => a.localeCompare(b));

    this._model = this._pairs.map((p) => ({ a: p[0] || "", b: p[1] || "" }));
    if (!this._model.length) this._model.push({ a: "", b: "" });

    const backdrop = document.createElement("div");
    backdrop.className = "bl-backdrop";
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) this.closeSettings(); });
    this._shellEl = document.createElement("div");
    this._shellEl.className = "bl-shell";
    backdrop.appendChild(this._shellEl);
    document.body.appendChild(backdrop);
    this._settingsEl = backdrop;
    this._settingsKeyHandler = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (this._popEl) this.closePopover(); else this.closeSettings();
      }
    };
    document.addEventListener("keydown", this._settingsKeyHandler, true);

    this.renderSettings();
  }

  closeSettings() {
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

  searchIcon() {
    const span = document.createElement("span");
    span.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
    span.style.display = "flex";
    return span;
  }

  renderSettings() {
    if (!this._shellEl) return;
    this.closePopover();
    const shell = this._shellEl;
    shell.innerHTML = "";

    const head = this.mk("div", "bl-head");
    head.appendChild(this.mk("h2", "bl-title", "Bidirectional Fields"));
    head.appendChild(this.mk("p", "bl-desc", "Pair two page-link property fields so they mirror each other. Set a link in one field on a page and the matching back-link is added on the other page — and removed when you remove it. Both directions. Pairs match by name, so each works across every collection."));
    shell.appendChild(head);

    const body = this.mk("div", "bl-body");

    const sec = this.mk("div", "bl-sec");
    sec.appendChild(this.mk("span", "bl-label", "Field pairs"));
    sec.appendChild(this.mk("span", "bl-count-pill", String(this._model.length)));
    body.appendChild(sec);

    this._model.forEach((p, i) => body.appendChild(this.renderPairRow(p, i)));

    const add = this.mk("button", "bl-add", "+ Add pair");
    add.addEventListener("click", () => { this._model.push({ a: "", b: "" }); this.renderSettings(); });
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

  renderPairRow(p, i) {
    const row = this.mk("div", "bl-pair-row");
    row.appendChild(this.fieldSlot(p, "a"));
    row.appendChild(this.mk("span", "bl-arrow", "↔"));
    row.appendChild(this.fieldSlot(p, "b"));
    const x = this.mk("button", "bl-pair-remove", "✕");
    x.title = "Remove pair";
    x.addEventListener("click", () => { this._model.splice(i, 1); this.renderSettings(); });
    row.appendChild(x);
    return row;
  }

  fieldSlot(p, key) {
    const btn = this.mk("button", "bl-field" + (p[key] ? "" : " empty"), p[key] || "Choose field…");
    btn.addEventListener("click", () => this.openFieldPicker(btn, p, key));
    return btn;
  }

  openFieldPicker(anchor, p, key) {
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
        const items = this._avail.filter((n) => !ql || n.toLowerCase().includes(ql));
        for (const n of items) {
          const item = this.mk("div", "bl-pop-item");
          item.appendChild(this.mk("span", "plus", "+"));
          item.appendChild(this.mk("span", "nm", n));
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
    this.closePopover();
    const pop = this.mk("div", "bl-popover");
    pop.style.width = width + "px";
    build(pop);
    this._settingsEl.appendChild(pop);

    const r = anchor.getBoundingClientRect();
    const ph = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom;
    let top;
    if (below < ph + 12 && r.top > below) top = Math.max(8, r.top - ph - 6);
    else top = Math.min(r.bottom + 6, window.innerHeight - ph - 8);
    pop.style.left = left + "px";
    pop.style.top = top + "px";

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

  closePopover() {
    if (!this._popEl) return;
    this._popEl.remove();
    this._popEl = null;
    if (this._popAnchor) { this._popAnchor.classList.remove("open"); this._popAnchor = null; }
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
      const pairs = this._model
        .map((p) => [(p.a || "").trim(), (p.b || "").trim()])
        .filter((p) => p[0] && p[1]);
      const conf = this.getConfiguration() || {};
      conf.custom = conf.custom || {};
      conf.custom.pairs = pairs;

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
