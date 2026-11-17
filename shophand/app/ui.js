/* Shop Hand UI helpers (milestone W4): text, elements, portrait tiles, pill pickers, bottom sheets, dialogs, toast.
   Vanilla JS, no build step. Everything the screens share lives here (window.SH.ui). */
(function () {
	'use strict';
	var SH = window.SH = window.SH || {};
	var dom = SH.domain;
	var S = window.SH_STRINGS || {};
	var LANG = (document.documentElement.lang || 'en').slice(0, 2) === 'fr' ? 'fr' : 'en';
	// The release version: one source of truth, <meta name="sh-version"> in the page (see README, "bump the version").
	// Every file the page loads at run time (vendor scripts, the data) carries it as ?v=, so a new release is never
	// served from an old copy in the browser cache or the service worker.
	var vm = document.querySelector('meta[name="sh-version"]');
	SH.version = vm && /^\d{8}-\d{1,3}$/.test(vm.content) ? vm.content : '';
	SH.versioned = function (url) { return SH.version ? url + '?v=' + SH.version : url; };
	var ui = SH.ui = { LANG: LANG, ctx: { gd: null, ps: null, sync: null, cloud: null, art: null } };

	/* ---------- text ---------- */

	// Look up a string by its key and fill in %s, %d and %.1f in order.
	function t(key) {
		var e = S[key];
		var s = (e && e[LANG]) || key;
		if (arguments.length === 1) return s;
		var args = Array.prototype.slice.call(arguments, 1);
		return dom.sprintf.apply(null, [s].concat(args));
	}
	function hasKey(key) { return Object.prototype.hasOwnProperty.call(S, key); }
	function isBlank(v) { return v == null || v === '' || (typeof v === 'number' && isNaN(v)); }
	function slug(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_-]/g, ''); }
	function num(n) { return dom.formatNumber(n, { lang: LANG, unknown: t('unknown') }); }
	function plain(v) { return isBlank(v) ? t('unknown') : String(v); }
	// A fixed game term by id (rarity, variant, role, obtain). No entry: the name from the data.
	function term(kind, id, fallback) {
		var key = 'term.' + kind + '.' + id;
		return hasKey(key) ? t(key) : (isBlank(fallback) ? (isBlank(id) ? t('unknown') : String(id)) : String(fallback));
	}
	function rarityName(id) { if (isBlank(id)) return t('unknown'); var r = ui.ctx.gd && ui.ctx.gd.rarityById[id]; return term('rarity', id, r && r.name); }
	function roleName(r) { return isBlank(r) ? t('unknown') : term('role', r, r); }
	function tierName(id) { if (isBlank(id)) return t('unknown'); var x = ui.ctx.gd && ui.ctx.gd.tierById[id]; return term('variant', id, x && x.name); }
	function obtainName(v) { return isBlank(v) ? t('unknown') : term('obtain', v, v); }
	function rVar(id) { var s = slug(id); return 'var(--r-' + (s && hasKey('term.rarity.' + s) ? s : 'unknown') + ')'; }
	function vVar(id) { var s = slug(id); return 'var(--v-' + (s && hasKey('term.variant.' + s) ? s : 'base') + ')'; }

	/* ---------- elements ---------- */

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
			if (Array.isArray(c)) { c.forEach(function (x) { if (x != null && x !== false) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }); continue; }
			e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
		}
		return e;
	}
	function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
	var SVGNS = 'http://www.w3.org/2000/svg';
	function icon(path, cls) {
		var s = document.createElementNS(SVGNS, 'svg');
		s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
		s.setAttribute('stroke-width', '2.5'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
		s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ico ' + (cls || ''));
		var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', path); s.appendChild(p);
		return s;
	}
	var ICONS = { chevron: 'M8 10l4 4 4-4', right: 'M10 7l5 5-5 5', x: 'M6 6l12 12M18 6L6 18', sort: 'M4 7h16M4 12h11M4 17h6', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', rows: 'M4 5h16v6H4zM4 14h16v5H4z', check: 'M5 12l5 5 9-10', minus: 'M6 12h12', plus: 'M12 6v12M6 12h12' };
	ui.ico = function (name, cls) { return icon(ICONS[name], cls); };

	/* ---------- portrait tile (a placeholder letter tile; the owner's images show only for the owner) ---------- */

	// owned === false: a dark silhouette. tierId: asks for the variant image first.
	function tile(d, size, owned, tierId) {
		var name = d && !isBlank(d.name) ? String(d.name) : '?';
		var letter = (Array.from(name.trim())[0] || '?').toUpperCase();
		var cls = 'tile' + (size ? ' ' + size : '') + (owned === false ? ' off' : '');
		var src = d && ui.ctx.art ? ui.ctx.art.url(d.id, tierId) : null;
		var el = h('span', { class: cls + (src ? ' has-art' : ''), 'aria-hidden': 'true', style: '--rc:' + rVar(d && d.rarity), 'data-id': d ? d.id : '' });
		if (src) el.appendChild(h('img', { src: src, alt: '', loading: 'lazy', decoding: 'async' }));
		else el.appendChild(h('span', { class: 'letter' }, letter));
		return el;
	}

	/* ---------- bottom sheets and dialogs (native <dialog>: focus trap, Escape, top layer) ---------- */

	var sheetOpen = null;
	// build(body, close) fills the sheet. Returns {close}. opts.wide: a larger sheet.
	function sheet(title, build, opts) {
		opts = opts || {};
		var prevFocus = document.activeElement;
		var dlg = h('dialog', { class: 'sheet' + (opts.cls ? ' ' + opts.cls : ''), 'aria-label': title });
		var body = h('div', { class: 'sheet-body' });
		function close(result) { if (dlg.open) { dlg._result = result; dlg.close(); } }
		dlg.appendChild(h('div', { class: 'sheet-panel' }, h('div', { class: 'grab', 'aria-hidden': 'true' }), h('h2', { class: 'sheet-title' }, title), body));
		document.body.appendChild(dlg);
		dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
		dlg.addEventListener('close', function () {
			if (sheetOpen === dlg) sheetOpen = null;
			if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
			if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
			if (opts.onClose) opts.onClose(dlg._result);
		});
		build(body, close);
		sheetOpen = dlg;
		if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
		return { close: close, el: dlg, body: body };
	}
	ui.sheet = sheet;
	ui.closeSheet = function () { if (sheetOpen && sheetOpen.open) { sheetOpen.close(); return true; } return false; };

	// A pill field: shows the current choice, opens a sheet of big options. opts: {title, options, value, prefix, icon, columns, onPick}
	// options: [{label, value, color, state ('got'|'working'), short}]
	ui.picker = function (opts) {
		var value = opts.value;
		var btn = h('button', { class: 'pill-field', type: 'button', 'aria-haspopup': 'dialog' });
		function optOf(v) { for (var i = 0; i < opts.options.length; i++) if (opts.options[i].value === v) return opts.options[i]; return opts.options[0]; }
		function paint() {
			var o = optOf(value) || {};
			clear(btn);
			if (opts.icon) btn.appendChild(ui.ico(opts.icon, 'lead'));
			if (o.color) btn.appendChild(h('span', { class: 'dot', style: 'background:' + o.color }));
			btn.appendChild(h('span', { class: 'pf-text', style: o.color ? 'color:' + o.color : null }, (opts.prefix || '') + (o.short != null ? o.short : o.label)));
			if (o.state === 'got') btn.appendChild(ui.ico('check', 'state got'));
			else if (o.state === 'working') btn.appendChild(h('span', { class: 'state working' }));
			btn.appendChild(ui.ico('chevron', 'chev'));
			btn.setAttribute('aria-label', opts.title + ': ' + (o.label || ''));
		}
		btn.addEventListener('click', function () {
			sheet(opts.title, function (body, close) {
				var cols = opts.columns || (opts.options.length > 8 && opts.options.every(function (o) { return String(o.label).length <= 9; }) ? 3 : 2);
				var grid = h('div', { class: 'opts cols-' + cols, role: 'listbox', 'aria-label': opts.title });
				opts.options.forEach(function (o) {
					var sel = o.value === value;
					var b = h('button', { class: 'opt' + (sel ? ' sel' : ''), type: 'button', role: 'option', 'aria-selected': String(sel),
						onclick: function () { value = o.value; paint(); close(); if (opts.onPick) opts.onPick(o.value); } },
						o.color ? h('span', { class: 'dot', style: 'background:' + o.color }) : null,
						h('span', { class: 'opt-text' }, o.label),
						o.state === 'got' ? ui.ico('check', 'state got') : (o.state === 'working' ? h('span', { class: 'state working' }) : null),
						sel ? h('span', { class: 'sel-mark', 'aria-hidden': 'true' }, ui.ico('check')) : null);
					grid.appendChild(b);
				});
				body.appendChild(grid);
				setTimeout(function () { var s = grid.querySelector('.sel') || grid.firstChild; if (s && s.focus) s.focus({ preventScroll: false }); }, 0);
			});
		});
		btn.setValue = function (v) { value = v; paint(); };
		btn.setOptions = function (o) { opts.options = o; paint(); };
		paint();
		return btn;
	};

	// A yes/no dialog. Resolves true or false.
	ui.confirm = function (o) {
		return new Promise(function (resolve) {
			var done = false;
			sheet(o.title, function (body, close) {
				if (o.text) body.appendChild(h('p', { class: 'sheet-text' }, o.text));
				body.appendChild(h('div', { class: 'sheet-actions' },
					h('button', { class: 'btn', type: 'button', onclick: function () { done = true; close(false); } }, o.cancel || t('Cancel')),
					h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary'), type: 'button', onclick: function () { done = true; close(true); } }, o.ok || t('OK'))));
			}, { cls: 'compact', onClose: function (r) { resolve(done && r === true); } });
		});
	};
	// A message with one button.
	ui.alert = function (title, text) {
		return new Promise(function (resolve) {
			sheet(title, function (body, close) {
				body.appendChild(h('p', { class: 'sheet-text' }, text));
				body.appendChild(h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: function () { close(); } }, t('OK'))));
			}, { cls: 'compact', onClose: function () { resolve(); } });
		});
	};
	// Choose one of several buttons. choices: [{value, label, cls}]. Resolves the value or null.
	ui.choose = function (title, text, choices) {
		return new Promise(function (resolve) {
			var picked = null;
			sheet(title, function (body, close) {
				(Array.isArray(text) ? text : [text]).forEach(function (p) { if (p) body.appendChild(h('p', { class: 'sheet-text' }, p)); });
				var box = h('div', { class: 'sheet-actions stack' });
				choices.forEach(function (c) { box.appendChild(h('button', { class: 'btn ' + (c.cls || ''), type: 'button', onclick: function () { picked = c.value; close(); } }, c.label)); });
				body.appendChild(box);
			}, { cls: 'compact', onClose: function () { resolve(picked); } });
		});
	};
	// A text prompt. opts: {title, label, value, type, validate(v) -> error text or '', ok, hint, maxlength, autocomplete}. Resolves the text or null.
	ui.prompt = function (o) {
		return new Promise(function (resolve) {
			var result = null;
			sheet(o.title, function (body, close) {
				var input = h('input', { class: 'field wide', type: o.type || 'text', value: o.value || '', maxlength: o.maxlength || null, 'aria-label': o.label || o.title,
					autocomplete: o.autocomplete || 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
				var err = h('p', { class: 'form-error', role: 'alert', hidden: true });
				function submit() {
					var v = input.value, msg = o.validate ? o.validate(v) : '';
					if (msg) { err.textContent = msg; err.hidden = false; input.focus(); return; }
					result = v; close();
				}
				input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
				if (o.label) body.appendChild(h('label', { class: 'sheet-text' }, o.label));
				body.appendChild(input);
				if (o.hint) body.appendChild(h('p', { class: 'dim small' }, o.hint));
				body.appendChild(err);
				body.appendChild(h('div', { class: 'sheet-actions' },
					h('button', { class: 'btn', type: 'button', onclick: function () { close(); } }, t('Cancel')),
					h('button', { class: 'btn primary', type: 'button', onclick: submit }, o.ok || t('OK'))));
				setTimeout(function () { input.focus(); input.select(); }, 30);
			}, { cls: 'compact', onClose: function () { resolve(result); } });
		});
	};
	// A number sheet: a number input, OK and Cancel. Resolves an integer in range, or null.
	ui.numberSheet = function (o) {
		return new Promise(function (resolve) {
			var result = null;
			sheet(o.title, function (body, close) {
				var input = h('input', { class: 'field wide num', type: 'number', inputmode: 'numeric', min: o.min, max: o.max, step: '1', value: String(o.value), 'aria-label': o.title });
				function submit() {
					var v = parseInt(input.value, 10);
					result = dom.clamp(isNaN(v) ? o.min : v, o.min, o.max); close();
				}
				input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
				if (o.caption) body.appendChild(h('p', { class: 'sheet-text' }, o.caption));
				body.appendChild(input);
				body.appendChild(h('p', { class: 'dim small' }, t('From %d to %d', o.min, o.max)));
				body.appendChild(h('div', { class: 'sheet-actions' },
					h('button', { class: 'btn', type: 'button', onclick: function () { close(); } }, t('Cancel')),
					h('button', { class: 'btn primary', type: 'button', onclick: submit }, t('OK'))));
				setTimeout(function () { input.focus(); input.select(); }, 30);
			}, { cls: 'compact', onClose: function () { resolve(result); } });
		});
	};

	/* ---------- toast with Undo ---------- */

	// A toast shows for TOAST_MS (3 s). The timer pauses while the pointer is over the toast or a button in it has focus,
	// so the player can always reach Undo, and it restarts with the time that was left.
	var TOAST_MS = ui.TOAST_MS = 3000;
	var toastEl = null, toastT = null, toastUndo = null, toastHover = false, toastFocus = false;
	function toastSync() { if (!toastT) return; if (toastHover || toastFocus) toastT.pause(); else toastT.resume(); }
	ui.toast = function (text, undoFn, ms) {
		if (!toastEl) {
			toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
			toastEl.addEventListener('pointerenter', function () { toastHover = true; toastSync(); });
			toastEl.addEventListener('pointerleave', function () { toastHover = false; toastSync(); });
			toastEl.addEventListener('focusin', function () { toastFocus = true; toastSync(); });
			toastEl.addEventListener('focusout', function () { toastFocus = false; toastSync(); });
			document.body.appendChild(toastEl);
		}
		if (toastT) toastT.cancel();
		toastHover = false; toastFocus = false;
		clear(toastEl);
		toastUndo = undoFn || null;
		toastEl.appendChild(h('span', { class: 'toast-text' }, text));
		if (undoFn) toastEl.appendChild(h('button', { class: 'btn primary', type: 'button', onclick: function () { var f = toastUndo; ui.hideToast(); if (f) f(); } }, t('Undo')));
		toastEl.hidden = false;
		toastT = dom.pauseTimer(ui.hideToast, ms || TOAST_MS);
	};
	ui.hideToast = function () { if (toastEl) toastEl.hidden = true; toastUndo = null; if (toastT) { toastT.cancel(); toastT = null; } toastHover = false; toastFocus = false; };

	/* ---------- small widgets ---------- */

	// A progress bar. color: a CSS colour.
	ui.bar = function (label, text, frac, color) {
		return h('div', { class: 'bar-row' },
			h('div', { class: 'bar-head' }, h('span', { class: 'bar-label', style: color ? 'color:' + color : null }, label), h('span', { class: 'bar-num' }, text)),
			h('div', { class: 'bar', role: 'presentation' }, h('span', { style: 'width:' + Math.round(frac * 100) + '%;background:' + (color || 'var(--accent-text)') })));
	};
	// A row of small dots, one per variant: filled = owned.
	ui.pips = function (ids, have) {
		var e = h('span', { class: 'pips', 'aria-hidden': 'true' });
		ids.forEach(function (id, i) { e.appendChild(h('span', { class: 'pip' + (have[i] ? ' on' : ''), style: '--vc:' + vVar(id) })); });
		return e;
	};
	ui.tag = function (text, color) { return h('span', { class: 'tag', style: color ? '--tc:' + color : null }, text); };
	ui.emptyState = function (title, sub) { return h('div', { class: 'empty' }, h('h3', null, title), sub ? h('p', null, sub) : null); };
	// A stepper: [-] value [+]. Returns {el, setValue(text), setDisabled(minus, plus)}.
	ui.stepper = function (o) {
		var minus = h('button', { class: 'btn step', type: 'button', 'aria-label': o.minusLabel || '-', onclick: function () { o.onStep(-1); } }, ui.ico('minus'));
		var val = h('button', { class: 'btn val', type: 'button', onclick: function () { if (o.onValue) o.onValue(); } });
		var plus = h('button', { class: 'btn step', type: 'button', 'aria-label': o.plusLabel || '+', onclick: function () { o.onStep(1); } }, ui.ico('plus'));
		return { el: h('span', { class: 'stepper' }, minus, val, plus),
			set: function (text, dMinus, dPlus) { val.textContent = text; minus.disabled = !!dMinus; plus.disabled = !!dPlus; } };
	};

	ui.t = t; ui.hasKey = hasKey; ui.isBlank = isBlank; ui.slug = slug; ui.num = num; ui.plain = plain; ui.term = term;
	ui.rarityName = rarityName; ui.roleName = roleName; ui.tierName = tierName; ui.obtainName = obtainName; ui.rVar = rVar; ui.vVar = vVar;
	ui.h = h; ui.clear = clear; ui.tile = tile;
})();
