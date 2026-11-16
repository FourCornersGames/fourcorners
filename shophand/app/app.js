/* Shop Hand web page: layout shell (milestone W3). Vanilla JS, no build step.
   Text comes from window.SH_STRINGS (made by tools/export_web.py in the app repo).
   Data comes from /shophand/data/gamedata.json (the public build only). */
(function () {
	'use strict';

	var S = window.SH_STRINGS || {};
	var LANG = (document.documentElement.lang || 'en').slice(0, 2) === 'fr' ? 'fr' : 'en';
	var DATA_URL = '/shophand/data/gamedata.json';
	var DISCLAIMER = 'This is an unofficial fan-made helper for a Fortnite creator-made island (island code 7865-8305-9184). It is not affiliated with or endorsed by Epic Games, Disney, Lucasfilm or FOAD.';
	var NO_LOGOS = 'It uses no game logos and no key art. All names belong to their owners.';
	var LEGAL = {
		en: { privacy: '/shophand/privacy.html', terms: '/shophand/terms.html' },
		fr: { privacy: '/fr/shophand/confidentialite.html', terms: '/fr/shophand/conditions.html' }
	}[LANG];

	/* ---------- helpers ---------- */

	// Look up a string by its key and fill in %s, %d and %.1f in order.
	function t(key) {
		var e = S[key];
		var s = (e && e[LANG]) || key;
		var args = arguments, i = 1;
		return s.replace(/%(?:\.\d+)?[sdf]/g, function () { var v = args[i++]; return v == null ? '' : v; });
	}
	function hasKey(key) { return Object.prototype.hasOwnProperty.call(S, key); }

	function h(tag, attrs) {
		var e = document.createElement(tag);
		if (attrs) {
			Object.keys(attrs).forEach(function (k) {
				var v = attrs[k];
				if (v == null || v === false) return;
				if (k === 'class') e.className = v;
				else if (k === 'text') e.textContent = v;
				else if (k === 'style') e.setAttribute('style', v);
				else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
				else e.setAttribute(k, v === true ? '' : v);
			});
		}
		for (var i = 2; i < arguments.length; i++) {
			var c = arguments[i];
			if (c == null || c === false) continue;
			e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
		}
		return e;
	}
	function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
	function slug(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_-]/g, ''); }
	function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
	function isBlank(v) { return v == null || v === '' || (typeof v === 'number' && isNaN(v)); }

	var nf = new Intl.NumberFormat(LANG, { maximumFractionDigits: 2 });
	// 10000 -> 10K, 2500000 -> 2.5M
	function shortNum(n) {
		if (typeof n !== 'number' || !isFinite(n)) return t('unknown');
		var units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
		for (var i = 0; i < units.length; i++) {
			if (Math.abs(n) >= units[i][0]) {
				var v = Math.round(n / units[i][0] * 100) / 100;
				if (Math.abs(v) >= 1000 && i > 0) { v = Math.round(v / 1000 * 100) / 100; return nf.format(v) + units[i - 1][1]; }
				return nf.format(v) + units[i][1];
			}
		}
		return nf.format(n);
	}

	/* ---------- data ---------- */

	var D = null;
	var droidMap = {};
	function droid(id) { return isBlank(id) ? null : (droidMap[id] || null); }
	function droidName(id) { var d = droid(id); return d && !isBlank(d.name) ? d.name : (isBlank(id) ? t('unknown') : String(id)); }
	function rarityName(id) { return isBlank(id) ? t('unknown') : (hasKey('term.rarity.' + id) ? t('term.rarity.' + id) : String(id)); }
	function roleName(r) { return isBlank(r) ? t('unknown') : (hasKey('term.role.' + r) ? t('term.role.' + r) : String(r)); }
	function tierName(id) { return isBlank(id) ? t('unknown') : (hasKey('term.variant.' + id) ? t('term.variant.' + id) : String(id)); }
	function rows(name) { return D && Array.isArray(D[name]) ? D[name] : []; }

	function tile(d, size) {
		var name = d && !isBlank(d.name) ? String(d.name) : '?';
		var letter = (Array.from(name.trim())[0] || '?').toUpperCase();
		var r = d ? slug(d.rarity) : '';
		return h('span', { class: 'tile' + (size ? ' ' + size : ''), 'aria-hidden': 'true',
			style: '--rc:var(--r-' + (r && hasKey('term.rarity.' + r) ? r : 'unknown') + ')' }, letter);
	}

	function droidChip(id, tierId, showTier) {
		var d = droid(id);
		var text = h('span', { class: 'chip-text' }, droidName(id));
		if (showTier) text.appendChild(h('span', { class: 'tier', style: '--vc:var(--v-' + slug(tierId || 'base') + ')' }, tierName(tierId)));
		return h('span', { class: 'chip' }, tile(d, 'sm'), text);
	}

	/* ---------- routing state ---------- */

	var TABS = ['collection', 'fusions', 'rebirth', 'upgrades', 'info'];
	var SUBS = { upgrades: ['chips', 'nova'], info: ['events', 'traits'] };
	var lastHash = '#collection';
	var aboutPushed = false;
	var detailPushed = false;
	var views = {};
	var els = {};

	var wideMq = window.matchMedia('(min-width: 1100px)');

	/* ---------- Collection ---------- */

	var col = { q: '', rarity: '', selected: null };

	function buildCollection() {
		var root = h('section', { class: 'view view-collection', id: 'view-collection', 'aria-labelledby': 'h-collection' });
		var search = h('input', { class: 'field', type: 'search', 'aria-label': t('Search by name'), placeholder: t('Search by name'),
			autocomplete: 'off', enterkeyhint: 'search', oninput: function () { col.q = this.value; renderGrid(); } });
		var sel = h('select', { class: 'field', 'aria-label': t('Rarity'),
			onchange: function () { col.rarity = this.value; renderGrid(); } },
			h('option', { value: '' }, t('All rarities')));
		rows('rarities').slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (r) {
			sel.appendChild(h('option', { value: r.id }, rarityName(r.id)));
		});
		var count = h('span', { class: 'count', 'aria-live': 'polite' });
		var toolbar = h('div', { class: 'toolbar' }, search, sel, count);
		var grid = h('ul', { class: 'grid', id: 'droid-grid' });
		var empty = h('div', { class: 'empty', hidden: true }, h('h3', null, t('No droids match your search.')));
		var listPane = h('div', { class: 'list-pane' },
			h('h2', { id: 'h-collection', class: 'sr-only' }, t('Collection')),
			toolbar, grid, empty);

		var detail = h('aside', { class: 'detail', id: 'detail', 'aria-label': t('Droid details') });
		var scrim = h('button', { class: 'scrim', type: 'button', 'aria-label': t('Close'), tabindex: '-1', hidden: true, onclick: function () { closeDetail(); } });
		root.appendChild(h('div', { class: 'split' }, listPane, detail));
		root.appendChild(scrim);
		els.grid = grid; els.count = count; els.empty = empty; els.detail = detail; els.scrim = scrim;
		renderGrid();
		renderDetail();
		return root;
	}

	function renderGrid() {
		var q = norm(col.q.trim());
		var list = rows('droids').filter(function (d) {
			if (col.rarity && d.rarity !== col.rarity) return false;
			return !q || norm(d.name).indexOf(q) !== -1;
		});
		clear(els.grid);
		list.forEach(function (d) {
			var r = slug(d.rarity);
			var btn = h('button', { class: 'card', type: 'button', 'data-id': d.id, 'aria-pressed': String(col.selected === d.id),
				onclick: function () { selectDroid(d.id); } },
				tile(d),
				h('span', { class: 'card-text' },
					h('span', { class: 'card-name' }, isBlank(d.name) ? t('unknown') : d.name),
					h('span', { class: 'card-meta' },
						h('span', { class: 'rar', style: '--rc:var(--r-' + (hasKey('term.rarity.' + r) ? r : 'unknown') + ')' }, rarityName(d.rarity)),
						' · ' + roleName(d.role))));
			els.grid.appendChild(h('li', null, btn));
		});
		els.count.textContent = t('%d droids', list.length);
		els.empty.hidden = list.length > 0;
		els.grid.hidden = list.length === 0;
	}

	function selectDroid(id) {
		var target = '#collection/' + encodeURIComponent(id);
		if (wideMq.matches) { history.replaceState(null, '', target); route(); }
		else { detailPushed = true; location.hash = target; }
	}
	function closeDetail() {
		if (detailPushed) { detailPushed = false; history.back(); }
		else { history.replaceState(null, '', '#collection'); route(); }
	}

	function detailRow(dl, label, value, fmt) {
		var unk = isBlank(value);
		dl.appendChild(h('dt', null, label));
		dl.appendChild(h('dd', { class: unk ? 'unk' : '' }, unk ? t('unknown') : (fmt ? fmt(value) : String(value))));
	}

	function renderDetail() {
		var box = clear(els.detail);
		var d = col.selected ? droid(col.selected) : null;
		var open = !!col.selected;
		els.detail.classList.toggle('open', open);
		els.scrim.hidden = !open;
		var emptyMsg = h('div', { class: 'empty detail-empty' }, h('h3', null, t('Droid details')), h('p', null, t('Choose a droid to see its details.')));
		if (!open) { box.appendChild(emptyMsg); return; }
		if (!d) {
			box.appendChild(h('div', { class: 'detail-top' }, h('h2', null, t('This droid is not in the data.')),
				h('button', { class: 'btn close', type: 'button', onclick: closeDetail }, t('Close'))));
			return;
		}
		box.appendChild(h('div', { class: 'detail-top' },
			tile(d, 'lg'),
			h('div', { style: 'min-width:0' },
				h('h2', { id: 'detail-title', tabindex: '-1' }, isBlank(d.name) ? t('unknown') : d.name),
				h('p', { class: 'meta' }, h('span', { class: 'rar', style: '--rc:var(--r-' + (hasKey('term.rarity.' + slug(d.rarity)) ? slug(d.rarity) : 'unknown') + ')' }, rarityName(d.rarity)),
					' · ' + roleName(d.role))),
			h('button', { class: 'btn close', type: 'button', 'aria-label': t('Close'), onclick: closeDetail }, t('Close'))));

		var dl = h('dl', { class: 'dl' });
		detailRow(dl, t('Rarity'), d.rarity, rarityName);
		detailRow(dl, t('Role'), d.role, roleName);
		detailRow(dl, t('Obtain method'), d.obtain_method);
		detailRow(dl, t('Buy'), d.buy_cost, shortNum);
		detailRow(dl, t('Per sec'), d.base_income_per_sec, shortNum);
		detailRow(dl, t('Per min'), d.income_per_min, shortNum);
		detailRow(dl, t('Companion trait'), d.companion_trait);
		detailRow(dl, t('Craft time'), d.craft_time);
		detailRow(dl, t('Sell value'), d.sell_value, shortNum);
		box.appendChild(dl);

		var recipes = rows('fusion_recipes').filter(function (r) { return r.output_droid_id === d.id; });
		recipes.forEach(function (r) {
			box.appendChild(h('h3', null, t('Fusion recipe')));
			box.appendChild(h('div', { class: 'chips' }, droidChip(r.input1_id), droidChip(r.input2_id), droidChip(r.input3_id)));
			if (!isBlank(r.unlock_rebirth)) box.appendChild(h('p', { class: 'dim small', style: 'margin-top:0.5rem' }, t('Unlocks at rebirth %s', r.unlock_rebirth)));
		});

		/* W4: the owned state (mark as owned, variants) goes here. */
		box.appendChild(h('div', { class: 'owned-slot', 'data-slot': 'owned' }, t('Owned state comes in a later version.')));
	}

	/* ---------- Fusions ---------- */

	function buildFusions() {
		var root = h('section', { class: 'view', id: 'view-fusions', 'aria-labelledby': 'h-fusions' },
			h('div', { class: 'view-head' }, h('h2', { id: 'h-fusions' }, t('Fusions'))));
		var list = rows('fusion_recipes');
		if (!list.length) { root.appendChild(emptyState()); return root; }
		var wrap = h('ul', { class: 'rows' });
		list.forEach(function (r) {
			var out = droid(r.output_droid_id);
			var head = h('div', { class: 'row-head' }, tile(out),
				h('div', { class: 'grow' }, h('div', { class: 'row-title' }, droidName(r.output_droid_id)), h('div', { class: 'row-sub' }, t('Output'))));
			var card = h('div', { class: 'row-card' }, head,
				h('div', { class: 'row-sub', style: 'margin-bottom:0.375rem' }, t('Inputs')),
				h('div', { class: 'chips' }, droidChip(r.input1_id), droidChip(r.input2_id), droidChip(r.input3_id)));
			var foot = [];
			if (!isBlank(r.unlock_rebirth)) foot.push(t('Unlocks at rebirth %s', r.unlock_rebirth));
			if (!isBlank(r.credit_cost)) foot.push(t('Fusion cost') + ': ' + shortNum(r.credit_cost));
			if (foot.length) card.appendChild(h('p', { class: 'row-foot' }, foot.join(' · ')));
			wrap.appendChild(h('li', null, card));
		});
		root.appendChild(wrap);
		return root;
	}

	/* ---------- Rebirth ---------- */

	var rb = { path: '' };
	function buildRebirth() {
		var root = h('section', { class: 'view', id: 'view-rebirth', 'aria-labelledby': 'h-rebirth' },
			h('div', { class: 'view-head' }, h('h2', { id: 'h-rebirth' }, t('Rebirth')),
				h('span', { class: 'dim small' }, t('Rebirth rows: %d', rows('rebirths').length))));
		var list = rows('rebirths');
		if (!list.length) { root.appendChild(emptyState()); return root; }
		var paths = [];
		list.forEach(function (r) { if (!isBlank(r.path) && paths.indexOf(String(r.path)) === -1) paths.push(String(r.path)); });
		paths.sort(function (a, b) { return (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b); });
		var pills = h('div', { class: 'pills', role: 'group', 'aria-label': t('Path %s', '') });
		var out = h('ul', { class: 'rows' });
		function draw() {
			Array.prototype.forEach.call(pills.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-path') === rb.path)); });
			clear(out);
			list.filter(function (r) { return !rb.path || String(r.path) === rb.path; })
				.sort(function (a, b) { return (a.rebirth_number || 0) - (b.rebirth_number || 0) || String(a.path).localeCompare(String(b.path)); })
				.forEach(function (r) {
					var chips = h('div', { class: 'chips' });
					[1, 2, 3].forEach(function (n) {
						var id = r['droid' + n + '_id'];
						if (isBlank(id)) chips.appendChild(h('span', { class: 'chip dim' }, h('span', { class: 'chip-text' }, t('unknown'))));
						else chips.appendChild(droidChip(id, r['droid' + n + '_tier'], true));
					});
					var card = h('div', { class: 'row-card' },
						h('div', { class: 'row-head' },
							h('div', { class: 'grow' }, h('div', { class: 'row-title' }, isBlank(r.rebirth_number) ? t('unknown') : t('Rebirth %d', r.rebirth_number)),
								h('div', { class: 'row-sub' }, t('Path %s', isBlank(r.path) ? t('unknown') : r.path))),
							h('div', { class: 'row-big', title: t('Credits') }, shortNum(r.credits_required))),
						chips);
					if (!isBlank(r.reward)) card.appendChild(h('p', { class: 'row-foot' }, t('Reward: %s', r.reward)));
					out.appendChild(h('li', null, card));
				});
		}
		pills.appendChild(h('button', { class: 'pill', type: 'button', 'data-path': '', onclick: function () { rb.path = ''; draw(); } }, t('All paths')));
		paths.forEach(function (p) {
			pills.appendChild(h('button', { class: 'pill', type: 'button', 'data-path': p, onclick: function () { rb.path = p; draw(); } }, t('Path %s', p)));
		});
		root.appendChild(pills);
		root.appendChild(out);
		draw();
		return root;
	}

	/* ---------- Upgrades and Info (sections, no data yet) ---------- */

	function emptyState(sub) {
		return h('div', { class: 'empty' }, h('h3', null, t('No data yet')), sub ? h('p', null, sub) : null);
	}

	function buildSectioned(tab, titleKey, defs) {
		var root = h('section', { class: 'view', id: 'view-' + tab, 'aria-labelledby': 'h-' + tab },
			h('div', { class: 'view-head' }, h('h2', { id: 'h-' + tab }, t(titleKey))));
		var seg = h('nav', { class: 'seg', 'aria-label': t('Sections') });
		var panels = {};
		defs.forEach(function (def) {
			seg.appendChild(h('a', { href: '#' + tab + '/' + def.id, 'data-sub': def.id }, t(def.label)));
			var n = def.count();
			panels[def.id] = h('div', { class: 'panel', hidden: true },
				n > 0 ? h('div', { class: 'empty' }, h('p', null, t('%d rows are ready. The list comes in a later version.', n))) : emptyState(def.empty ? t(def.empty) : null));
			root.appendChild(panels[def.id]);
		});
		root.insertBefore(seg, root.children[1]);
		root._seg = seg; root._panels = panels;
		return root;
	}

	/* ---------- About ---------- */

	function buildAbout() {
		var dlg = els.about;
		var close = h('button', { class: 'btn', type: 'button', onclick: closeAbout, 'aria-label': t('Close') }, t('Close'));
		var meta = [];
		if (D && D.data_version) meta.push(t('Data version: %s (%s)', D.data_version, D.updated || t('unknown')));
		clear(dlg).appendChild(h('div', { class: 'about-in' },
			h('header', null, h('h2', { id: 'about-title' }, t('About')), close),
			h('h3', null, t('Disclaimer')),
			h('p', { class: 'disclaimer' }, t(DISCLAIMER)),
			h('p', { class: 'dim' }, t(NO_LOGOS)),
			h('h3', null, t('Free and unofficial')),
			h('p', null, 'Shop Hand · ' + t('Four Corners Games')),
			h('p', { class: 'dim' }, t('A two-person indie studio from Quebec.')),
			h('p', null, t('Contact: %s', ''), h('a', { href: 'mailto:support@fourcornersgames.ca' }, 'support@fourcornersgames.ca')),
			h('h3', null, t('Data sources')),
			h('ul', null,
				h('li', null, t('Fortnite Wiki on Fandom, CC BY-SA licence.')),
				h('li', null, t('Community data by Nackz, MIT licence.')),
				h('li', null, t('The island is made by FOAD. Thank you to the FOAD team for the game.'))),
			meta.length ? h('p', { class: 'dim small', style: 'margin-top:0.75rem' }, meta.join(' ')) : null,
			h('div', { class: 'about-links' },
				h('a', { class: 'btn', href: LEGAL.privacy }, t('Privacy Policy')),
				h('a', { class: 'btn', href: LEGAL.terms }, t('Terms of Use')))));
	}

	function openAbout() {
		if (!els.about.open) {
			if (typeof els.about.showModal === 'function') els.about.showModal(); else els.about.setAttribute('open', '');
		}
	}
	function closeAbout() {
		if (aboutPushed) { aboutPushed = false; history.back(); }
		else { history.replaceState(null, '', lastHash); route(); }
	}

	/* ---------- router ---------- */

	function route() {
		var parts = location.hash.replace(/^#\/?/, '').split('/').map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
		var name = parts[0];

		if (name === 'about') { if (D) openAbout(); return; }
		aboutPushed = false;
		if (els.about.open) els.about.close();

		if (TABS.indexOf(name) === -1) { name = 'collection'; parts = [name]; history.replaceState(null, '', '#collection'); }
		lastHash = '#' + parts.map(encodeURIComponent).join('/');
		var prev = document.body.getAttribute('data-tab');
		document.body.setAttribute('data-tab', name);

		TABS.forEach(function (tab) { if (views[tab]) views[tab].hidden = tab !== name; });
		Array.prototype.forEach.call(els.tabs.querySelectorAll('.tab'), function (a) {
			if (a.getAttribute('data-tab') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
		});
		if (prev !== name) els.content.scrollTop = 0;

		if (name === 'collection' && views.collection) {
			var id = parts[1] || null;
			if (id !== col.selected) {
				col.selected = id;
				renderDetail();
				Array.prototype.forEach.call(els.grid.querySelectorAll('.card'), function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-id') === id)); });
				if (id && !wideMq.matches) {
					var tt = document.getElementById('detail-title'); if (tt) tt.focus({ preventScroll: true });
				}
			}
			if (!id) detailPushed = false;
		}
		if (SUBS[name] && views[name]) {
			var sub = SUBS[name].indexOf(parts[1]) !== -1 ? parts[1] : SUBS[name][0];
			var v = views[name];
			Object.keys(v._panels).forEach(function (k) { v._panels[k].hidden = k !== sub; });
			Array.prototype.forEach.call(v._seg.children, function (a) {
				if (a.getAttribute('data-sub') === sub) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
			});
		}
	}

	/* ---------- start ---------- */

	function applyStatic() {
		Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (e) { e.textContent = t(e.getAttribute('data-i18n')); });
		Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-label]'), function (e) { e.setAttribute('aria-label', t(e.getAttribute('data-i18n-label'))); });
	}

	function init() {
		els.content = document.getElementById('main');
		els.view = document.getElementById('view');
		els.tabs = document.getElementById('tabs');
		els.about = document.getElementById('about');
		applyStatic();

		document.getElementById('about-btn').addEventListener('click', function (e) {
			e.preventDefault(); aboutPushed = true; location.hash = '#about';
		});
		els.about.addEventListener('close', function () { if (location.hash === '#about') closeAbout(); });
		els.about.addEventListener('click', function (e) { if (e.target === els.about) els.about.close(); });
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && !els.about.open && col.selected && !wideMq.matches) closeDetail();
		});
		wideMq.addEventListener('change', function () { renderDetail(); });
		window.addEventListener('hashchange', route);

		fetch(DATA_URL, { credentials: 'same-origin' })
			.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
			.then(function (j) { D = j; })
			.catch(function (err) { console.warn('Shop Hand data not loaded:', err); D = null; })
			.then(function () {
				clear(els.view);
				if (!D) {
					els.view.appendChild(h('section', { class: 'view' }, emptyState(t('Data could not be loaded.'))));
					buildAbout();
					window.addEventListener('hashchange', route);
					if (location.hash === '#about') openAbout();
					return;
				}
				rows('droids').forEach(function (d) { droidMap[d.id] = d; });
				views.collection = buildCollection();
				views.fusions = buildFusions();
				views.rebirth = buildRebirth();
				views.upgrades = buildSectioned('upgrades', 'Upgrades', [
					{ id: 'chips', label: 'Chips', count: function () { return rows('upgrade_costs').length; } },
					{ id: 'nova', label: 'Nova Shop', count: function () { return rows('nova_shop').length + rows('nova_upgrades').length; } }]);
				views.info = buildSectioned('info', 'Info', [
					{ id: 'events', label: 'Events', empty: 'No event data', count: function () { return rows('events').length; } },
					{ id: 'traits', label: 'Traits', empty: 'No trait data', count: function () { return rows('traits').length; } }]);
				TABS.forEach(function (tab) { views[tab].hidden = true; els.view.appendChild(views[tab]); });
				buildAbout();
				route();
				if (location.hash === '#about') openAbout();
			});
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
