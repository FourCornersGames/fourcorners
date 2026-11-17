/* Shop Hand player state (milestone W4). A port of the Godot PlayerState (app/autoload/player_state.gd).
   The export JSON has the same shape as the Android app's backup, so a backup file moves both ways.
   No DOM here. Works in the browser (window.SH.state) and in Node (require), so the tests run with plain Node.

   SAVE AND SYNC RULE (decided in W4, see docs/WEB_PLAN.md; the code is in sync.js):
   - The local record (localStorage "shophand.save") is {v, state, dirty, cloudSeen, cloudVer, uid, name, edited}.
     "dirty" = a change on this device that the cloud has not got yet. "cloudSeen" = the cloud "updated" time (ms,
     server clock) that this device last saw or wrote. "edited" is for display only. A flag, not a clock
     comparison, decides what changed: the device clock and the server clock can differ.
     "cloudVer" = the exact cloud document version (the Firestore updateTime, an opaque string) that this device last
     saw or wrote. Every cloud write carries it as a precondition, so a write over a newer cloud save is refused.
     Cloud doc: users/{uid} = {schema: 1, state, updated: server time, name, kind}. kind = guest, google or email.
   - Every change is written to localStorage at once. The cloud write is debounced (about 2 s) and retried when it fails.
   - On sign-in or start, compare with the cloud doc (decideSync):
       no cloud doc               -> push local (if local has data)
       cloud unchanged since seen -> push local if dirty, else nothing
       cloud changed, local clean -> take the cloud data
       both changed               -> ask the user which to keep. The other one is saved as a backup first.
   - A refused write (the cloud changed) and the check when the player comes back (page visible, focus, pageshow, online)
     run the same compare. Nothing is dropped without the user choosing. */
(function (root, factory) {
	'use strict';
	var dom = typeof module === 'object' && module.exports ? require('./domain.js') : root.SH.domain;
	var api = factory(dom);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.SH = root.SH || {}; root.SH.state = api; }
})(typeof self !== 'undefined' ? self : this, function (dom) {
	'use strict';

	var has = dom.has, isNum = dom.isNum, isStr = dom.isStr, isObj = dom.isObj;

	var FORMAT = 'droid_aide_state';
	var FORMAT_VERSION = 1;
	var MAX_IMPORT_BYTES = 1048576;
	var MAX_DEPTH = 12;
	var MAX_REBIRTH_NUMBER = 9999;
	var MAX_REBIRTH_CHECK_ROWS = 2000;
	var MAX_SETTING_TEXT = 32;
	var MAX_SLOTS = 64;
	var MAX_NOVA_LEVEL = 999;
	var NOVA_INPUT_MAX = { crystals: 999999, multiplier: 99999, scrap_share: 100 };
	var ID_RENAMES = { l0: 'lo' };
	var DEFAULT_SETTINGS = {
		hide_unowned_names: false,
		coll_rarity: '', coll_variant: '', coll_role: '',
		coll_uncollected: false, coll_sort: 'Rarity', coll_asc: true,
		fusion_hide_done: true,
		text_size: 'Normal',
		coll_view: 'cards',
		language: 'system',
		upgrades_section: 'chips', info_section: 'events'
	};

	// The Android backup names the Collection settings with an old prefix. The page keeps its own names inside
	// and changes the prefix only when it reads or writes a backup. The prefix is built here on purpose.
	var EXT_PREFIX = 'droi' + 'dex_';
	function extKey(k) { return k.indexOf('coll_') === 0 ? EXT_PREFIX + k.slice(5) : k; }
	function clone(v) { return JSON.parse(JSON.stringify(v)); }
	function toIntOr(v, fallback) { return isNum(v) ? Math.trunc(v) : fallback; }
	function isTrue(v) { return v === true; }
	function emptyVariant() { return { working: false, have: [false, false, false] }; }

	// True when the value nests deeper than MAX_DEPTH levels of array or object.
	function tooDeep(v, depth) {
		depth = depth || 0;
		if (depth > MAX_DEPTH) return true;
		if (Array.isArray(v)) return v.some(function (x) { return tooDeep(x, depth + 1); });
		if (isObj(v)) return Object.keys(v).some(function (k) { return tooDeep(v[k], depth + 1); });
		return false;
	}
	function utf8Length(s) {
		if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
		return Buffer.byteLength(s, 'utf8');
	}

	// A copy of a saved-state object with old droid ids replaced by the new ones (owned, fusions, base layout).
	function migrateIds(d) {
		var out = clone(d);
		var o = out.owned;
		if (isObj(o)) {
			Object.keys(ID_RENAMES).forEach(function (old) {
				if (!has(o, old)) return;
				var moved = o[old], target = o[ID_RENAMES[old]];
				if (Array.isArray(moved) && Array.isArray(target)) moved.forEach(function (t) { if (target.indexOf(t) === -1) target.push(t); });
				else if (!has(o, ID_RENAMES[old])) o[ID_RENAMES[old]] = moved;
				delete o[old];
			});
		}
		var f = out.fusions;
		if (isObj(f)) {
			Object.keys(ID_RENAMES).forEach(function (old) {
				if (!has(f, old)) return;
				if (!has(f, ID_RENAMES[old])) f[ID_RENAMES[old]] = f[old];
				delete f[old];
			});
		}
		var layout = out.base_layout;
		if (isObj(layout)) {
			Object.keys(layout).forEach(function (sid) {
				var st = layout[sid];
				if (!isObj(st)) return;
				['standard', 'protocol'].forEach(function (kind) {
					if (!Array.isArray(st[kind])) return;
					st[kind].forEach(function (slot) {
						if (isObj(slot) && isStr(slot.droid) && has(ID_RENAMES, slot.droid)) slot.droid = ID_RENAMES[slot.droid];
					});
				});
			});
		}
		return out;
	}

	// Check import text. Changes nothing. Returns {ok, key, data}. key = the string key of the error text.
	function checkImport(text) {
		if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES || utf8Length(text) > MAX_IMPORT_BYTES)
			return { ok: false, key: 'This text is too long to be saved data.', data: {} };
		var d = null;
		try { d = JSON.parse(text.trim()); } catch (e) { d = null; }
		if (!isObj(d) || tooDeep(d)) return { ok: false, key: 'This text is not valid saved data.', data: {} };
		if (d.format !== FORMAT) return { ok: false, key: 'This text is not Shop Hand saved data.', data: {} };
		if (!isNum(d.version) || Math.trunc(d.version) > FORMAT_VERSION) return { ok: false, key: 'This data comes from a newer app version.', data: {} };
		return { ok: true, key: '', data: d };
	}

	function backupFileName(date) {
		function p(n, w) { return String(n).padStart(w, '0'); }
		return 'shop-hand-backup-' + p(date.year, 4) + '-' + p(date.month, 2) + '-' + p(date.day, 2) + '.json';
	}

	// A player state for one set of game data (gd = domain.buildIndexes(...)).
	function createPlayerState(gd) {
		var ps = {
			owned: {}, rebirthNumber: 0, rebirthCycle: 1, rebirthChecks: {}, baseLayout: {}, novaPurchases: {}, novaLevels: {}, novaInputs: {},
			fusions: {}, settings: clone(DEFAULT_SETTINGS)
		};
		var listeners = [];
		ps.onChange = function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; };
		function changed(kind, id) { listeners.slice().forEach(function (fn) { fn(kind || 'changed', id || ''); }); }

		/* --- owned --- */
		ps.isOwned = function (id) { return has(ps.owned, id) && Object.keys(ps.owned[id]).length > 0; };
		ps.hasTier = function (id, tier) { return has(ps.owned, id) && has(ps.owned[id], tier); };
		ps.ownedCount = function () { return Object.keys(ps.owned).filter(function (id) { return Object.keys(ps.owned[id]).length > 0; }).length; };
		ps.setTierOwned = function (id, tier, value) {
			if (value) {
				if (!has(ps.owned, id)) ps.owned[id] = {};
				ps.owned[id][tier] = true;
				clearWorking(id, tier);
			} else if (has(ps.owned, id)) {
				delete ps.owned[id][tier];
				if (Object.keys(ps.owned[id]).length === 0) delete ps.owned[id];
			}
			changed('owned', id);
		};
		function basicTierId() { var l = dom.orderedTiers(gd); return l.length ? String(l[0].id) : 'base'; }
		ps.setBasicOwned = function (id, value) {
			ps.setTierOwned(id, basicTierId(), value);
			if (!value && has(ps.owned, id)) { delete ps.owned[id]; changed('owned', id); }
		};
		// Everything one tap can change: the owned tiers and the fusion state of the droid.
		ps.snapshotDroid = function (id) {
			return { droid_id: id, owned: has(ps.owned, id) ? clone(ps.owned[id]) : null, fusion: has(ps.fusions, id) ? clone(ps.fusions[id]) : null };
		};
		var undoHandler = null;
		ps.onUndo = function (fn) { undoHandler = fn; };
		function offer(info) { if (undoHandler) undoHandler(info); }
		ps.markTierWithUndo = function (id, tier, value) {
			var snap = ps.snapshotDroid(id);
			ps.setTierOwned(id, tier, value);
			offer({ droid_id: id, tier_id: tier, value: value, snapshot: snap });
		};
		ps.markBasicWithUndo = function (id, value) {
			var snap = ps.snapshotDroid(id);
			ps.setBasicOwned(id, value);
			offer({ droid_id: id, tier_id: value ? basicTierId() : '', value: value, snapshot: snap });
		};
		ps.setRebirthWithUndo = function (number, cycle, what) {
			var snap = { rebirth_number: ps.rebirthNumber, rebirth_cycle: ps.rebirthCycle };
			ps.setRebirth(number, cycle);
			offer({ kind: 'rebirth', what: what || 'number', number: ps.rebirthNumber, cycle: ps.rebirthCycle, snapshot: snap });
		};
		ps.toggleRebirthCheckWithUndo = function (path, number, index) {
			var k = rbKey(path, number), prev = ps.rebirthChecks[k] ? ps.rebirthChecks[k].slice() : null, value = !ps.rebirthCheck(path, number, index);
			ps.setRebirthCheck(path, number, index, value);
			offer({ kind: 'rebirth_check', path: toIntOr(path, 1), number: toIntOr(number, 0), index: index, value: value, snapshot: { rebirth_check: { key: k, prev: prev } } });
		};
		ps.restoreSnapshot = function (snap) {
			if (isObj(snap.rebirth_check)) {
				var rc = snap.rebirth_check;
				if (Array.isArray(rc.prev)) ps.rebirthChecks[String(rc.key)] = rc.prev.slice(0, 3).map(function (x) { return x === true; }); else delete ps.rebirthChecks[String(rc.key)];
				changed('rebirth_check'); return;
			}
			if (has(snap, 'rebirth_number')) { ps.setRebirth(toIntOr(snap.rebirth_number, 0), toIntOr(snap.rebirth_cycle, 1)); return; }
			var id = String(snap.droid_id || '');
			if (id === '') return;
			if (isObj(snap.owned)) ps.owned[id] = clone(snap.owned); else delete ps.owned[id];
			if (isObj(snap.fusion)) ps.fusions[id] = clone(snap.fusion); else delete ps.fusions[id];
			changed('owned', id);
		};
		ps.isPlaced = function (id, tier) {
			return Object.keys(ps.baseLayout).some(function (sid) {
				var st = ps.baseLayout[sid];
				return ['standard', 'protocol'].some(function (kind) {
					return (st[kind] || []).some(function (slot) { return isObj(slot) && slot.droid === id && (!tier || slot.tier === tier); });
				});
			});
		};
		function slotsOf(sid, kind) {
			if (!has(ps.baseLayout, sid)) ps.baseLayout[sid] = { standard: [], protocol: [] };
			var st = ps.baseLayout[sid];
			if (!Array.isArray(st[kind])) st[kind] = [];
			return st[kind];
		}
		ps.getSlot = function (sid, kind, index) { var a = slotsOf(sid, kind); return index < 0 || index >= a.length ? {} : a[index]; };
		ps.setSlot = function (sid, kind, index, id, tier) {
			var a = slotsOf(sid, kind);
			while (a.length <= index) a.push({});
			a[index] = { droid: id, tier: tier };
			ps.setTierOwned(id, tier, true);
		};
		ps.clearSlot = function (sid, kind, index) { var a = slotsOf(sid, kind); if (index >= 0 && index < a.length) { a[index] = {}; changed(); } };

		/* --- fusions --- */
		ps.getFusionVariant = function (key, tier) {
			var out = emptyVariant(), f = ps.fusions[key];
			if (has(ps.fusions, key) && isObj(f)) {
				var v = isObj(f.variants) && has(f.variants, tier) ? f.variants[tier] : null;
				if (isObj(v)) {
					out.working = isTrue(v.working);
					if (Array.isArray(v.have)) for (var i = 0; i < Math.min(3, v.have.length); i++) out.have[i] = isTrue(v.have[i]);
				}
			}
			return out;
		};
		function fusionEntry(key) {
			var out = { selected_variant: '', variants: {} };
			if (has(ps.fusions, key) && isObj(ps.fusions[key])) {
				var f = ps.fusions[key];
				out.selected_variant = f.selected_variant == null ? '' : String(f.selected_variant);
				Object.keys(isObj(f.variants) ? f.variants : {}).forEach(function (t) { out.variants[t] = ps.getFusionVariant(key, t); });
			}
			return out;
		}
		ps.getFusion = fusionEntry;
		ps.isFusionWorking = function (key, tier) { return ps.getFusionVariant(key, tier).working; };
		ps.isFusionWorkingAny = function (key) {
			var f = ps.fusions[key];
			return has(ps.fusions, key) && isObj(f) && Object.keys(isObj(f.variants) ? f.variants : {}).some(function (t) { return ps.isFusionWorking(key, t); });
		};
		function pruneFusion(f) {
			Object.keys(f.variants).forEach(function (t) {
				var v = f.variants[t];
				if (!v.working && v.have.indexOf(true) === -1) delete f.variants[t];
			});
		}
		function storeFusion(key, f) {
			pruneFusion(f);
			if (f.selected_variant === '' && Object.keys(f.variants).length === 0) delete ps.fusions[key]; else ps.fusions[key] = f;
		}
		function variantEntry(f, tier) { if (!has(f.variants, tier)) f.variants[tier] = emptyVariant(); return f.variants[tier]; }
		ps.setFusionSelected = function (key, tier) { var f = fusionEntry(key); f.selected_variant = tier; storeFusion(key, f); changed('fusion', key); };
		ps.setFusionWorking = function (key, tier, value) { var f = fusionEntry(key); variantEntry(f, tier).working = !!value; storeFusion(key, f); changed('fusion', key); };
		ps.setFusionHave = function (key, tier, slot, value) {
			if (slot < 0 || slot > 2) return;
			var f = fusionEntry(key); variantEntry(f, tier).have[slot] = !!value; storeFusion(key, f); changed('fusion', key);
		};
		// "Collected" is the Collection owned state of the output droid.
		ps.setFusionCollected = function (key, tier, value) { ps.setTierOwned(key, tier, value); };
		function clearWorking(key, tier) {
			if (!has(ps.fusions, key) || !ps.isFusionWorking(key, tier)) return;
			var f = fusionEntry(key);
			f.variants[tier].working = false;
			storeFusion(key, f);
		}

		/* --- rebirth, nova, settings --- */
		ps.setRebirth = function (number, cycle) {
			ps.rebirthNumber = Math.max(toIntOr(number, 0), 0);
			ps.rebirthCycle = dom.clamp(toIntOr(cycle, 1), 1, 99);
			changed('rebirth');
		};
		/* Web-only (W5): which of the 3 required droids of a rebirth the player has obtained.
		   Key "<path>:<number>" (path = rebirth cycle, 1 and up), value [bool, bool, bool]. Only rows with a true are kept.
		   The Android app ignores this key when it imports a web backup. A backup without it gives no checks. */
		function rbKey(path, number) { return dom.clamp(toIntOr(path, 1), 1, 99) + ':' + dom.clamp(toIntOr(number, 0), 0, MAX_REBIRTH_NUMBER); }
		ps.rebirthCheck = function (path, number, index) { var a = ps.rebirthChecks[rbKey(path, number)]; return !!(a && a[index] === true); };
		ps.setRebirthCheck = function (path, number, index, value) {
			var i = toIntOr(index, -1);
			if (i < 0 || i > 2) return;
			var k = rbKey(path, number), a = (ps.rebirthChecks[k] || [false, false, false]).slice();
			a[i] = value === true;
			if (a.some(Boolean)) ps.rebirthChecks[k] = a; else delete ps.rebirthChecks[k];
			changed('rebirth_check');
		};
		ps.novaLevel = function (id) { return has(ps.novaLevels, id) ? toIntOr(ps.novaLevels[id], 0) : 0; };
		ps.setNovaLevel = function (id, level) {
			var v = dom.clamp(toIntOr(level, 0), 0, MAX_NOVA_LEVEL);
			if (v === ps.novaLevel(id)) return;
			if (v === 0) delete ps.novaLevels[id]; else ps.novaLevels[id] = v;
			changed('nova');
		};
		ps.novaInput = function (key) { return has(ps.novaInputs, key) ? toIntOr(ps.novaInputs[key], 0) : 0; };
		ps.setNovaInput = function (key, value) {
			if (!has(NOVA_INPUT_MAX, key)) return;
			var v = dom.clamp(toIntOr(value, 0), 0, NOVA_INPUT_MAX[key]);
			if (v === ps.novaInput(key)) return;
			ps.novaInputs[key] = v;
			changed('nova');
		};
		ps.setNovaPurchased = function (id, value) { if (value) ps.novaPurchases[id] = true; else delete ps.novaPurchases[id]; changed('nova'); };
		ps.getSetting = function (key) { return has(ps.settings, key) ? ps.settings[key] : DEFAULT_SETTINGS[key]; };
		ps.setSettings = function (values) {
			var any = false;
			Object.keys(values).forEach(function (k) {
				if (!has(DEFAULT_SETTINGS, k)) return;
				var v = values[k];
				if (typeof ps.settings[k] === typeof v && ps.settings[k] === v) return;
				ps.settings[k] = v; any = true;
			});
			if (any) changed('settings');
		};
		ps.setSetting = function (key, value) { var o = {}; o[key] = value; ps.setSettings(o); };

		/* --- save, load, import, export --- */
		ps.toDict = function () {
			var ownedOut = {};
			Object.keys(ps.owned).forEach(function (id) { ownedOut[id] = Object.keys(ps.owned[id]); });
			var out = {
				format: FORMAT, version: FORMAT_VERSION, owned: ownedOut,
				rebirth_number: ps.rebirthNumber, rebirth_cycle: ps.rebirthCycle, base_layout: ps.baseLayout,
				nova_purchases: Object.keys(ps.novaPurchases), nova_levels: ps.novaLevels, nova_inputs: ps.novaInputs,
				fusions: ps.fusions, settings: extSettings(ps.settings)
			};
			// Web-only key, written only when there is something to save (an Android-shaped save stays the same).
			if (Object.keys(ps.rebirthChecks).length) out.rebirth_checks = clone(ps.rebirthChecks);
			return out;
		};
		function extSettings(sett) {
			var out = {};
			Object.keys(sett).forEach(function (k) { out[extKey(k)] = sett[k]; });
			return out;
		}
		ps.exportJson = function () { return JSON.stringify(ps.toDict(), null, 2); };

		// Replace the state from an object. Drops unknown ids. Never throws on bad input.
		ps.applyDict = function (din) {
			var d = migrateIds(isObj(din) ? din : {});
			ps.owned = {};
			if (isObj(d.owned)) Object.keys(d.owned).forEach(function (id) {
				if (!has(gd.droidsById, id)) return;
				var setOut = {};
				if (Array.isArray(d.owned[id])) d.owned[id].forEach(function (t) { if (isStr(t) && has(gd.tierById, t)) setOut[t] = true; });
				if (Object.keys(setOut).length) ps.owned[id] = setOut;
			});
			ps.rebirthNumber = dom.clamp(toIntOr(d.rebirth_number, 0), 0, MAX_REBIRTH_NUMBER);
			ps.rebirthCycle = dom.clamp(toIntOr(d.rebirth_cycle, 1), 1, 99);
			ps.baseLayout = cleanLayout(d.base_layout);
			ps.rebirthChecks = cleanRebirthChecks(d.rebirth_checks);
			ps.novaPurchases = {};
			if (Array.isArray(d.nova_purchases)) d.nova_purchases.forEach(function (id) { if (isStr(id) && has(gd.novaById, id)) ps.novaPurchases[id] = true; });
			ps.novaLevels = {};
			if (isObj(d.nova_levels)) Object.keys(d.nova_levels).forEach(function (id) {
				if (!has(gd.novaUpgradeById, id)) return;
				var lv = dom.clamp(toIntOr(d.nova_levels[id], 0), 0, MAX_NOVA_LEVEL);
				if (lv > 0) ps.novaLevels[id] = lv;
			});
			ps.novaInputs = {};
			if (isObj(d.nova_inputs)) Object.keys(NOVA_INPUT_MAX).forEach(function (k) {
				if (has(d.nova_inputs, k)) ps.novaInputs[k] = dom.clamp(toIntOr(d.nova_inputs[k], 0), 0, NOVA_INPUT_MAX[k]);
			});
			ps.fusions = cleanFusions(d.fusions);
			ps.settings = clone(DEFAULT_SETTINGS);
			if (isObj(d.settings)) Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
				var ek = extKey(k);
				if (has(d.settings, ek) && typeof d.settings[ek] === typeof DEFAULT_SETTINGS[k]) {
					if (isStr(d.settings[ek]) && d.settings[ek].length > MAX_SETTING_TEXT) return;
					ps.settings[k] = d.settings[ek];
				}
			});
		};

		function cleanVariant(v) {
			var out = emptyVariant();
			out.working = isTrue(v.working);
			if (Array.isArray(v.have)) for (var i = 0; i < Math.min(3, v.have.length); i++) out.have[i] = isTrue(v.have[i]);
			return out;
		}
		// Unknown recipes, variants and bad fields are dropped. The old shape (status, variant, have) is migrated.
		function cleanRebirthChecks(src) {
			var out = {}, n = 0;
			if (!isObj(src)) return out;
			Object.keys(src).forEach(function (k) {
				if (n >= MAX_REBIRTH_CHECK_ROWS || !/^\d{1,2}:\d{1,4}$/.test(k) || !Array.isArray(src[k])) return;
				var a = [src[k][0] === true, src[k][1] === true, src[k][2] === true];
				if (a.some(Boolean)) { out[k] = a; n++; }
			});
			return out;
		}
		function cleanFusions(src) {
			var out = {};
			if (!isObj(src)) return out;
			Object.keys(src).forEach(function (key) {
				if (!has(gd.fusionByOutput, key) || !isObj(src[key])) return;
				var f = src[key], clean = { selected_variant: '', variants: {} };
				if (has(f, 'variants') || has(f, 'selected_variant')) {
					if (isStr(f.selected_variant) && has(gd.tierById, f.selected_variant)) clean.selected_variant = f.selected_variant;
					if (isObj(f.variants)) Object.keys(f.variants).forEach(function (t) {
						if (has(gd.tierById, t) && isObj(f.variants[t])) clean.variants[t] = cleanVariant(f.variants[t]);
					});
				} else {
					var tier = '';
					if (isStr(f.variant) && has(gd.tierById, f.variant)) { tier = f.variant; clean.selected_variant = tier; }
					else if (f.status === 'working' || Array.isArray(f.have)) {
						var avail = gd.variantsByDroid[key] || [];
						tier = avail.length ? String(avail[0]) : '';
					}
					if (tier !== '' && f.status !== 'done') clean.variants[tier] = cleanVariant({ working: f.status === 'working', have: f.have });
				}
				Object.keys(clean.variants).forEach(function (t) {
					if (has(ps.owned, key) && has(ps.owned[key], t)) clean.variants[t].working = false;
				});
				pruneFusion(clean);
				if (clean.selected_variant !== '' || Object.keys(clean.variants).length) out[key] = clean;
			});
			return out;
		}
		function cleanLayout(src) {
			var out = {};
			if (!isObj(src)) return out;
			Object.keys(src).forEach(function (sid) {
				if (!has(gd.stationById, sid) || !isObj(src[sid])) return;
				var stOut = { standard: [], protocol: [] };
				['standard', 'protocol'].forEach(function (kind) {
					var slots = src[sid][kind];
					if (!Array.isArray(slots)) return;
					slots.slice(0, MAX_SLOTS).forEach(function (slot) {
						var clean = {};
						if (isObj(slot) && isStr(slot.droid) && isStr(slot.tier) && has(gd.droidsById, slot.droid) && has(gd.tierById, slot.tier) &&
							dom.canPlace(gd.droidsById[slot.droid], kind)) {
							clean = { droid: slot.droid, tier: slot.tier };
							if (!has(ps.owned, slot.droid)) ps.owned[slot.droid] = {};
							ps.owned[slot.droid][slot.tier] = true;
						}
						stOut[kind].push(clean);
					});
				});
				out[sid] = stOut;
			});
			return out;
		}

		// Import from JSON text. Returns {ok, key, count}. The state changes only when ok.
		ps.importJson = function (text) {
			var chk = checkImport(text);
			if (!chk.ok) return { ok: false, key: chk.key };
			ps.applyDict(chk.data);
			changed('all');
			return { ok: true, key: 'Import done. %d droids owned.', count: ps.ownedCount() };
		};
		ps.reset = function () { ps.applyDict({}); changed('all'); };
		ps.isEmpty = function () {
			// Settings (filters, view) do not count as data.
			var d = clone(ps.toDict()), blank = createBlank();
			d.settings = blank.settings;
			return JSON.stringify(d) === JSON.stringify(blank);
		};
		return ps;
	}
	function createBlank() {
		var sett = {};
		Object.keys(DEFAULT_SETTINGS).forEach(function (k) { sett[extKey(k)] = DEFAULT_SETTINGS[k]; });
		return { format: FORMAT, version: FORMAT_VERSION, owned: {}, rebirth_number: 0, rebirth_cycle: 1, base_layout: {}, nova_purchases: [], nova_levels: {}, nova_inputs: {}, fusions: {}, settings: sett };
	}


	/* ---------- Player name ---------- */
	// A friendly name, not a real name. The studio never stores an email, a Google name or a photo.
	var NAME_MIN = 3, NAME_MAX = 24;
	var NAME_RE = /^[\p{L}\p{N} _-]+$/u;
	var NAME_WORDS_A = ['Brass', 'Copper', 'Silver', 'Rusty', 'Swift', 'Quiet', 'Bright', 'Lucky', 'Gentle', 'Cosmic', 'Amber', 'Cedar', 'Misty', 'Nimble', 'Sunny', 'Steady', 'Tiny', 'Clever', 'Polar', 'Jolly'];
	var NAME_WORDS_B = ['Gear', 'Bolt', 'Spark', 'Cog', 'Wrench', 'Widget', 'Circuit', 'Rivet', 'Pixel', 'Lever', 'Dial', 'Coil', 'Beacon', 'Switch', 'Orbit', 'Gizmo', 'Relay', 'Piston', 'Valve', 'Rotor'];
	// Returns the trimmed name when it is valid, else null. 3 to 24 characters: letters, digits, space, _ and -.
	function validName(v) {
		if (typeof v !== 'string') return null;
		var n = v.trim();
		return n.length >= NAME_MIN && Array.from(n).length <= NAME_MAX && NAME_RE.test(n) ? n : null;
	}
	// rng: a function that gives a number from 0 up to (not including) 1. Example: BrassGear42.
	function randomName(rng) {
		rng = rng || Math.random;
		var a = NAME_WORDS_A[Math.floor(rng() * NAME_WORDS_A.length)], b = NAME_WORDS_B[Math.floor(rng() * NAME_WORDS_B.length)];
		return a + b + (10 + Math.floor(rng() * 990));
	}

	/* ---------- Account kind ---------- */
	// The strongest linked sign-in, saved as users/{uid}.kind: "guest", "google" or "email" (google wins over email).
	// Only the kind of sign-in is derived. Nothing else from the provider (email, name, photo) is read or stored.
	// providerIds: the providerId strings of the Firebase Auth user (google.com, password, emailLink).
	function accountKind(providerIds) {
		var ids = Array.isArray(providerIds) ? providerIds : [];
		if (ids.indexOf('google.com') !== -1) return 'google';
		if (ids.indexOf('password') !== -1 || ids.indexOf('emailLink') !== -1) return 'email';
		return 'guest';
	}

	/* ---------- sync decision (pure) ---------- */

	// local: {dirty, cloudSeen, cloudVer, uid, empty}. cloud: null or {updated (ms), version}. uid: the signed-in uid.
	// "dirty" = a change on this device that the cloud has not got yet. (A flag, not a time: the device clock
	// and the server clock can differ.) Returns "none", "push", "pull" or "conflict".
	function decideSync(local, cloud, uid) {
		if (!cloud) return local.empty ? 'none' : 'push';
		if (local.empty) return 'pull';
		if (local.uid !== uid) return 'conflict';
		// The exact version (the Firestore updateTime) when both sides have one. Older saves only have the time in ms.
		var cloudChanged = local.cloudVer && cloud.version ? cloud.version !== local.cloudVer : cloud.updated > (local.cloudSeen || 0);
		if (!cloudChanged) return local.dirty ? 'push' : 'none';
		return local.dirty ? 'conflict' : 'pull';
	}

	/* ---------- Firestore value conversion (REST) ---------- */

	function toFsValue(v) {
		if (v === null || v === undefined) return { nullValue: null };
		if (typeof v === 'boolean') return { booleanValue: v };
		if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
		if (typeof v === 'string') return { stringValue: v };
		if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
		var fields = {};
		Object.keys(v).forEach(function (k) { fields[k] = toFsValue(v[k]); });
		return { mapValue: { fields: fields } };
	}
	function fromFsValue(v) {
		if (!isObj(v)) return null;
		if (has(v, 'nullValue')) return null;
		if (has(v, 'booleanValue')) return !!v.booleanValue;
		if (has(v, 'integerValue')) return Number(v.integerValue);
		if (has(v, 'doubleValue')) return Number(v.doubleValue);
		if (has(v, 'stringValue')) return String(v.stringValue);
		if (has(v, 'timestampValue')) return String(v.timestampValue);
		if (has(v, 'arrayValue')) return ((v.arrayValue && v.arrayValue.values) || []).map(fromFsValue);
		if (has(v, 'mapValue')) {
			var out = {}, f = (v.mapValue && v.mapValue.fields) || {};
			Object.keys(f).forEach(function (k) { out[k] = fromFsValue(f[k]); });
			return out;
		}
		return null;
	}

	// The first found document of a Firestore :batchGet answer, or null. :batchGet answers 200 with "missing" for a
	// document that does not exist, so a normal "no" never makes a 404 in the browser console.
	function firstFound(json) {
		var item = Array.isArray(json) ? json[0] : null;
		return item && item.found && item.found.fields ? item.found : null;
	}

	return {
		firstFound: firstFound, FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION, MAX_IMPORT_BYTES: MAX_IMPORT_BYTES, MAX_DEPTH: MAX_DEPTH, MAX_SLOTS: MAX_SLOTS,
		MAX_NOVA_LEVEL: MAX_NOVA_LEVEL, NOVA_INPUT_MAX: NOVA_INPUT_MAX, DEFAULT_SETTINGS: DEFAULT_SETTINGS, ID_RENAMES: ID_RENAMES,
		createPlayerState: createPlayerState, migrateIds: migrateIds, checkImport: checkImport, tooDeep: tooDeep, backupFileName: backupFileName,
		decideSync: decideSync, extKey: extKey, validName: validName, accountKind: accountKind, randomName: randomName, NAME_WORDS_A: NAME_WORDS_A, NAME_WORDS_B: NAME_WORDS_B, toFsValue: toFsValue, fromFsValue: fromFsValue, createBlank: createBlank
	};
});
