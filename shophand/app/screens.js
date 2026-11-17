/* Shop Hand screens (milestone W4): Collection, Fusions, Rebirth, Upgrades (Chips, Nova Shop), Info (Events, Traits).
   Each screen is a port of the Godot screen in app/ui/ (same rules, same wording). Rules live in domain.js. */
(function () {
	'use strict';
	var SH = window.SH = window.SH || {};
	var dom = SH.domain, ui = SH.ui;
	var t = ui.t, h = ui.h, clear = ui.clear, C = ui.ctx;
	var screens = SH.screens = {};

	function gd() { return C.gd; }
	function ps() { return C.ps; }
	function dropped(v) { return v == null || v === ''; }
	function droid(id) { return dropped(id) ? null : (gd().droidsById[id] || null); }
	function rawName(d) { return d && !ui.isBlank(d.name) ? String(d.name) : t('unknown'); }
	// The name to show. With "hide names" on, a droid the player does not own shows ???.
	function dispName(d) {
		if (!d) return t('unknown');
		if (ps().getSetting('hide_unowned_names') && !ps().isOwned(d.id)) return '???';
		return rawName(d);
	}
	function droidName(id) { var d = droid(id); return d ? rawName(d) : (dropped(id) ? t('unknown') : String(id)); }
	function variants(id) { return dom.variantsOf(gd(), id); }
	function rows(name) { var v = gd().raw[name]; return Array.isArray(v) ? v : []; }
	function incomeOf(id, tier) { return dom.incomeFor(id, tier, gd().incomeByKey, gd().droidsById); }
	function costOf(id, tier) { return dom.costFor(id, tier, gd().incomeByKey, gd().droidsById); }
	function optText(v) { return v == null ? '' : String(v).trim(); }
	var SEP = '  |  ';

	// Rebuild a part of the page and keep the keyboard focus on the same control (marked with data-fk).
	function keepFocus(fn) {
		var a = document.activeElement, fk = a && a.getAttribute && a.getAttribute('data-fk');
		fn();
		if (fk) { var n = document.querySelector('[data-fk="' + fk.replace(/"/g, '') + '"]'); if (n && n.focus) n.focus({ preventScroll: true }); }
	}
	var rafPending = {};
	function later(key, fn) { if (rafPending[key]) return; rafPending[key] = true; requestAnimationFrame(function () { rafPending[key] = false; fn(); }); }

	function droidChip(id, tierId, showTier) {
		var d = droid(id);
		var text = h('span', { class: 'chip-text' }, droidName(id));
		if (showTier) text.appendChild(h('span', { class: 'tier', style: '--vc:' + ui.vVar(tierId || 'base') }, ui.tierName(tierId)));
		return h('span', { class: 'chip' }, ui.tile(d, 'sm'), text);
	}
	function head(titleKey, statusEl, extra) {
		return h('div', { class: 'view-head' }, h('div', { class: 'grow' }, h('h2', null, t(titleKey)), statusEl || null), extra || null);
	}
	function rarityEnds() {
		var rs = gd().rarities, lo = t('Common'), hi = t('Iconic');
		if (rs.length) { lo = ui.rarityName(rs[0].id); hi = ui.rarityName(rs[rs.length - 1].id); }
		return [lo, hi];
	}

	/* =====================================================================================
	   Collection
	   ===================================================================================== */

	screens.collection = function (api) {
		var root = h('section', { class: 'view view-collection', id: 'view-collection', 'aria-labelledby': 'h-collection' });
		var f = dom.defaultFilters();
		var cards = {}, tiles = {}, order = [], changed = {}, leaving = {};
		var view = 'cards';
		var els = {};
		var selected = null;

		function loadFilters() {
			var p = ps();
			f.rarity = String(p.getSetting('coll_rarity')); f.variant = String(p.getSetting('coll_variant')); f.role = String(p.getSetting('coll_role'));
			f.uncollected = !!p.getSetting('coll_uncollected'); f.sort = String(p.getSetting('coll_sort')); f.asc = !!p.getSetting('coll_asc');
			view = String(p.getSetting('coll_view')) === 'compact' ? 'compact' : 'cards';
			if (dom.SORTS.indexOf(f.sort) === -1) f.sort = 'Rarity';
			if (f.variant !== '' && !dom.has(gd().tierById, f.variant)) f.variant = '';
			if (f.rarity !== '' && !dom.has(gd().rarityById, f.rarity)) f.rarity = '';
		}
		function roles() {
			var out = ['Worker', 'Astromech', 'Battle', 'Protocol'], extra = [];
			gd().droids.forEach(function (d) { var r = optText(d.role); if (r && out.indexOf(r) === -1 && extra.indexOf(r) === -1) extra.push(r); });
			return out.concat(extra.sort());
		}
		function setFilters(changes) {
			var any = false, saved = {};
			Object.keys(changes).forEach(function (k) { if (f[k] !== changes[k]) any = true; f[k] = changes[k]; });
			if (!any) return;
			if (changes.view !== undefined) view = changes.view;
			var map = { rarity: 'coll_rarity', variant: 'coll_variant', role: 'coll_role', uncollected: 'coll_uncollected', sort: 'coll_sort', asc: 'coll_asc', view: 'coll_view' };
			Object.keys(changes).forEach(function (k) { if (map[k]) saved[map[k]] = k === 'view' ? changes[k] : changes[k]; });
			selfSetting = true; ps().setSettings(saved); selfSetting = false;
			syncControls(); apply();
		}
		var selfSetting = false;

		/* --- header --- */
		function sortLabel(k) { return k === 'Missing' ? t('Missing variants') : t(k); }
		function dirText(k, asc) { var e = rarityEnds(); return dom.dirLabel(k, asc, e[0], e[1], { t: t, f: t }); }

		var search = h('input', { class: 'field', type: 'search', 'aria-label': t('Search by name'), placeholder: t('Search by name'),
			autocomplete: 'off', enterkeyhint: 'search', oninput: function () { f.search = this.value; clearBtn.hidden = this.value === ''; apply(); } });
		var clearBtn = h('button', { class: 'clear-x', type: 'button', hidden: true, 'aria-label': t('Clear the search'), title: t('Clear the search'),
			onclick: function () { search.value = ''; f.search = ''; clearBtn.hidden = true; apply(); search.focus(); } }, ui.ico('x'));
		var searchBox = h('div', { class: 'searchbox' }, search, clearBtn);
		var uncBtn = h('button', { class: 'chipbtn', type: 'button', 'aria-pressed': 'false', onclick: function () { setFilters({ uncollected: !f.uncollected }); } }, t('Uncollected'));
		var viewBtn = h('button', { class: 'chipbtn square', type: 'button', onclick: function () { setFilters({ view: view === 'cards' ? 'compact' : 'cards' }); } });

		var rarOpts = [{ label: t('All rarities'), value: '', short: t('All rarities (field)') }].concat(gd().rarities.map(function (r) { return { label: ui.rarityName(r.id), value: r.id, color: ui.rVar(r.id) }; }));
		var varOpts = [{ label: t('All variants'), value: '', short: t('All variants (field)') }].concat(dom.orderedTiers(gd()).map(function (x) { return { label: ui.tierName(x.id), value: x.id, color: ui.vVar(x.id) }; }));
		var roleOpts = [{ label: t('All roles'), value: '', short: t('All roles (field)') }].concat(roles().map(function (r) { return { label: ui.roleName(r), value: r }; }));
		var sortOpts = dom.SORTS.map(function (k) { var o = { label: sortLabel(k), value: k }; if (k === 'Missing') o.short = t('Missing'); return o; });
		var rarPick = ui.picker({ title: t('Rarity'), options: rarOpts, value: '', onPick: function (v) { setFilters({ rarity: v }); } });
		var varPick = ui.picker({ title: t('Variant'), options: varOpts, value: '', onPick: function (v) { setFilters({ variant: v }); } });
		var rolePick = ui.picker({ title: t('Role'), options: roleOpts, value: '', onPick: function (v) { setFilters({ role: v }); } });
		var sortPick = ui.picker({ title: t('Sort by'), options: sortOpts, value: 'Rarity', prefix: t('Sort:') + ' ', icon: 'sort', columns: 2,
			onPick: function (v) { setFilters({ sort: v, asc: dom.SORT_ASC[v] !== false }); } });
		var dirBtn = h('button', { class: 'chipbtn dir', type: 'button', onclick: function () { setFilters({ asc: !f.asc }); } });
		var longest = 0;
		dom.SORTS.forEach(function (k) { [true, false].forEach(function (a) { longest = Math.max(longest, dirText(k, a).length); }); });
		dirBtn.style.minWidth = (longest + 3) + 'ch';

		var status = h('button', { class: 'statusbtn', type: 'button', title: t('Show progress'), onclick: openProgress });
		var headBlock = h('div', { class: 'col-head' },
			h('div', { class: 'col-title' }, h('h2', { id: 'h-collection' }, t('Collection')), status),
			h('div', { class: 'filters' },
				searchBox, uncBtn, viewBtn, h('span', { class: 'br b1' }),
				rarPick, varPick, rolePick, h('span', { class: 'br b2' }),
				sortPick, dirBtn));

		var grid = h('ul', { class: 'grid cards', id: 'droid-grid' });
		var tileGrid = h('ul', { class: 'grid tiles', hidden: true });
		var empty = h('div', { class: 'empty', hidden: true }, h('h3', null, t('No droids match your search.')));
		var listPane = h('div', { class: 'list-pane' }, headBlock, grid, tileGrid, empty);
		var detail = h('aside', { class: 'detail', id: 'detail', 'aria-label': t('Droid details') });
		var scrim = h('button', { class: 'scrim', type: 'button', 'aria-label': t('Close'), tabindex: '-1', hidden: true, onclick: function () { api.closeDetail(); } });
		root.appendChild(h('div', { class: 'split' }, listPane, detail));
		root.appendChild(scrim);

		function syncControls() {
			uncBtn.setAttribute('aria-pressed', String(!!f.uncollected));
			rarPick.setValue(f.rarity); varPick.setValue(f.variant); rolePick.setValue(f.role); sortPick.setValue(f.sort);
			dirBtn.textContent = dirText(f.sort, f.asc);
			clear(viewBtn).appendChild(ui.ico(view === 'cards' ? 'grid' : 'rows'));
			var tip = view === 'cards' ? t('Compact view') : t('Card view');
			viewBtn.setAttribute('aria-label', tip); viewBtn.title = tip;
			grid.hidden = view !== 'cards'; tileGrid.hidden = view !== 'compact';
		}

		/* --- cards --- */
		function tierForStats() { return f.variant === '' ? 'base' : f.variant; }
		function toggleVariant(id) { ps().markTierWithUndo(id, f.variant, !ps().hasTier(id, f.variant)); }

		function buildCard(d) {
			var id = d.id;
			var hit = h('button', { class: 'ccard-hit', type: 'button', onclick: function () { if (f.variant === '') api.openDetail(id); else toggleVariant(id); } });
			var toggle = h('button', { class: 'own-toggle', type: 'button', 'data-fk': 'own-' + id, onclick: function () {
				if (f.variant === '') ps().markBasicWithUndo(id, !ps().isOwned(id)); else toggleVariant(id); } });
			var info = h('button', { class: 'btn info', type: 'button', 'aria-label': t('Info') + ': ' + rawName(d), onclick: function () { api.openDetail(id); } }, t('Info'));
			var li = h('li', { class: 'ccard', 'data-id': id, style: '--rc:' + ui.rVar(d.rarity) }, hit, h('div', { class: 'ccard-actions' }, toggle, info));
			cards[id] = { li: li, hit: hit, toggle: toggle, d: d };
			paintCard(id);
			return li;
		}
		function paintCard(id) {
			var c = cards[id]; if (!c) return;
			var d = c.d, p = ps();
			var anyOwned = p.isOwned(id), owned = f.variant === '' ? anyOwned : p.hasTier(id, f.variant);
			var avail = variants(id), have = avail.map(function (v) { return p.hasTier(id, v); }), n = have.filter(Boolean).length;
			var inc = incomeOf(id, tierForStats());
			var stats = owned ? t('%s/min  |  buy %s', ui.num(inc == null ? null : inc * 60), ui.num(costOf(id, tierForStats()))) : '';
			clear(c.hit);
			c.hit.appendChild(ui.tile(d, 'card', owned, f.variant === '' ? '' : f.variant));
			c.hit.appendChild(h('span', { class: 'ccard-text' },
				h('span', { class: 'ccard-name', style: f.variant ? 'color:' + ui.vVar(f.variant) : null }, dispName(d)),
				h('span', { class: 'ccard-meta' }, h('span', { class: 'rar' }, ui.rarityName(d.rarity)), ' / ' + ui.roleName(d.role)),
				h('span', { class: 'ccard-pips' }, avail.length ? ui.pips(avail, have) : null, h('span', { class: 'ccard-count' }, avail.length ? n + '/' + avail.length : '')),
				h('span', { class: 'ccard-stats' }, stats)));
			c.hit.setAttribute('aria-label', dispName(d) + (f.variant === '' ? '' : ' (' + ui.tierName(f.variant) + ')'));
			c.li.classList.toggle('owned', owned);
			c.toggle.setAttribute('aria-pressed', String(owned));
			c.toggle.textContent = owned ? t('Owned') : t('Mark owned');
		}

		/* --- compact tiles --- */
		function ensureTiles() {
			if (Object.keys(tiles).length) return;
			gd().droids.forEach(function (d) {
				var id = d.id, timer = null, long = false;
				var b = h('button', { class: 'ctile', type: 'button', style: '--rc:' + ui.rVar(d.rarity) });
				b.addEventListener('pointerdown', function () { long = false; clearTimeout(timer); timer = setTimeout(function () { long = true; if (f.variant !== '') api.openDetail(id); }, 500); });
				['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, function () { clearTimeout(timer); }); });
				b.addEventListener('contextmenu', function (e) { if (f.variant !== '') e.preventDefault(); });
				b.addEventListener('click', function () {
					if (long) { long = false; return; }
					if (f.variant === '') api.openDetail(id); else toggleVariant(id);
				});
				var li = h('li', { 'data-id': id }, b);
				tiles[id] = { li: li, b: b, d: d };
				tileGrid.appendChild(li);
				paintTile(id);
			});
		}
		function paintTile(id) {
			var c = tiles[id]; if (!c) return;
			var p = ps(), d = c.d, anyOwned = p.isOwned(id), owned = f.variant === '' ? anyOwned : p.hasTier(id, f.variant);
			var avail = variants(id), n = avail.filter(function (v) { return p.hasTier(id, v); }).length;
			clear(c.b);
			c.b.appendChild(ui.tile(d, 'cell', owned, f.variant === '' ? '' : f.variant));
			var badge = f.variant === '' ? (avail.length ? n + '/' + avail.length : '') : (owned ? '' : '');
			if (badge) c.b.appendChild(h('span', { class: 'badge' }, badge));
			if (f.variant !== '' && owned) c.b.appendChild(h('span', { class: 'badge ok' }, ui.ico('check')));
			c.b.appendChild(h('span', { class: 'ctile-name', style: f.variant ? 'color:' + ui.vVar(f.variant) : null }, dispName(d)));
			c.b.setAttribute('aria-label', dispName(d) + (f.variant ? ' (' + ui.tierName(f.variant) + ')' : '') + (owned ? ', ' + t('owned') : ''));
			c.b.setAttribute('aria-pressed', f.variant === '' ? 'false' : String(owned));
			c.b.classList.toggle('owned', owned);
		}

		/* --- filter, sort, count --- */
		function valueFn(d, key) { var tier = tierForStats(); return key === 'Income' ? incomeOf(d.id, tier) : costOf(d.id, tier); }
		function apply() {
			var g = gd(), p = ps();
			Object.keys(cards).forEach(function (id) { paintCard(id); });
			if (view === 'compact') { ensureTiles(); Object.keys(tiles).forEach(function (id) { paintTile(id); }); }
			var shown = dom.filterSort(g.droids, g.variantsByDroid, p.owned, dom.rarityOrders(g), f, valueFn);
			var vis = {}, ord = shown.map(function (d) { vis[d.id] = true; return d.id; });
			function place(map, parent) {
				var prev = null;
				ord.forEach(function (id, i) { var li = map[id] && map[id].li; if (!li) return; if (parent.children[i] !== li) parent.insertBefore(li, parent.children[i] || null); });
				Object.keys(map).forEach(function (id) {
					var li = map[id].li, show = !!vis[id];
					if (show) { li.hidden = false; li.classList.remove('leaving'); if (leaving[id]) { clearTimeout(leaving[id]); delete leaving[id]; } }
					else if (parent === tileGrid && changed[id] && f.uncollected && !li.hidden) {
						if (!leaving[id]) { li.classList.add('leaving'); leaving[id] = setTimeout(function () { li.hidden = true; li.classList.remove('leaving'); delete leaving[id]; }, 650); }
					} else if (!leaving[id]) li.hidden = true;
				});
			}
			place(cards, grid);
			if (view === 'compact') place(tiles, tileGrid);
			changed = {};
			var text = t('Owned %d of %d droids', p.ownedCount(), g.droids.length);
			if (f.variant !== '') {
				var n = 0, avail = 0;
				g.droids.forEach(function (d) { if (variants(d.id).indexOf(f.variant) !== -1) { avail++; if (p.hasTier(d.id, f.variant)) n++; } });
				text = t('%s: %d of %d', ui.tierName(f.variant), n, avail);
			}
			if (shown.length !== g.droids.length) text += '  ' + t('(showing %d)', shown.length);
			clear(status); status.appendChild(h('span', null, text)); status.appendChild(ui.ico('right', 'chev-r'));
			empty.hidden = shown.length > 0;
		}

		function openProgress() {
			var g = gd(), p = ps();
			var vids = dom.orderedTiers(g).map(function (x) { return x.id; }), rids = g.rarities.map(function (x) { return x.id; });
			ui.sheet(t('Progress'), function (body) {
				var s = dom.computeProgress(g.droids, g.variantsByDroid, p.owned, vids, rids, vids[0] || '');
				body.appendChild(ui.bar(t('All droids and variants'), s.owned + ' / ' + s.available, dom.fraction(s.owned, s.available), 'var(--accent-text)'));
				body.appendChild(h('p', { class: 'dim' }, t('Droids with every variant: %d of %d', s.complete, s.droids_with_variants)));
				var box = h('div', { class: 'prog-scroll' });
				box.appendChild(h('h3', { class: 'accent' }, t('By variant')));
				s.by_variant.forEach(function (r) { if (r.available) box.appendChild(ui.bar(ui.tierName(r.id), r.owned + ' / ' + r.available, dom.fraction(r.owned, r.available), ui.vVar(r.id))); });
				box.appendChild(h('h3', { class: 'accent' }, t('By rarity')));
				s.by_rarity.forEach(function (r) { if (r.available) box.appendChild(ui.bar(ui.rarityName(r.id), r.owned + ' / ' + r.available, dom.fraction(r.owned, r.available), ui.rVar(r.id))); });
				body.appendChild(box);
			});
		}

		/* --- detail panel --- */
		function detailRow(dl, label, value, fmt) {
			var unk = ui.isBlank(value);
			dl.appendChild(h('dt', null, label));
			dl.appendChild(h('dd', { class: unk ? 'unk' : '' }, unk ? t('unknown') : (fmt ? fmt(value) : String(value))));
		}
		function renderDetail() {
			var box = clear(detail), g = gd(), p = ps();
			var d = selected ? droid(selected) : null, open = !!selected;
			detail.classList.toggle('open', open); scrim.hidden = !open;
			if (!open) { box.appendChild(h('div', { class: 'empty detail-empty' }, h('h3', null, t('Droid details')), h('p', null, t('Choose a droid to see its details.')))); return; }
			if (!d) {
				box.appendChild(h('div', { class: 'detail-top' }, h('h2', null, t('This droid is not in the data.')), h('button', { class: 'btn close', type: 'button', onclick: api.closeDetail }, t('Close'))));
				return;
			}
			var owned = p.isOwned(d.id);
			box.appendChild(h('div', { class: 'detail-top' },
				ui.tile(d, 'lg', owned),
				h('div', { style: 'min-width:0' },
					h('h2', { id: 'detail-title', tabindex: '-1' }, dispName(d)),
					h('p', { class: 'meta' }, h('span', { class: 'rar', style: '--rc:' + ui.rVar(d.rarity) }, ui.rarityName(d.rarity)), ' · ' + ui.roleName(d.role)),
					ui.tag(owned ? t('Owned') : t('Not owned'), owned ? 'var(--green)' : null)),
				h('button', { class: 'btn close', type: 'button', 'aria-label': t('Close'), onclick: api.closeDetail }, t('Close'))));
			var dl = h('dl', { class: 'dl' });
			detailRow(dl, t('Obtain method'), d.obtain_method, ui.obtainName);
			detailRow(dl, t('Companion trait'), d.companion_trait);
			detailRow(dl, t('Craft time'), d.craft_time);
			detailRow(dl, t('Sell value'), d.sell_value, ui.num);
			box.appendChild(dl);
			var recipe = g.fusionByOutput[d.id];
			if (recipe) {
				box.appendChild(h('h3', null, t('Fusion recipe')));
				[1, 2, 3].forEach(function (i) {
					var iid = recipe['input' + i + '_id'], idr = droid(iid);
					box.appendChild(h('div', { class: 'recipe-row' },
						h('button', { class: 'btn grow', type: 'button', disabled: idr ? null : true, onclick: function () { api.openDetail(iid); } }, idr ? rawName(idr) : t('unknown')),
						ui.tag(p.isOwned(iid) ? t('owned') : t('not owned'), p.isOwned(iid) ? 'var(--green)' : null)));
				});
				box.appendChild(h('p', { class: 'dim small' }, t('Fusion cost') + ': ' + ui.num(recipe.credit_cost)));
				box.appendChild(h('p', { class: 'dim small' }, t('Unlocks at rebirth') + ': ' + ui.plain(recipe.unlock_rebirth)));
			}
			box.appendChild(h('h3', null, t('Variants')));
			var table = h('table', { class: 'vtable' }, h('thead', null, h('tr', null,
				h('th', { scope: 'col' }, t('Variant (tap = owned)')), h('th', { scope: 'col', class: 'r' }, t('Per sec')), h('th', { scope: 'col', class: 'r' }, t('Per min')),
				h('th', { scope: 'col', class: 'r' }, t('Buy')), h('th', { scope: 'col', class: 'r' }, t('Chips to get')))));
			var tb = h('tbody');
			dom.orderedTiers(g).forEach(function (x) {
				var tid = x.id, inc = incomeOf(d.id, tid), chips = (dom.prevOnLadder(tid) === '' || !dom.hasChipData(g, d.rarity)) ? '-' : ui.num(dom.chipsToReach(g, d.rarity, tid));
				var cb = h('input', { type: 'checkbox', id: 'vt-' + tid, 'data-fk': 'vt-' + tid, checked: p.hasTier(d.id, tid) ? true : null });
				cb.checked = p.hasTier(d.id, tid);
				cb.addEventListener('change', function () { onTier(d.id, tid, cb); });
				tb.appendChild(h('tr', null,
					h('td', null, h('label', { class: 'vt-label', for: 'vt-' + tid, style: 'color:' + ui.vVar(tid) }, cb, ui.tierName(tid))),
					h('td', { class: 'r' }, qm(ui.num(inc))), h('td', { class: 'r' }, qm(ui.num(inc == null ? null : inc * 60))), h('td', { class: 'r' }, qm(ui.num(costOf(d.id, tid)))), h('td', { class: 'r' }, qm(chips))));
			});
			table.appendChild(tb);
			box.appendChild(h('div', { class: 'vtable-wrap' }, table));
			box.appendChild(h('p', { class: 'dim small' }, t('Chips to get: the Upgrade Chips to reach this variant from the variant in the row above. A dash means no chip step.')));
			box.appendChild(h('p', { class: 'dim small' }, t('Values come from community sources (see About). %s', d.verified_in_game === true ? t('Checked in game.') : t('Not verified in game.'))));
		}
		function qm(s) { return s === t('unknown') ? '?' : s; }
		function onTier(id, tid, cb) {
			if (!cb.checked && ps().isPlaced(id, tid)) {
				cb.checked = true;
				ui.confirm({ title: t('Remove owned mark?'), text: t('This droid is placed in your base. Remove the owned mark anyway?') }).then(function (yes) { if (yes) ps().markTierWithUndo(id, tid, false); });
				return;
			}
			ps().markTierWithUndo(id, tid, cb.checked);
		}

		/* --- wiring --- */
		var view_ = { el: root, dirty: true };
		view_.setSelected = function (id) { if (id === selected) return; selected = id; renderDetail(); };
		view_.getSelected = function () { return selected; };
		view_.renderDetail = renderDetail;
		view_.refreshAll = function () { apply(); renderDetail(); };
		view_.onData = function () { loadFilters(); syncControls(); apply(); renderDetail(); };
		view_.onChange = function (kind, id) {
			if (kind === 'settings' && selfSetting) return;
			if (kind === 'settings') { loadFilters(); syncControls(); }
			if (kind === 'owned' && id) changed[id] = true;
			later('col', function () { apply(); if (selected) renderDetail(); });
		};
		loadFilters();
		gd().droids.forEach(function (d) { grid.appendChild(buildCard(d)); });
		syncControls(); apply(); renderDetail();
		return view_;
	};

	/* =====================================================================================
	   Fusions
	   ===================================================================================== */

	screens.fusions = function () {
		var root = h('section', { class: 'view', id: 'view-fusions', 'aria-labelledby': 'h-fusions' });
		var count = h('p', { class: 'dim small' });
		var hideDone = h('input', { type: 'checkbox', id: 'hide-done', onchange: function () { pinned = {}; ps().setSetting('fusion_hide_done', this.checked); } });
		var list = h('ul', { class: 'rows' });
		var extras = h('div');
		root.appendChild(h('div', { class: 'view-head' }, h('div', { class: 'grow' }, h('h2', { id: 'h-fusions' }, t('Fusions')), count),
			h('label', { class: 'check-inline', for: 'hide-done' }, hideDone, t('Hide done'))));
		root.appendChild(list); root.appendChild(extras);
		var pinned = {};

		function collectedCount(key) { var n = 0; variants(key).forEach(function (v) { if (ps().hasTier(key, v)) n++; }); return n; }
		function allCollected(key) { var n = variants(key).length; return n > 0 && collectedCount(key) === n; }
		function viewVariant(key, vs) {
			if (!vs.length) return '';
			var sel = ps().getFusion(key).selected_variant;
			if (vs.indexOf(sel) !== -1) return sel;
			for (var i = 0; i < vs.length; i++) if (!ps().hasTier(key, vs[i])) return vs[i];
			return vs[0];
		}
		function variantState(key, tid) { return ps().hasTier(key, tid) ? 'got' : (ps().isFusionWorking(key, tid) ? 'working' : ''); }

		function card(r, key) {
			var p = ps(), out = droid(key), outName = out ? rawName(out) : ui.plain(key), vs = variants(key), vr = viewVariant(key, vs);
			var c = h('div', { class: 'row-card fusion', style: '--rc:' + ui.rVar(out && out.rarity) });
			var haveN = collectedCount(key);
			c.appendChild(h('div', { class: 'row-head' }, ui.tile(out, 'md', p.isOwned(key), vr),
				h('div', { class: 'grow' }, h('div', { class: 'row-title' }, outName),
					h('div', { class: 'row-sub' + (vs.length && haveN === vs.length ? ' good' : '') }, vs.length ? t('Collected %d of %d variants', haveN, vs.length) : t('Collected: variants unknown')))));
			c.appendChild(h('p', { class: 'dim small' }, t('Unlocks at rebirth %s', ui.plain(r.unlock_rebirth))));
			if (!ui.isBlank(r.credit_cost)) c.appendChild(h('p', { class: 'dim small' }, t('Fusion cost') + ': ' + ui.num(r.credit_cost)));
			if (!vs.length) { c.appendChild(h('p', { class: 'dim small' }, t('Variant: unknown (no variant rows for this droid)'))); return c; }
			var opts = vs.map(function (tid) { return { label: ui.tierName(tid), value: tid, color: ui.vVar(tid), state: variantState(key, tid) }; });
			c.appendChild(ui.picker({ title: t('Variant of %s', outName), options: opts, value: vr, onPick: function (v) { ps().setFusionSelected(key, v); } }));
			c.appendChild(h('div', { class: 'pips-row' }, ui.pips(vs, vs.map(function (v) { return p.hasTier(key, v); }))));
			var vname = ui.tierName(vr), got = p.hasTier(key, vr), vst = p.getFusionVariant(key, vr);
			c.appendChild(h('button', { class: 'own-toggle', type: 'button', 'aria-pressed': String(got), 'data-fk': 'fc-' + key, onclick: function () {
				pinned[key] = true; p.markTierWithUndo(key, vr, !p.hasTier(key, vr)); } }, got ? t('%s: collected (tap to clear)', vname) : t('Mark %s collected', vname)));
			if (!got) {
				var w = h('input', { type: 'checkbox', id: 'wk-' + key, 'data-fk': 'wk-' + key });
				w.checked = vst.working === true;
				w.addEventListener('change', function () { p.setFusionWorking(key, vr, w.checked); });
				c.appendChild(h('label', { class: 'check-row', for: 'wk-' + key }, w, t('Working on it (%s)', vname)));
			}
			c.appendChild(h('h3', { class: 'accent' }, t('Inputs')));
			[1, 2, 3].forEach(function (n) {
				var iid = r['input' + n + '_id'], idr = droid(iid);
				var cb = h('input', { type: 'checkbox', id: 'in-' + key + n, 'data-fk': 'in-' + key + n });
				cb.checked = vst.have[n - 1] === true;
				cb.addEventListener('change', function () { p.setFusionHave(key, vr, n - 1, cb.checked); });
				c.appendChild(h('div', { class: 'input-row' }, iid != null ? ui.tile(idr, 'sm', p.hasTier(iid, vr), vr) : null,
					h('label', { class: 'check-row grow', for: 'in-' + key + n }, cb, idr ? rawName(idr) : t('unknown')),
					iid != null && p.hasTier(iid, vr) ? ui.tag(t('in Collection'), 'var(--green)') : null));
			});
			return c;
		}

		function refresh() {
			keepFocus(function () {
				hideDone.checked = !!ps().getSetting('fusion_hide_done');
				clear(list); clear(extras);
				var items = [], done = 0, idx = 0, hd = hideDone.checked;
				gd().fusionList.forEach(function (r) {
					var key = String(r.output_droid_id || ''), full = allCollected(key);
					if (full) done++;
					idx++;
					if (hd && full && !pinned[key]) return;
					items.push({ r: r, key: key, idx: idx, working: ps().isFusionWorkingAny(key) });
				});
				items.sort(function (a, b) { return a.working !== b.working ? (a.working ? -1 : 1) : a.idx - b.idx; });
				count.textContent = t('%d of %d fully collected', done, gd().fusionList.length);
				if (!items.length) extras.appendChild(h('p', { class: 'dim' }, t('No fusions to show.')));
				items.forEach(function (it) { list.appendChild(h('li', null, card(it.r, it.key))); });
			});
		}
		return { el: root, dirty: true, refresh: refresh, onChange: function () { this.dirty = true; }, onHide: function () { pinned = {}; } };
	};

	/* =====================================================================================
	   Rebirth
	   ===================================================================================== */

	screens.rebirth = function () {
		var root = h('section', { class: 'view', id: 'view-rebirth', 'aria-labelledby': 'h-rebirth' });
		var status = h('p', { class: 'dim small' });
		var hint = h('p', { class: 'accent', hidden: true }, t('This cycle is done. Raise the super rebirth count to go on.'));
		var scrollPending = true;
		function maxSuper() { var c = dom.cycles(gd()); return c.length ? Math.max(Math.max.apply(null, c) - 1, 0) : 4; }
		function pathNow() { return dom.clamp(ps().rebirthCycle, 1, maxSuper() + 1); }
		var superStep = ui.stepper({ minusLabel: '-', plusLabel: '+', onStep: function (d) {
			scrollPending = true; ps().setRebirth(ps().rebirthNumber, dom.clamp(pathNow() - 1 + d, 0, maxSuper()) + 1); },
			onValue: function () { ui.numberSheet({ title: t('Super rebirth count'), min: 0, max: maxSuper(), value: pathNow() - 1 }).then(function (v) {
				if (v == null) return; scrollPending = true; ps().setRebirthWithUndo(ps().rebirthNumber, dom.clamp(v, 0, maxSuper()) + 1, 'super'); }); } });
		var numStep = ui.stepper({ onStep: function (d) { scrollPending = true; ps().setRebirth(dom.clamp(ps().rebirthNumber + d, 0, dom.maxRebirth(gd(), pathNow())), pathNow()); },
			onValue: function () { var path = pathNow(); ui.numberSheet({ title: t('Current rebirth'), min: 0, max: dom.maxRebirth(gd(), path), value: ps().rebirthNumber }).then(function (v) {
				if (v == null) return; scrollPending = true; ps().setRebirthWithUndo(dom.clamp(v, 0, dom.maxRebirth(gd(), path)), path, 'number'); }); } });
		var steppers = h('div', { class: 'row-card steppers' },
			h('div', { class: 'stepper-row' }, h('span', { class: 'name' }, t('Super rebirth count')), superStep.el),
			h('div', { class: 'stepper-row' }, h('span', { class: 'name' }, t('Current rebirth')), numStep.el), hint);
		var list = h('ul', { class: 'rows' }), extras = h('div');
		root.appendChild(h('div', { class: 'view-head' }, h('div', { class: 'grow' }, h('h2', { id: 'h-rebirth' }, t('Rebirth')), status)));
		root.appendChild(steppers); root.appendChild(list); root.appendChild(extras);

		function card(n, row, isNext, past, pathRows, tierOrder) {
			var c = h('div', { class: 'row-card rb' + (isNext ? ' next' : '') });
			var headRow = h('div', { class: 'row-head' }, h('div', { class: 'row-title grow' }, t('Rebirth %d', n)));
			if (isNext) {
				headRow.appendChild(ui.tag(t('NEXT'), 'var(--accent-text)'));
				headRow.appendChild(h('button', { class: 'btn primary', type: 'button', title: t('Set the current rebirth to %d', n), 'data-fk': 'rb-done',
					onclick: function () { scrollPending = true; ps().setRebirthWithUndo(dom.clamp(n, 0, dom.maxRebirth(gd(), pathNow())), pathNow(), 'number'); } }, t('Done')));
			} else if (past) headRow.appendChild(ui.tag(t('done'), 'var(--green)'));
			c.appendChild(headRow);
			c.appendChild(h('p', null, t('Credits needed: %s', ui.num(row.credits_required))));
			var reqs = dom.requirementsFromRow(row);
			reqs.forEach(function (s, i) {
				var did = String(s.droid_id), d = droid(did), tid = s.tier_id;
				var after = dom.afterUse(n, did, tid, pathRows, tierOrder);
				var afterTxt = dom.afterUseText(after, ui.tierName(after.tier_id), { t: t, f: t });
				var path = pathNow(), got = ps().rebirthCheck(path, n, i), nm = d ? rawName(d) : ui.plain(did);
				// A button: tap to mark this required droid as obtained, tap again to clear. The state shows as a check mark and a word, not only colour.
				c.appendChild(h('button', { class: 'req req-check' + (got ? ' got' : ''), type: 'button', 'aria-pressed': String(got), 'data-fk': 'rbc-' + n + '-' + i,
					'aria-label': nm + ', ' + (tid == null ? t('any variant') : ui.tierName(tid)) + ': ' + (got ? t('Obtained') : t('Not obtained yet')),
					onclick: function () { ps().toggleRebirthCheckWithUndo(path, n, i); } },
					ui.tile(d, 'md', true, tid || ''),
					h('div', { class: 'grow' },
						h('div', { class: 'req-name' }, nm),
						h('div', { class: 'req-tags' }, ui.tag(tid == null ? t('any variant') : ui.tierName(tid), tid == null ? null : ui.vVar(tid)), h('span', { class: 'dim small' }, t('then')),
							after.action === 'upgrade' ? ui.tag(afterTxt, ui.vVar(after.tier_id)) : ui.tag(afterTxt))),
					h('span', { class: 'req-mark' }, got ? ui.ico('check', 'req-ico') : h('span', { class: 'req-box', 'aria-hidden': 'true' }), h('span', { class: 'req-word' }, got ? t('Obtained') : t('Tap when obtained')))));
			});
			if (!reqs.length) c.appendChild(h('p', { class: 'dim small' }, t('Required droids: unknown')));
			c.appendChild(h('p', { class: 'dim small' }, t('Reward: %s', ui.plain(row.reward))));
			return c;
		}

		function refresh() {
			keepFocus(function () {
				var path = pathNow(), cur = ps().rebirthNumber, maxN = dom.maxRebirth(gd(), path);
				superStep.set(String(path - 1), path - 1 <= 0, path - 1 >= maxSuper());
				numStep.set(String(cur), cur <= 0, cur >= maxN);
				status.textContent = t('Super rebirth %d  |  %d of %d done', path - 1, Math.min(cur, maxN), maxN);
				hint.hidden = !(maxN > 0 && cur >= maxN);
				clear(list); clear(extras);
				var pathRows = [], tierOrder = dom.tierOrderMap(gd().tiers), nextEl = null;
				for (var n = 1; n <= maxN; n++) { var pr = dom.rebirthRow(gd(), path, n); if (pr) pathRows.push(pr); }
				for (var k = 1; k <= maxN; k++) {
					var row = dom.rebirthRow(gd(), path, k); if (!row) continue;
					var isNext = k === cur + 1, el = h('li', null, card(k, row, isNext, k <= cur, pathRows, tierOrder));
					list.appendChild(el); if (isNext) nextEl = el;
				}
				if (maxN === 0) extras.appendChild(h('p', { class: 'dim' }, t('No rebirth data for this path.')));
				if (nextEl && scrollPending) { scrollPending = false; requestAnimationFrame(function () { nextEl.scrollIntoView({ block: 'start', behavior: 'auto' }); }); }
			});
		}
		return { el: root, dirty: true, refresh: refresh, onChange: function () { this.dirty = true; }, onShow: function () { scrollPending = true; } };
	};

	/* =====================================================================================
	   Upgrades: Chips and Nova Shop
	   ===================================================================================== */

	function sectioned(tab, titleKey, defs, onSub) {
		var root = h('section', { class: 'view', id: 'view-' + tab, 'aria-labelledby': 'h-' + tab });
		var status = h('p', { class: 'dim small' });
		root.appendChild(h('div', { class: 'view-head' }, h('div', { class: 'grow' }, h('h2', { id: 'h-' + tab }, t(titleKey)), status)));
		var seg = h('nav', { class: 'seg', 'aria-label': t('Sections') }), panels = {};
		defs.forEach(function (def) {
			seg.appendChild(h('a', { href: '#' + tab + '/' + def.id, 'data-sub': def.id }, t(def.label)));
			panels[def.id] = h('div', { class: 'panel', hidden: true });
		});
		root.appendChild(seg);
		defs.forEach(function (def) { root.appendChild(panels[def.id]); });
		return { el: root, status: status, seg: seg, panels: panels, defs: defs, sub: defs[0].id };
	}
	function showSub(s, sub) {
		if (!s.panels[sub]) sub = s.defs[0].id;
		s.sub = sub;
		Object.keys(s.panels).forEach(function (k) { s.panels[k].hidden = k !== sub; });
		Array.prototype.forEach.call(s.seg.children, function (a) { if (a.getAttribute('data-sub') === sub) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
		return sub;
	}

	var NOVA_GROUP_TITLES = { featured: 'Featured', core: 'Core upgrades', workshop: 'Workshop', iconic: 'Iconic droids', token: 'Boost tokens' };
	var NOVA_INPUTS = [['multiplier', 'Credit multiplier on my HUD'], ['scrap_share', 'Share of my credits from the Scrap Station (%)']];
	function formulaKey() { var k = Object.keys(window.SH_STRINGS || {}).filter(function (x) { return x.indexOf('A suggestion is a real Upgrade Chip step') === 0; })[0]; return k || ''; }

	screens.upgrades = function () {
		var s = sectioned('upgrades', 'Upgrades', [{ id: 'chips', label: 'Chips' }, { id: 'nova', label: 'Nova Shop' }]);
		var chipsList = h('ul', { class: 'rows' }), chipsExtras = h('div', { class: 'stack' });
		s.panels.chips.appendChild(chipsList); s.panels.chips.appendChild(chipsExtras);
		var novaBox = h('div', { class: 'stack' });
		s.panels.nova.appendChild(novaBox);
		var novaBuilt = false, rowsN = {}, inputBtns = {}, adviceEls = {}, settingsOpen = false, settingsBox = null, settingsBtn = null;

		function chipCard(sg) {
			var p = ps(), d = droid(sg.droid_id), id = sg.droid_id, to = sg.to;
			return h('div', { class: 'row-card', style: '--rc:' + ui.rVar(sg.rarity) },
				h('div', { class: 'row-head' }, ui.tile(d, 'md', true), h('div', { class: 'grow' }, h('div', { class: 'row-title' }, rawName(d)), ui.tag(ui.rarityName(sg.rarity), ui.rVar(sg.rarity)))),
				h('div', { class: 'steps' }, ui.tag(ui.tierName(sg.from), ui.vVar(sg.from)), ui.ico('right'), ui.tag(ui.tierName(to), ui.vVar(to))),
				h('p', null, t('Cost: %s chips', ui.num(sg.cost))), h('p', { class: 'dim small' }, t('Missing %d of %d', sg.missing, sg.available)),
				h('button', { class: 'btn primary wide', type: 'button', onclick: function () { p.markTierWithUndo(id, to, true); } }, t('Mark upgraded (%s)', ui.tierName(to))));
		}
		function renderChips() {
			var g = gd(), p = ps();
			clear(chipsList); clear(chipsExtras);
			var list = dom.suggest(g.droids, g.variantsByDroid, p.owned, dom.rarityOrders(g), g.chipCosts);
			if (!list.length) {
				var reason = dom.emptyReason(g.droids, g.variantsByDroid, p.owned);
				s.status.textContent = t('No suggestion yet');
				chipsExtras.appendChild(h('p', null, reason === 'no_owned' ? t('Mark droids as owned in the Collection first') : t('No Upgrade Chip step is left for the droids you own')));
			} else {
				s.status.textContent = list.length === 1 ? t('%d droid to upgrade', list.length) : t('%d droids to upgrade', list.length);
				list.forEach(function (sg) { chipsList.appendChild(h('li', null, chipCard(sg))); });
			}
			var names = dom.CHIP_LADDER.map(function (x) { return ui.tierName(x); }).join(', ');
			chipsExtras.appendChild(h('div', { class: 'row-card' }, h('h3', { class: 'accent' }, t('How the list is made')), h('p', { class: 'dim' }, formulaKey() ? t(formulaKey(), names) : '')));
		}

		/* Nova Shop */
		function multiplier() {
			var set = ps().novaInput('multiplier');
			if (set > 0) return set;
			return dom.estimateMultiplier(ps().novaLevel('credits'), Object.keys(gd().rebirthsByKey).map(function (k) { return gd().rebirthsByKey[k]; }), String(ps().rebirthCycle), ps().rebirthNumber);
		}
		function pct(share) { var q = share * 100; return (q < 1 ? q.toFixed(2) : q.toFixed(1)) + '%'; }
		function buildNova() {
			novaBuilt = true; rowsN = {}; inputBtns = {}; clear(novaBox);
			var top = h('div', { class: 'row-card advice' }, h('h3', { class: 'accent' }, t('Buy next')));
			adviceEls = { main: h('p', { class: 'row-title' }), detail: h('p', { class: 'dim' }), basis: h('p', { class: 'dim small' }) };
			top.appendChild(adviceEls.main); top.appendChild(adviceEls.detail); top.appendChild(adviceEls.basis);
			novaBox.appendChild(top);
			settingsBtn = h('button', { class: 'btn wide', type: 'button', onclick: function () { settingsOpen = !settingsOpen; applySettingsOpen(); } });
			settingsBox = h('div', { class: 'stack' });
			settingsBox.appendChild(h('p', { class: 'dim' }, t('These two numbers are optional. With no multiplier, the app uses a low estimate from your rebirths and your Credits level.')));
			NOVA_INPUTS.forEach(function (inp) {
				var b = h('button', { class: 'btn val', type: 'button', onclick: function () {
					ui.numberSheet({ title: t(inp[1]), min: 0, max: st().NOVA_INPUT_MAX[inp[0]], value: ps().novaInput(inp[0]) }).then(function (v) { if (v != null) ps().setNovaInput(inp[0], v); }); } });
				inputBtns[inp[0]] = b;
				settingsBox.appendChild(h('div', { class: 'stepper-row' }, h('span', { class: 'name' }, t(inp[1])), b));
			});
			settingsBox.appendChild(h('p', { class: 'dim' }, t('The advice ranks Credits and Scrap Value only. It is an estimate.')));
			novaBox.appendChild(h('div', { class: 'row-card' }, settingsBtn, settingsBox));
			applySettingsOpen();
			['featured', 'core', 'workshop', 'iconic', 'token'].forEach(function (group) {
				var items = gd().novaUpgrades.filter(function (u) { return String(u.shop_group || '') === group; });
				if (!items.length) return;
				novaBox.appendChild(h('h3', { class: 'section-h' }, t(NOVA_GROUP_TITLES[group])));
				if (group === 'iconic') novaBox.appendChild(h('p', { class: 'dim' }, t('You buy an Iconic droid one time. After each Super Rebirth it costs 1M credits to get it back.')));
				var card = h('div', { class: 'row-card nova-list' });
				items.forEach(function (u) { card.appendChild(group === 'token' ? tokenRow(u) : upgradeRow(u)); });
				novaBox.appendChild(card);
			});
			novaBox.appendChild(h('p', { class: 'dim' }, t('Check the prices in game. They come from community fan sites.')));
		}
		function st() { return SH.state; }
		function applySettingsOpen() { settingsBox.hidden = !settingsOpen; settingsBtn.textContent = settingsOpen ? t('Hide the advice options') : t('Advice options'); settingsBtn.setAttribute('aria-expanded', String(settingsOpen)); }
		function upgradeRow(u) {
			var id = String(u.id), eff = optText(u.effect);
			var info = h('div', { class: 'small nova-info' });
			var step = ui.stepper({ minusLabel: t('Less'), plusLabel: t('More'), onStep: function (d) { ps().setNovaLevel(id, dom.clamp(ps().novaLevel(id) + d, 0, capOf(u))); },
				onValue: function () { ui.numberSheet({ title: ui.plain(u.name), min: 0, max: capOf(u), value: ps().novaLevel(id) }).then(function (v) { if (v != null) ps().setNovaLevel(id, dom.clamp(v, 0, capOf(u))); }); } });
			rowsN[id] = { info: info, step: step, u: u };
			return h('div', { class: 'nova-row' }, h('div', { class: 'grow' }, h('div', { class: 'row-title small-title' }, ui.plain(u.name)), eff ? h('div', { class: 'dim small' }, eff) : null, info), step.el);
		}
		function capOf(u) { var m = dom.maxLevel(u); return m < 0 ? SH.state.MAX_NOVA_LEVEL : m; }
		function tokenRow(u) {
			var eff = optText(u.effect);
			return h('div', { class: 'nova-row token' }, h('div', { class: 'grow' }, h('div', { class: 'row-title small-title' }, ui.plain(u.name)), eff ? h('div', { class: 'dim small' }, eff) : null),
				h('div', { class: 'row-big small' }, ui.num(dom.nextCost(u, 0))));
		}
		function updateNova() {
			var p = ps(), levels = p.novaLevels;
			Object.keys(rowsN).forEach(function (id) {
				var r = rowsN[id], u = r.u, lv = p.novaLevel(id), mx = dom.maxLevel(u);
				r.step.set(mx < 0 ? String(lv) : lv + '/' + mx, lv <= 0, mx >= 0 && lv >= mx);
				var next = dom.nextCost(u, lv), text;
				if (next < 0) text = t('Maximum');
				else {
					var left = dom.costToMax(u, lv);
					text = t('Next: %s', ui.num(next));
					if (left > next) text += SEP + t('To max: %s', ui.num(left)); else if (left < 0) text += SEP + t('No cap');
				}
				if (dom.isLocked(u, levels)) { var req = gd().novaUpgradeById[String(u.requires)]; text += SEP + t('Needs %s', req ? ui.plain(req.name) : t('unknown')); }
				r.info.textContent = text;
			});
			Object.keys(inputBtns).forEach(function (k) { var v = p.novaInput(k); inputBtns[k].textContent = v > 0 ? ui.num(v) : (k === 'multiplier' ? t('Auto') : '0'); });
			var tt = dom.novaTotals(gd().novaUpgrades, levels);
			s.status.textContent = t('Spent %s  |  %s left for all capped upgrades', ui.num(tt.spent), ui.num(tt.left));
			var sg = dom.novaSuggest(gd().novaUpgradeById, levels, multiplier(), p.novaInput('scrap_share'));
			if (!sg) { adviceEls.main.textContent = t('No advice'); adviceEls.detail.textContent = ''; }
			else if (sg.reason === 'need_multiplier') { adviceEls.main.textContent = t('Set the credit multiplier to get the advice'); adviceEls.detail.textContent = t('It is the multiplier that the game shows on your HUD.'); }
			else {
				var u = gd().novaUpgradeById[sg.id] || {}, lvn = p.novaLevel(sg.id) + 1;
				adviceEls.main.textContent = t('%s level %d for %s crystals', ui.plain(u.name), lvn, ui.num(Math.trunc(sg.cost)));
				adviceEls.detail.textContent = sg.reason === 'first' ? t('A good first buy.') : t('Credits: +%s income for %s. Scrap Value: +%s for %s.', pct(sg.credits_gain), ui.num(Math.trunc(sg.credits_cost)), pct(sg.scrap_gain), ui.num(Math.trunc(sg.scrap_cost)));
			}
			adviceEls.basis.textContent = p.novaInput('multiplier') > 0 ? t('Uses your multiplier: %sx', ui.num(p.novaInput('multiplier'))) : t('Uses a low estimate of your multiplier: %sx or more', multiplier().toFixed(1));
		}

		function refresh() {
			keepFocus(function () {
				renderChips();
				if (!novaBuilt) buildNova();
				updateNova();
			});
		}
		function refreshStatus() { if (s.sub === 'nova') { if (!novaBuilt) buildNova(); updateNova(); } else renderChips(); }
		var v = { el: s.el, dirty: true, refresh: function () { refresh(); refreshStatus(); }, onChange: function () { this.dirty = true; },
			setSub: function (sub) { var r = showSub(s, sub); refreshStatus(); return r; }, sub: function () { return s.sub; } };
		showSub(s, 'chips');
		return v;
	};

	/* =====================================================================================
	   Info: Events and Traits
	   ===================================================================================== */

	function when(unix) {
		var bias = -new Date(unix * 1000).getTimezoneOffset(), p = dom.localParts(unix, bias);
		return t(p.weekday) + ' ' + p.date + ', ' + p.time;
	}

	screens.info = function () {
		var s = sectioned('info', 'Info', [{ id: 'events', label: 'Events' }, { id: 'traits', label: 'Traits' }]);
		var evBox = h('div', { class: 'stack' }), trBox = h('div', { class: 'stack' });
		s.panels.events.appendChild(evBox); s.panels.traits.appendChild(trBox);
		var live = [], rebuildAt = 0, timer = null, evBuilt = false, trBuilt = false;

		function nowSec() { return Math.floor(Date.now() / 1000); }
		function updateLive(now) {
			live.forEach(function (it) {
				var occ = dom.nextOccurrence(it.row, now), txt = '';
				if (occ) {
					if (occ.active) txt = t('Live now, ends in %s', dom.countdown(occ.end - now));
					else if (it.mode === 'timer') txt = dom.countdown(occ.start - now);
					else txt = t('Starts in %s', dom.countdown(occ.start - now));
				}
				if (it.el.textContent !== txt) it.el.textContent = txt;
			});
		}
		function buildEvents() {
			evBuilt = true; live = []; rebuildAt = 0; clear(evBox);
			var now = nowSec(), timers = [], coming = [];
			gd().eventSchedule.forEach(function (row) {
				var occ = dom.nextOccurrence(row, now);
				if (!occ) return;
				if (String(row.kind || '') === 'timer') timers.push({ row: row, occ: occ });
				else {
					coming.push({ row: row, occ: occ });
					var edge = occ.active ? occ.end : occ.start;
					if (rebuildAt === 0 || edge < rebuildAt) rebuildAt = edge;
				}
			});
			evBox.appendChild(h('p', { class: 'dim small' }, t('Times are on the clock of this device')));
			if (timers.length) {
				var tg = h('div', { class: 'timer-grid' });
				timers.forEach(function (x) {
					var val = h('div', { class: 'timer-val' });
					live.push({ el: val, row: x.row, mode: 'timer' });
					tg.appendChild(h('div', { class: 'row-card timer' }, h('div', { class: 'dim small' }, ui.plain(x.row.name)), val));
				});
				evBox.appendChild(tg);
			}
			if (coming.length) {
				coming.sort(function (a, b) { return a.occ.active !== b.occ.active ? (a.occ.active ? -1 : 1) : a.occ.start - b.occ.start; });
				evBox.appendChild(h('h3', { class: 'section-h' }, t('Coming up')));
				coming.forEach(function (c) {
					var row = c.row, occ = c.occ, w = when(occ.start);
					if (occ.end > occ.start) {
						var e = dom.localParts(occ.end, -new Date(occ.end * 1000).getTimezoneOffset()), sp = dom.localParts(occ.start, -new Date(occ.start * 1000).getTimezoneOffset());
						w = t('%s to %s', w, e.date === sp.date ? e.time : when(occ.end));
					}
					var cd = h('div', { class: 'accent mono' });
					live.push({ el: cd, row: row, mode: 'event' });
					var desc = optText(row.description);
					evBox.appendChild(h('div', { class: 'row-card' + (occ.active ? ' live' : '') },
						h('div', { class: 'row-head' }, h('div', { class: 'row-title grow' }, ui.plain(row.name)), occ.active ? ui.tag(t('Live now'), 'var(--green)') : null),
						h('p', null, w), cd, desc ? h('p', { class: 'dim small' }, desc) : null));
				});
			}
			var past = gd().events.slice().sort(function (a, b) { return optText(a.start_date) < optText(b.start_date) ? 1 : (optText(a.start_date) > optText(b.start_date) ? -1 : 0); });
			if (past.length) {
				evBox.appendChild(h('h3', { class: 'section-h' }, t('Past events')));
				var card = h('div', { class: 'row-card past' });
				past.forEach(function (ev) {
					var a = optText(ev.start_date), b = optText(ev.end_date), date = (b === '' || b === a) ? a : t('%s to %s', a, b), added = optText(ev.added), parts = [];
					if (date) parts.push(date);
					if (added) parts.push(t('Added: %s', added));
					card.appendChild(h('div', { class: 'past-item' }, h('div', null, ui.plain(ev.name)), parts.length ? h('div', { class: 'dim small' }, parts.join(SEP)) : null));
				});
				evBox.appendChild(card);
			}
			if (!timers.length && !coming.length && !past.length) evBox.appendChild(h('p', null, t('No event data')));
			else evBox.appendChild(h('p', { class: 'dim' }, t('Check the times in game. They come from a community fan site.')));
			updateLive(now);
		}
		function tick() {
			var now = nowSec();
			if (rebuildAt > 0 && now >= rebuildAt) { buildEvents(); return; }
			updateLive(now);
		}

		var TIERS = [['common', 'Common', ''], ['gold', 'Gold', 'gold'], ['diamond', 'Diamond', 'diamond'], ['rainbow', 'Rainbow', 'rainbow']];
		function ofKind(k) { return gd().traits.filter(function (x) { return String(x.kind || '') === k; }); }
		function traitHead(box, x) {
			box.appendChild(h('div', { class: 'row-title small-title' }, ui.plain(x.name)));
			var parts = ['effect', 'slot'].map(function (k) { return optText(x[k]); }).filter(Boolean);
			if (parts.length) box.appendChild(h('div', { class: 'dim small' }, parts.join(SEP)));
		}
		function traitNote(box, x) { var n = optText(x.notes); if (n) box.appendChild(h('div', { class: 'small dim' }, n)); }
		function buildTraits() {
			trBuilt = true; clear(trBox);
			if (!gd().traits.length) { trBox.appendChild(h('p', null, t('No trait data'))); return; }
			trBox.appendChild(h('p', { class: 'dim small' }, t('A trait is a second bonus on one droid')));
			ofKind('note').forEach(function (x) { trBox.appendChild(h('div', { class: 'row-card' }, h('h3', { class: 'accent' }, ui.plain(x.name)), h('p', null, ui.plain(x.effect)))); });
			trBox.appendChild(h('h3', { class: 'section-h' }, t('Traits in four tiers')));
			ofKind('tiered').forEach(function (x) {
				var card = h('div', { class: 'row-card' }); traitHead(card, x);
				var g = h('div', { class: 'tier-grid' });
				TIERS.forEach(function (tt) { g.appendChild(h('div', null, h('div', { class: 'small', style: 'color:' + (tt[2] ? ui.vVar(tt[2]) : 'var(--text)') }, t(tt[1])), h('div', { class: 'row-title small-title' }, optText(x[tt[0]]) || '-'))); });
				card.appendChild(g); traitNote(card, x); trBox.appendChild(card);
			});
			trBox.appendChild(h('h3', { class: 'section-h' }, t('Rainbow only')));
			ofKind('rainbow').forEach(function (x) { var card = h('div', { class: 'row-card', style: '--rc:' + ui.vVar('rainbow'), 'data-accent': '1' }); traitHead(card, x); traitNote(card, x); trBox.appendChild(card); });
			trBox.appendChild(h('h3', { class: 'section-h' }, t('Iconic droid traits')));
			ofKind('iconic').forEach(function (x) {
				var d = droid(optText(x.droid_id)), box = h('div', { class: 'grow' });
				box.appendChild(h('div', { class: 'dim small' }, d ? rawName(d) : t('unknown'))); traitHead(box, x); traitNote(box, x);
				trBox.appendChild(h('div', { class: 'row-card', style: '--rc:' + ui.rVar('iconic') }, h('div', { class: 'row-head' }, ui.tile(d, 'md', true), box)));
			});
			trBox.appendChild(h('p', { class: 'dim' }, t('Check the values in game. They come from a community fan site.')));
		}

		function start() { if (!timer) timer = setInterval(tick, 1000); }
		function stop() { if (timer) { clearInterval(timer); timer = null; } }
		var v = { el: s.el, dirty: false,
			refresh: function () { if (!evBuilt) buildEvents(); else tick(); if (!trBuilt) buildTraits(); },
			onChange: function () { },
			onShow: function () { if (s.sub === 'events') { buildEvents(); start(); } },
			onHide: function () { stop(); },
			setSub: function (sub) { var r = showSub(s, sub); if (r === 'events') { if (!evBuilt) buildEvents(); start(); } else stop(); return r; },
			sub: function () { return s.sub; } };
		showSub(s, 'events');
		return v;
	};

	/* =====================================================================================
	   Droid art follows the account: the tiles are built again when the images arrive.
	   ===================================================================================== */
})();
