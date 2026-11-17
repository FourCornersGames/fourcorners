/* Shop Hand rules (milestone W4). Pure functions, no DOM, no clock, no network.
   A port of the Godot app's domain/ folder (app/domain/*.gd in the app repo).
   Works in the browser (window.SH.domain) and in Node (require), so the tests run with plain Node. */
(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.SH = root.SH || {}; root.SH.domain = api; }
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	/* ---------- small helpers ---------- */

	function has(o, k) { return o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
	function isNum(v) { return typeof v === 'number' && isFinite(v); }
	function isStr(v) { return typeof v === 'string'; }
	function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
	function str(v) { return v == null ? '' : String(v); }
	function toInt(v) { return Math.trunc(Number(v)) || 0; }
	function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

	// printf for %s, %d and %.Nf (the placeholders the app strings use). Missing arguments give "".
	function sprintf(fmt) {
		var args = arguments, i = 1;
		return String(fmt).replace(/%(?:\.(\d+))?([sdf%])/g, function (m, prec, kind) {
			if (kind === '%') return '%';
			var v = args[i++];
			if (v == null) return '';
			if (kind === 'd') return String(Math.trunc(Number(v)));
			if (kind === 'f') return Number(v).toFixed(prec == null ? 6 : Number(prec));
			return String(v);
		});
	}

	// A translator for tests and for callers that pass none: the key is the text.
	var identityTr = { t: function (k) { return k; }, f: function (k) { return sprintf.apply(null, arguments); } };

	// Godot's naturalnocasecmp_to: case-insensitive, runs of digits compare as numbers. Returns -1, 0 or 1.
	function naturalCmp(a, b) {
		var x = str(a).toLowerCase(), y = str(b).toLowerCase();
		var i = 0, j = 0;
		while (i < x.length && j < y.length) {
			var cx = x.charAt(i), cy = y.charAt(j);
			var dx = cx >= '0' && cx <= '9', dy = cy >= '0' && cy <= '9';
			if (dx && dy) {
				var ei = i, ej = j;
				while (ei < x.length && x.charAt(ei) >= '0' && x.charAt(ei) <= '9') ei++;
				while (ej < y.length && y.charAt(ej) >= '0' && y.charAt(ej) <= '9') ej++;
				var nx = x.slice(i, ei).replace(/^0+/, ''), ny = y.slice(j, ej).replace(/^0+/, '');
				if (nx.length !== ny.length) return nx.length < ny.length ? -1 : 1;
				if (nx !== ny) return nx < ny ? -1 : 1;
				i = ei; j = ej;
			} else {
				if (cx !== cy) return cx < cy ? -1 : 1;
				i++; j++;
			}
		}
		if (i < x.length) return 1;
		if (j < y.length) return -1;
		return 0;
	}

	/* ---------- NumFmt ---------- */

	var SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
	function trimNum(x) {
		var s = x.toFixed(2);
		if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
		return s;
	}
	// 1500 -> "1.5K". opts: {lang: 'en'|'fr', unknown: text}. Not a number -> the unknown text.
	function formatNumber(n, opts) {
		var unknown = (opts && opts.unknown) || 'unknown';
		var fr = !!(opts && opts.lang === 'fr');
		if (!isNum(n)) return unknown;
		var neg = n < 0, a = Math.abs(n), idx = 0;
		while (a >= 1000 && idx < SUFFIXES.length - 1) { a /= 1000; idx++; }
		a = Math.round(a * 100) / 100;
		if (a >= 1000 && idx < SUFFIXES.length - 1) { a /= 1000; idx++; }
		var s = trimNum(a);
		if (fr) s = s.replace('.', ',');
		return (neg ? '-' : '') + s + SUFFIXES[idx];
	}
	// 150000 -> "150,000" (French: a space).
	function formatExact(n, opts) {
		var unknown = (opts && opts.unknown) || 'unknown';
		var fr = !!(opts && opts.lang === 'fr');
		if (!isNum(n)) return unknown;
		var neg = n < 0, a = Math.abs(n), whole = Math.floor(a), frac = a - whole;
		var digits = String(whole), out = '';
		for (var i = digits.length - 1, c = 0; i >= 0; i--) {
			out = digits.charAt(i) + out; c++;
			if (c % 3 === 0 && i > 0) out = (fr ? ' ' : ',') + out;
		}
		if (frac >= 0.005) {
			var f = trimNum(Math.round(frac * 100) / 100);
			if (f.indexOf('0.') === 0) out += (fr ? ',' : '.') + f.slice(2);
		}
		return (neg ? '-' : '') + out;
	}

	/* ---------- GameData indexes ---------- */

	function rowsOf(d, key) {
		var out = [], v = d && d[key];
		if (Array.isArray(v)) v.forEach(function (r) { if (isObj(r)) out.push(r); });
		return out;
	}
	function indexBy(rows, key) {
		var out = Object.create(null);
		rows.forEach(function (r) { var k = r[key]; if (isStr(k) && k !== '') out[k] = r; });
		return out;
	}
	function orderOf(row) { return isNum(row && row.order) ? row.order : 9999; }

	// Build every lookup the screens need from the parsed gamedata.json.
	function buildIndexes(d) {
		var gd = { raw: d || {} };
		gd.droids = rowsOf(d, 'droids');
		gd.droids.forEach(function (x, i) { x._order = i; });
		gd.droidsById = indexBy(gd.droids, 'id');
		gd.tiers = rowsOf(d, 'tiers').sort(function (a, b) { return orderOf(a) - orderOf(b); });
		gd.tierById = indexBy(gd.tiers, 'id');
		gd.rarities = rowsOf(d, 'rarities').sort(function (a, b) { return orderOf(a) - orderOf(b); });
		gd.rarityById = indexBy(gd.rarities, 'id');
		gd.stations = rowsOf(d, 'stations');
		gd.stationById = indexBy(gd.stations, 'id');
		gd.incomeByKey = Object.create(null);
		rowsOf(d, 'droid_income').forEach(function (r) {
			if (isStr(r.droid_id) && isStr(r.tier_id)) gd.incomeByKey[incomeKey(r.droid_id, r.tier_id)] = r;
		});
		gd.upgradeByKey = Object.create(null);
		rowsOf(d, 'upgrade_costs').forEach(function (r) {
			if (isStr(r.rarity) && isStr(r.from_tier)) gd.upgradeByKey[incomeKey(r.rarity, r.from_tier)] = r;
		});
		gd.rebirthsByKey = Object.create(null);
		rowsOf(d, 'rebirths').forEach(function (r) {
			var cycle = parseInt(str(r.path === undefined ? '0' : r.path), 10) || 0;
			if (isNum(r.rebirth_number)) gd.rebirthsByKey[cycle + '|' + Math.trunc(r.rebirth_number)] = r;
		});
		gd.fusionList = rowsOf(d, 'fusion_recipes');
		gd.fusionByOutput = indexBy(gd.fusionList, 'output_droid_id');
		gd.variantsByDroid = buildVariants(gd.droids, gd.tiers, gd.incomeByKey);
		gd.chipCosts = chipCostsFromRows(rowsOf(d, 'upgrade_costs'));
		gd.novaItems = rowsOf(d, 'nova_shop');
		gd.novaById = indexBy(gd.novaItems, 'id');
		gd.missions = rowsOf(d, 'missions');
		gd.events = rowsOf(d, 'events');
		gd.eventSchedule = rowsOf(d, 'event_schedule');
		gd.novaUpgrades = rowsOf(d, 'nova_upgrades');
		gd.novaUpgradeById = indexBy(gd.novaUpgrades, 'id');
		gd.traits = rowsOf(d, 'traits');
		return gd;
	}
	function isUsableData(d) {
		return isObj(d) && isNum(d.schema_version) && d.schema_version >= 1 && d.schema_version <= 1;
	}
	function orderedTiers(gd) { return gd.tiers.filter(function (t) { return isNum(t.order); }); }
	function variantsOf(gd, id) { return gd.variantsByDroid[id] || []; }
	function rarityOrders(gd) { var o = {}; gd.rarities.forEach(function (r) { o[r.id] = orderOf(r); }); return o; }
	function cycles(gd) {
		var seen = {};
		Object.keys(gd.rebirthsByKey).forEach(function (k) { seen[parseInt(k.split('|')[0], 10)] = true; });
		return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
	}
	function rebirthRow(gd, cycle, level) { return gd.rebirthsByKey[cycle + '|' + level] || null; }
	function maxRebirth(gd, path) {
		var n = 0;
		Object.keys(gd.rebirthsByKey).forEach(function (k) {
			var p = k.split('|');
			if (parseInt(p[0], 10) === path) n = Math.max(n, parseInt(p[1], 10));
		});
		return n;
	}
	function hasChipData(gd, rarity) {
		return Object.keys(gd.upgradeByKey).some(function (k) { return k.indexOf(rarity + '|') === 0; });
	}
	function upgradeChips(gd, rarity, fromTier) {
		var row = gd.upgradeByKey[incomeKey(rarity, fromTier)];
		return row && isNum(row.chips) ? row.chips : null;
	}
	// Chips to reach this variant from the one below it on the chip ladder. null when unknown or no step.
	function chipsToReach(gd, rarity, tier) {
		var prev = prevOnLadder(tier);
		return prev === '' ? null : upgradeChips(gd, rarity, prev);
	}

	/* ---------- IncomeRules ---------- */

	function incomeKey(droidId, tierId) { return droidId + '|' + tierId; }
	function incomeFor(droidId, tierId, incomeByKey, droidsById) {
		var row = incomeByKey[incomeKey(droidId, tierId)];
		if (row && isNum(row.income_per_sec)) return row.income_per_sec;
		if (tierId === 'base') {
			var d = droidsById[droidId];
			if (d && isNum(d.base_income_per_sec)) return d.base_income_per_sec;
		}
		return null;
	}
	function costFor(droidId, tierId, incomeByKey, droidsById) {
		var row = incomeByKey[incomeKey(droidId, tierId)];
		if (row && isNum(row.buy_cost)) return row.buy_cost;
		if (tierId === 'base') {
			var d = droidsById[droidId];
			if (d && isNum(d.buy_cost)) return d.buy_cost;
		}
		return null;
	}

	/* ---------- SlotRules ---------- */

	var ROLE_STATION = { Worker: 'worker', Astromech: 'astro', Battle: 'battle' };
	function asInt(v) { return isNum(v) ? Math.trunc(v) : 0; }
	function effectiveSlots(station, novaItems, purchases) {
		var total = asInt(station && station.standard_slots), sid = station && station.id;
		(novaItems || []).forEach(function (item) {
			if (!isObj(item) || item.effect_type !== 'add_slot' || item.effect_target !== sid) return;
			if (!purchases || !purchases[item.id]) return;
			total += asInt(item.effect_value);
		});
		return Math.max(total, 0);
	}
	function protocolSlots(station) { return Math.max(asInt(station && station.protocol_slots), 0); }
	function canPlace(droid, kind) {
		var isProtocol = !!droid && droid.role === 'Protocol';
		if (kind === 'protocol') return isProtocol;
		if (kind === 'standard') return !isProtocol;
		return false;
	}
	function specialistBonusApplies(droid, station) {
		var role = droid && droid.role;
		return has(ROLE_STATION, role) && ROLE_STATION[role] === (station && station.id);
	}

	/* ---------- RebirthRules ---------- */

	function requirementsFromRow(row) {
		var out = [];
		for (var i = 1; i <= 3; i++) {
			var id = row['droid' + i + '_id'];
			if (isStr(id) && id !== '') out.push({ droid_id: id, tier_id: row['droid' + i + '_tier'] === undefined ? null : row['droid' + i + '_tier'] });
		}
		return out;
	}
	function placedDroids(layout) {
		var out = [];
		Object.keys(layout || {}).forEach(function (sid) {
			var station = layout[sid];
			if (!isObj(station)) return;
			['standard', 'protocol'].forEach(function (kind) {
				var slots = station[kind];
				if (!Array.isArray(slots)) return;
				slots.forEach(function (slot) {
					if (isObj(slot) && isStr(slot.droid) && slot.droid !== '') out.push({ droid: slot.droid, tier: slot.tier === undefined ? null : slot.tier });
				});
			});
		});
		return out;
	}
	function rebirthStatus(requirements, layout, tiers, allowHigher) {
		if (allowHigher === undefined) allowHigher = true;
		var order = {};
		(tiers || []).forEach(function (t) { if (isObj(t) && isStr(t.id)) order[t.id] = t.order; });
		var placed = placedDroids(layout), result = [];
		(requirements || []).forEach(function (req) {
			if (!isObj(req)) return;
			var rid = req.droid_id, rtier = req.tier_id === undefined ? null : req.tier_id;
			var green = false, warning = false;
			for (var i = 0; i < placed.length; i++) {
				var p = placed[i];
				if (p.droid !== rid) continue;
				if (p.tier === rtier) { green = true; break; }
				if (rtier == null || p.tier == null) { warning = true; continue; }
				var po = order[p.tier], ro = order[rtier];
				if (!(isNum(po) && isNum(ro))) { warning = true; continue; }
				if (allowHigher && po >= ro) { green = true; break; }
			}
			result.push({ droid_id: rid, tier_id: rtier, status: green ? 'green' : 'red', warning: warning && !green });
		});
		return result;
	}
	// What to do with a required droid after this rebirth: upgrade at the nearest later rebirth that needs
	// it in a higher variant, or sell. rows: the rebirth rows of ONE path.
	function afterUse(rebirthNumber, droidId, tierId, rows, tierOrder) {
		var here = isStr(tierId) ? tierOrder[tierId] : undefined;
		if (!isNum(here)) return { action: 'sell' };
		var bestN = -1, bestTier = '';
		(rows || []).forEach(function (row) {
			if (!isObj(row)) return;
			var n = row.rebirth_number;
			if (!isNum(n) || Math.trunc(n) <= rebirthNumber) return;
			if (bestN !== -1 && Math.trunc(n) >= bestN) return;
			var reqs = requirementsFromRow(row);
			for (var i = 0; i < reqs.length; i++) {
				var req = reqs[i];
				if (req.droid_id !== droidId || !isStr(req.tier_id)) continue;
				var later = tierOrder[req.tier_id];
				if (isNum(later) && later > here) { bestN = Math.trunc(n); bestTier = req.tier_id; break; }
			}
		});
		return bestN === -1 ? { action: 'sell' } : { action: 'upgrade', tier_id: bestTier, rebirth: bestN };
	}
	function afterUseText(result, tierName, tr) {
		tr = tr || identityTr;
		if (result.action === 'upgrade') return tr.f('%s @ RB%d', tierName, toInt(result.rebirth));
		return tr.t('Sell');
	}
	function tierOrderMap(tiers) {
		var out = {};
		(tiers || []).forEach(function (t) { if (isObj(t) && isStr(t.id) && isNum(t.order)) out[t.id] = t.order; });
		return out;
	}

	/* ---------- UpgradeRules ---------- */

	var CHIP_LADDER = ['base', 'gold', 'diamond', 'rainbow', 'beskar', 'galactic', 'stellar', 'kyber'];
	var MAX_SUGGESTIONS = 3;
	var ICONIC = 'iconic';

	function nextOnLadder(tier) { var i = CHIP_LADDER.indexOf(tier); return (i < 0 || i + 1 >= CHIP_LADDER.length) ? '' : CHIP_LADDER[i + 1]; }
	function prevOnLadder(tier) { var i = CHIP_LADDER.indexOf(tier); return i <= 0 ? '' : CHIP_LADDER[i - 1]; }
	function ladderVariants(available) { return CHIP_LADDER.filter(function (t) { return available.indexOf(t) !== -1; }); }
	function chipCostKey(rarity, from, to) { return rarity + '|' + from + '|' + to; }
	function chipCostsFromRows(rows) {
		var out = Object.create(null);
		(rows || []).forEach(function (r) {
			if (isObj(r) && isStr(r.rarity) && isStr(r.from_tier) && isStr(r.to_tier) && isNum(r.chips)) out[chipCostKey(r.rarity, r.from_tier, r.to_tier)] = r.chips;
		});
		return out;
	}
	function pickStep(available, ownedTiers, rarity, chipCosts) {
		if (rarity === ICONIC) return {};
		var ladder = ladderVariants(available);
		for (var i = 0; i < ladder.length; i++) {
			var v = ladder[i];
			if (!has(ownedTiers, v)) continue;
			var nxt = nextOnLadder(v);
			if (nxt === '' || available.indexOf(nxt) === -1 || has(ownedTiers, nxt)) continue;
			var cost = chipCosts[chipCostKey(rarity, v, nxt)];
			if (isNum(cost)) return { from: v, to: nxt, cost: cost };
		}
		return {};
	}
	function emptyReason(droids, variantsByDroid, owned) {
		for (var i = 0; i < droids.length; i++) {
			var d = droids[i];
			if (!isObj(d) || !isStr(d.id) || d.rarity === ICONIC) continue;
			var have = owned[d.id] || {};
			var lv = ladderVariants(variantsByDroid[d.id] || []);
			for (var j = 0; j < lv.length; j++) if (has(have, lv[j])) return 'none_left';
		}
		return 'no_owned';
	}
	function upgradeBefore(x, y) {
		var lhs = x.missing * y.available, rhs = y.missing * x.available;
		if (lhs !== rhs) return lhs > rhs;
		var cx = x.cost, cy = y.cost;
		if (cx !== cy) {
			if (cx == null) return false;
			if (cy == null) return true;
			return cx < cy;
		}
		if (x.rarity_order !== y.rarity_order) return x.rarity_order < y.rarity_order;
		var c = naturalCmp(x.name, y.name);
		if (c !== 0) return c < 0;
		return str(x.droid_id) < str(y.droid_id);
	}
	function suggest(droids, variantsByDroid, owned, rarityOrdersMap, chipCosts, limit) {
		if (limit === undefined) limit = MAX_SUGGESTIONS;
		var list = [];
		droids.forEach(function (d) {
			if (!isObj(d) || !isStr(d.id)) return;
			var id = d.id, rarity = str(d.rarity);
			var available = variantsByDroid[id] || [], have = owned[id] || {};
			var ladder = ladderVariants(available), a = ladder.length, o = 0;
			ladder.forEach(function (v) { if (has(have, v)) o++; });
			var m = a - o;
			if (o < 1 || m < 1) return;
			var step = pickStep(available, have, rarity, chipCosts);
			if (!step.from) return;
			list.push({ droid_id: id, name: str(d.name), rarity: rarity, from: step.from, to: step.to, cost: step.cost,
				missing: m, available: a, owned: o, score: m / a,
				rarity_order: has(rarityOrdersMap, rarity) ? toInt(rarityOrdersMap[rarity]) : 9999 });
		});
		list.sort(function (x, y) { return upgradeBefore(x, y) ? -1 : (upgradeBefore(y, x) ? 1 : 0); });
		return list.slice(0, Math.max(limit, 0));
	}

	/* ---------- NovaRules and NovaPlan ---------- */

	function nextNovaPrice(novaItems, purchases, family) {
		var best = null, bestLevel = Infinity;
		(novaItems || []).forEach(function (item) {
			if (!isObj(item)) return;
			if (item.name !== family && item.id !== family) return;
			if (purchases && purchases[item.id]) return;
			var lvf = isNum(item.level) ? item.level : 0;
			if (best === null || lvf < bestLevel) { best = item; bestLevel = lvf; }
		});
		if (best === null) return { item: {}, price: null };
		return { item: best, price: isNum(best.price_nova) ? best.price_nova : null };
	}

	var NOVA_TRACKED = ['featured', 'core', 'workshop', 'iconic'];
	var NOVA_FIRST_BUYS = ['credits', 'blueprint_scrap', 'scrap_value'];

	function priceList(u) {
		var out = [], text = u && u.prices != null ? String(u.prices) : '';
		text.split(',').forEach(function (part) {
			var p = part.trim();
			if (/^[+-]?\d+$/.test(p)) out.push(parseInt(p, 10));
		});
		return out;
	}
	function maxLevel(u) {
		var n = priceList(u).length;
		if (n > 0) return n;
		return u && u.price_start != null ? -1 : 0;
	}
	function nextCost(u, level) {
		var list = priceList(u);
		if (list.length > 0) return (level >= 0 && level < list.length) ? list[level] : -1;
		if (!u || u.price_start == null) return -1;
		return Math.trunc(u.price_start) + (u.price_step != null ? Math.trunc(u.price_step) : 0) * Math.max(level, 0);
	}
	function costToMax(u, level) {
		var list = priceList(u);
		if (list.length === 0) return u && u.price_start != null ? -1 : 0;
		var sum = 0;
		for (var i = Math.max(level, 0); i < list.length; i++) sum += list[i];
		return sum;
	}
	function costSpent(u, level) {
		var sum = 0;
		for (var i = 0; i < level; i++) { var c = nextCost(u, i); if (c < 0) break; sum += c; }
		return sum;
	}
	function isLocked(u, levels) {
		var req = u && u.requires;
		return req != null && String(req) !== '' && toInt(levels[String(req)]) <= 0;
	}
	function novaTotals(upgrades, levels) {
		var spent = 0, left = 0;
		upgrades.forEach(function (u) {
			if (NOVA_TRACKED.indexOf(str(u.shop_group)) === -1) return;
			var lv = toInt(levels[str(u.id)]);
			spent += costSpent(u, lv);
			var m = costToMax(u, lv);
			if (m > 0) left += m;
		});
		return { spent: spent, left: left };
	}
	function estimateMultiplier(creditsLevel, rebirthRows, path, rebirthsDone) {
		var m = 1.0 + 0.2 * Math.max(creditsLevel, 0);
		(rebirthRows || []).forEach(function (r) {
			if (str(r.path) !== String(path) || r.reward_multiplier_pct == null) return;
			if (toInt(r.rebirth_number) <= rebirthsDone) m += Number(r.reward_multiplier_pct) / 100.0;
		});
		return m;
	}
	// The next credit upgrade to buy. See app/domain/nova_plan.gd for the rule.
	function novaSuggest(byId, levels, multiplier, scrapShare) {
		for (var i = 0; i < NOVA_FIRST_BUYS.length; i++) {
			var id = NOVA_FIRST_BUYS[i];
			if (has(byId, id) && toInt(levels[id]) <= 0) return { id: id, cost: nextCost(byId[id], 0), reason: 'first', credits_gain: 0, scrap_gain: 0 };
		}
		if (!has(byId, 'credits') || !has(byId, 'scrap_value')) return null;
		var cLv = toInt(levels.credits), sLv = toInt(levels.scrap_value);
		var cCost = nextCost(byId.credits, cLv), sCost = nextCost(byId.scrap_value, sLv);
		if (multiplier <= 0) return { id: '', cost: 0, reason: 'need_multiplier', credits_gain: 0, scrap_gain: 0 };
		var cGain = 0.2 / multiplier;
		var sGain = (clamp(scrapShare, 0, 100) / 100) / Math.max(sLv, 1);
		var scrapWins = sCost > 0 && cCost > 0 && sGain / sCost > cGain / cCost;
		return { id: scrapWins ? 'scrap_value' : 'credits', cost: scrapWins ? sCost : cCost,
			reason: scrapWins ? 'scrap' : 'credits', credits_gain: cGain, scrap_gain: sGain,
			credits_cost: cCost, scrap_cost: sCost };
	}

	/* ---------- EventRules ---------- */

	var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	// Unix seconds of "2026-11-20T03:00Z". 0 when the text is blank or wrong.
	function parseUtc(text) {
		var s = text == null ? '' : String(text).trim().replace(/Z$/, '');
		var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
		if (!m) return 0;
		var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
		return isNaN(ms) ? 0 : Math.floor(ms / 1000);
	}
	function nextOccurrence(row, now) {
		var first = parseUtc(row.first_start_utc);
		if (first <= 0) return null;
		var rep = (isNum(row.repeat_minutes) ? Math.trunc(row.repeat_minutes) : 0) * 60;
		var dur = (isNum(row.duration_minutes) ? Math.trunc(row.duration_minutes) : 0) * 60;
		var last = parseUtc(row.last_start_utc);
		var start = first;
		if (rep > 0 && now - dur >= first) start = first + (Math.floor((now - dur - first) / rep) + 1) * rep;
		if (rep <= 0 && start + dur <= now) return null;
		if (last > 0 && start > last) return null;
		return { start: start, end: start + dur, active: start <= now && now < start + dur };
	}
	function countdown(seconds) {
		var s = Math.max(Math.trunc(seconds), 0);
		function p2(n) { return n < 10 ? '0' + n : String(n); }
		if (s >= 86400) return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
		if (s >= 3600) return Math.floor(s / 3600) + 'h ' + p2(Math.floor((s % 3600) / 60)) + 'm';
		return Math.floor(s / 60) + ':' + p2(s % 60);
	}
	// biasMinutes: the local offset from UTC in minutes.
	function localParts(unix, biasMinutes) {
		var d = new Date((unix + biasMinutes * 60) * 1000);
		function p2(n) { return n < 10 ? '0' + n : String(n); }
		return {
			weekday: WEEKDAYS[d.getUTCDay()],
			date: String(d.getUTCFullYear()).padStart(4, '0') + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()),
			time: p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes())
		};
	}

	/* ---------- ProgressRules ---------- */

	function computeProgress(droids, variantsByDroid, owned, variantIds, rarityIds, basicVariant) {
		basicVariant = basicVariant || '';
		var vOwn = {}, vAvail = {}, rOwn = {}, rAvail = {};
		variantIds.forEach(function (v) { vOwn[v] = 0; vAvail[v] = 0; });
		rarityIds.forEach(function (r) { rOwn[r] = 0; rAvail[r] = 0; });
		var totalOwn = 0, totalAvail = 0, complete = 0, withVariants = 0, count = 0;
		droids.forEach(function (d) {
			if (!isObj(d)) return;
			var id = str(d.id);
			if (id === '') return;
			count++;
			var avail = variantsByDroid[id] || [];
			if (avail.length === 0 && basicVariant !== '') avail = [basicVariant];
			var have = owned[id] || {}, rarity = d.rarity, nHave = 0;
			avail.forEach(function (v) {
				var got = has(have, v);
				totalAvail++;
				vAvail[v] = (vAvail[v] || 0) + 1;
				rAvail[rarity] = (rAvail[rarity] || 0) + 1;
				if (got) { nHave++; totalOwn++; vOwn[v] = (vOwn[v] || 0) + 1; rOwn[rarity] = (rOwn[rarity] || 0) + 1; }
			});
			if (avail.length > 0) { withVariants++; if (nHave === avail.length) complete++; }
		});
		return {
			owned: totalOwn, available: totalAvail, droids: count, droids_with_variants: withVariants, complete: complete,
			by_variant: variantIds.map(function (v) { return { id: v, owned: vOwn[v] || 0, available: vAvail[v] || 0 }; }),
			by_rarity: rarityIds.map(function (r) { return { id: r, owned: rOwn[r] || 0, available: rAvail[r] || 0 }; })
		};
	}
	function fraction(ownedN, available) { return available > 0 ? clamp(ownedN / available, 0, 1) : 0; }

	/* ---------- CollectionFilter ---------- */

	var SORTS = ['Default', 'Rarity', 'Name', 'Missing', 'Income', 'Cost'];
	var SORT_ASC = { Default: true, Rarity: true, Name: true, Missing: false, Income: false, Cost: true };

	// The direction button text. It always says what comes first. low/high: names of the lowest and highest rarity.
	function dirLabel(key, asc, low, high, tr) {
		tr = tr || identityTr;
		low = low || tr.t('Common'); high = high || tr.t('Iconic');
		switch (key) {
			case 'Default': return asc ? tr.t('First to last') : tr.t('Last to first');
			case 'Rarity': return tr.f('%s first', asc ? low : high);
			case 'Name': return asc ? tr.t('A to Z') : tr.t('Z to A');
			case 'Missing': return asc ? tr.t('Fewest missing first') : tr.t('Most missing first');
			case 'Income': return asc ? tr.t('Lowest income first') : tr.t('Highest income first');
			case 'Cost': return asc ? tr.t('Cheapest first') : tr.t('Most expensive first');
		}
		return asc ? tr.t('Low to high') : tr.t('High to low');
	}
	function defaultFilters() {
		return { search: '', rarity: '', role: '', variant: '', uncollected: false, sort: 'Rarity', asc: true };
	}
	function buildVariants(droids, tiers, incomeByKey) {
		var out = Object.create(null);
		droids.forEach(function (d) {
			if (!isObj(d) || !isStr(d.id)) return;
			out[d.id] = tiers.filter(function (t) { return isObj(t) && isStr(t.id) && has(incomeByKey, incomeKey(d.id, t.id)); }).map(function (t) { return t.id; });
		});
		return out;
	}
	function missingCount(available, ownedTiers) {
		var n = 0;
		available.forEach(function (v) { if (!has(ownedTiers, v)) n++; });
		return n;
	}
	function lacks(available, ownedTiers, variant) {
		if (variant !== '') return available.indexOf(variant) !== -1 && !has(ownedTiers, variant);
		return Object.keys(ownedTiers).length === 0;
	}
	function matches(droid, available, ownedTiers, f) {
		var q = str(f.search).trim().toLowerCase();
		if (q !== '' && str(droid.name).toLowerCase().indexOf(q) === -1) return false;
		var rarity = str(f.rarity);
		if (rarity !== '' && droid.rarity !== rarity) return false;
		var role = str(f.role);
		if (role !== '' && droid.role !== role) return false;
		var variant = str(f.variant);
		if (variant !== '' && available.indexOf(variant) === -1) return false;
		if (f.uncollected && !lacks(available, ownedTiers, variant)) return false;
		return true;
	}
	function normSortValue(v) { return isNum(v) ? v : null; }
	function sortValue(d, key, variantsByDroid, owned, rarityOrdersMap, valueFn) {
		var id = str(d.id);
		switch (key) {
			case 'Default': return normSortValue(d._order);
			case 'Rarity': return normSortValue(has(rarityOrdersMap, d.rarity) ? toInt(rarityOrdersMap[d.rarity]) : 9999);
			case 'Name': return str(d.name);
			case 'Missing': return normSortValue(missingCount(variantsByDroid[id] || [], owned[id] || {}));
			case 'Income': case 'Cost': return valueFn ? normSortValue(valueFn(d, key)) : null;
		}
		return null;
	}
	function makeEntries(droids, key, variantsByDroid, owned, rarityOrdersMap, valueFn) {
		return droids.map(function (d) {
			return { d: d, v: sortValue(d, key, variantsByDroid, owned, rarityOrdersMap, valueFn),
				r: has(rarityOrdersMap, d.rarity) ? toInt(rarityOrdersMap[d.rarity]) : 9999, n: str(d.name) };
		});
	}
	function cmpValue(a, b) {
		if (isStr(a)) return naturalCmp(a, b);
		return a < b ? -1 : (a > b ? 1 : 0);
	}
	// Strict weak ordering. Unknown (null) values go last in both directions. Ties: by name (for "Missing" first by rarity).
	function entryLess(a, b, key, asc) {
		var va = a.v, vb = b.v;
		if (va === null || vb === null) {
			if (va === null && vb === null) return naturalCmp(a.n, b.n) < 0;
			return vb === null;
		}
		var c = cmpValue(va, vb);
		if (c !== 0) return asc ? c < 0 : c > 0;
		if (key === 'Missing' && a.r !== b.r) return a.r < b.r;
		return naturalCmp(a.n, b.n) < 0;
	}
	function filterSort(droids, variantsByDroid, owned, rarityOrdersMap, f, valueFn) {
		var shown = droids.filter(function (d) {
			if (!isObj(d)) return false;
			var id = str(d.id);
			return id !== '' && matches(d, variantsByDroid[id] || [], owned[id] || {}, f);
		});
		var key = str(f.sort || 'Rarity'), asc = f.asc === undefined ? true : !!f.asc;
		var entries = makeEntries(shown, key, variantsByDroid, owned, rarityOrdersMap, valueFn);
		entries.sort(function (a, b) { return entryLess(a, b, key, asc) ? -1 : (entryLess(b, a, key, asc) ? 1 : 0); });
		return entries.map(function (e) { return e.d; });
	}

	return {
		has: has, isNum: isNum, isStr: isStr, isObj: isObj, sprintf: sprintf, naturalCmp: naturalCmp, clamp: clamp, toInt: toInt,
		formatNumber: formatNumber, formatExact: formatExact,
		buildIndexes: buildIndexes, isUsableData: isUsableData, orderedTiers: orderedTiers, variantsOf: variantsOf,
		rarityOrders: rarityOrders, cycles: cycles, rebirthRow: rebirthRow, maxRebirth: maxRebirth, hasChipData: hasChipData,
		upgradeChips: upgradeChips, chipsToReach: chipsToReach,
		incomeKey: incomeKey, incomeFor: incomeFor, costFor: costFor,
		effectiveSlots: effectiveSlots, protocolSlots: protocolSlots, canPlace: canPlace, specialistBonusApplies: specialistBonusApplies,
		requirementsFromRow: requirementsFromRow, rebirthStatus: rebirthStatus, afterUse: afterUse, afterUseText: afterUseText, tierOrderMap: tierOrderMap,
		CHIP_LADDER: CHIP_LADDER, MAX_SUGGESTIONS: MAX_SUGGESTIONS, nextOnLadder: nextOnLadder, prevOnLadder: prevOnLadder,
		ladderVariants: ladderVariants, chipCostsFromRows: chipCostsFromRows, pickStep: pickStep, emptyReason: emptyReason, suggest: suggest,
		nextNovaPrice: nextNovaPrice,
		NOVA_TRACKED: NOVA_TRACKED, NOVA_FIRST_BUYS: NOVA_FIRST_BUYS, priceList: priceList, maxLevel: maxLevel, nextCost: nextCost,
		costToMax: costToMax, costSpent: costSpent, isLocked: isLocked, novaTotals: novaTotals, estimateMultiplier: estimateMultiplier,
		novaSuggest: novaSuggest,
		WEEKDAYS: WEEKDAYS, parseUtc: parseUtc, nextOccurrence: nextOccurrence, countdown: countdown, localParts: localParts,
		computeProgress: computeProgress, fraction: fraction,
		SORTS: SORTS, SORT_ASC: SORT_ASC, dirLabel: dirLabel, defaultFilters: defaultFilters, buildVariants: buildVariants,
		missingCount: missingCount, lacks: lacks, matches: matches, filterSort: filterSort, makeEntries: makeEntries, entryLess: entryLess
	};
});
