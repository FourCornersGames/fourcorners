/* Shop Hand tests (milestone W4). Plain Node, no packages: node shophand/app/tests/run.js
   Ports the rule tests of the Godot app (app/tests/run_tests.gd and feature_tests.gd) to domain.js and state.js. */
'use strict';
var fs = require('fs');
var path = require('path');
var dom = require('../domain.js');
var st = require('../state.js');

var root = path.join(__dirname, '..', '..');
var raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'gamedata.json'), 'utf8'));
var gd = dom.buildIndexes(raw);

var X = 'droi' + 'dex_'; // old prefix of the Collection settings in an Android backup
var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.log('FAIL: ' + name); } }
function eq(actual, expected, name) {
	var a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (typeof actual === 'number' && typeof expected === 'number') { if (Math.abs(actual - expected) < 1e-9) { passed++; return; } }
	else if (a === e) { passed++; return; }
	failed++; console.log('FAIL: ' + name + ' (got ' + a + ', expected ' + e + ')');
}
function ids(list) { return list.map(function (d) { return d.id; }); }
function newPs() { return st.createPlayerState(gd); }
var inc = function (a, b) { return dom.incomeFor(a, b, gd.incomeByKey, gd.droidsById); };
var cost = function (a, b) { return dom.costFor(a, b, gd.incomeByKey, gd.droidsById); };

/* ---------- NumFmt ---------- */
(function () {
	var f = dom.formatNumber;
	eq(f(null), 'unknown', 'fmt null'); eq(f('abc'), 'unknown', 'fmt string'); eq(f(0), '0', 'fmt 0'); eq(f(950), '950', 'fmt 950');
	eq(f(2.5), '2.5', 'fmt 2.5'); eq(f(1000), '1K', 'fmt 1K'); eq(f(1500), '1.5K', 'fmt 1.5K'); eq(f(2000000), '2M', 'fmt 2M');
	eq(f(1410000), '1.41M', 'fmt 1.41M'); eq(f(3000000000), '3B', 'fmt 3B'); eq(f(150000000000000), '150T', 'fmt 150T');
	eq(f(2.0e15), '2Qa', 'fmt Qa'); eq(f(3.0e18), '3Qi', 'fmt Qi'); eq(f(999999), '1M', 'fmt rounds up'); eq(f(-1500), '-1.5K', 'fmt negative');
	eq(f(1500, { lang: 'fr' }), '1,5K', 'fmt French decimal comma'); eq(f(null, { unknown: 'inconnu' }), 'inconnu', 'fmt unknown text');
	eq(dom.formatExact(150000), '150,000', 'exact'); eq(dom.formatExact(150000000000000), '150,000,000,000,000', 'exact big');
	eq(dom.formatExact(null), 'unknown', 'exact null'); eq(dom.formatExact(150000, { lang: 'fr' }), '150 000', 'exact French');
	eq(dom.sprintf('%s: %d of %d (%.1f)', 'a', 2.9, 5, 1.25), 'a: 2 of 5 (1.3)', 'sprintf');
	eq(dom.naturalCmp('R2', 'r10'), -1, 'natural compare: numbers'); eq(dom.naturalCmp('Abc', 'abc'), 0, 'natural compare: case');
})();

/* ---------- Data integrity and lookups ---------- */
(function () {
	ok(raw.build === 'public', 'data is the public build');
	raw.droid_income.forEach(function (r) { if (!(dom.has(gd.droidsById, r.droid_id) && dom.has(gd.tierById, r.tier_id))) ok(false, 'income row ' + r.droid_id + '/' + r.tier_id + ' points to a known droid and tier'); });
	ok(dom.isUsableData(raw), 'schema usable'); ok(!dom.isUsableData({ schema_version: 99 }), 'newer schema rejected'); ok(!dom.isUsableData({}), 'empty rejected');
	eq(gd.droids.length, 101, '101 droids'); eq(gd.novaUpgrades.length, 55, '55 nova upgrade rows'); eq(gd.traits.length, 31, '31 trait rows');
	eq(gd.events.length, 23, '23 events'); eq(gd.eventSchedule.length, 10, '10 schedule rows'); eq(gd.missions.length, 10, '10 missions');
	eq(inc('cb', 'gold'), 6, 'cb gold income'); eq(inc('cb', 'base'), 3, 'cb base income'); eq(cost('cb', 'gold'), 8000, 'cb gold cost');
	eq(inc('nope', 'base'), null, 'unknown droid income'); eq(inc('c_3po', 'scourge'), null, 'iconic has no scourge income');
	eq(inc('c_3po', 'base'), null, 'iconic has no variants income'); ok(inc('cb', 'scourge') !== null, 'regular droid has a scourge income row');
	eq(dom.variantsOf(gd, 'c_3po'), [], 'iconic keeps no variants'); ok(dom.variantsOf(gd, 'cb').length >= 9, 'regular droid has nine variants');
	eq(dom.variantsOf(gd, 'cb')[8], 'scourge', 'scourge is the last variant');
	eq(dom.incomeFor('x', 'base', {}, { x: { base_income_per_sec: 5 } }), 5, 'income fallback');
	eq(dom.rebirthRow(gd, 1, 3).credits_required, 975000, 'rebirth 3 credits'); eq(dom.upgradeChips(gd, 'common', 'base'), 10, 'chips common base to gold');
	eq(dom.upgradeChips(gd, 'iconic', 'base'), null, 'chips iconic unknown'); eq(dom.cycles(gd), [1, 2, 3, 4, 5, 6], 'six paths');
	eq(dom.chipsToReach(gd, 'common', 'gold'), 10, 'chips to reach gold'); eq(dom.chipsToReach(gd, 'common', 'base'), null, 'chips to reach base: none');
	ok(dom.hasChipData(gd, 'common') && !dom.hasChipData(gd, 'iconic'), 'chip data per rarity');
	eq(dom.maxRebirth(gd, 1) > 0, true, 'path 1 has rebirths');
	ok(!dom.has(gd.droidsById, '__proto__') && !dom.has(gd.droidsById, 'constructor'), 'droid index has no prototype keys');
	eq(dom.buildIndexes({ schema_version: 1, droids: [{ id: 'a' }, { name: 'no id' }, 5, null, { id: 'b', rarity: 'zzz' }], tiers: [{ id: 'base', order: 1 }, { id: 'odd' }], rebirths: [{ path: '1', rebirth_number: 1 }, { rebirth_number: null }], fusion_recipes: 'oops' }).droids.length, 3, 'sparse data loads');
})();

/* ---------- Slots ---------- */
(function () {
	var lounge = gd.stationById.lounge, worker = gd.stationById.worker;
	var items = [
		{ id: 'ls1', effect_type: 'add_slot', effect_target: 'lounge', effect_value: 1 }, { id: 'ls2', effect_type: 'add_slot', effect_target: 'lounge', effect_value: 2 },
		{ id: 'ws', effect_type: 'add_slot', effect_target: 'worker', effect_value: 5 }, { id: 'x', effect_type: 'other', effect_target: 'lounge', effect_value: 9 },
		{ id: 'nov', effect_type: 'add_slot', effect_target: 'lounge', effect_value: null }];
	eq(dom.effectiveSlots(lounge, items, {}), 9, 'lounge default slots'); eq(dom.effectiveSlots(lounge, items, { ls1: true }), 10, 'lounge plus one');
	eq(dom.effectiveSlots(lounge, items, { ls1: true, ls2: true, x: true, ws: true }), 12, 'lounge plus three');
	eq(dom.effectiveSlots(lounge, items, { nov: true }), 9, 'null effect value adds nothing'); eq(dom.effectiveSlots(worker, items, { ws: true }), 16, 'worker plus five');
	eq(dom.protocolSlots(worker), 2, 'worker protocol slots'); eq(dom.protocolSlots(lounge), 0, 'lounge protocol slots'); eq(dom.effectiveSlots({}, [], {}), 0, 'empty station');
	var cb = gd.droidsById.cb, sa5 = gd.droidsById.sa_5;
	ok(dom.canPlace(sa5, 'protocol'), 'protocol droid in protocol slot'); ok(!dom.canPlace(sa5, 'standard'), 'protocol droid not in standard slot');
	ok(dom.canPlace(cb, 'standard'), 'other droid in standard slot'); ok(!dom.canPlace(cb, 'protocol'), 'other droid not in protocol slot'); ok(!dom.canPlace(cb, 'bogus'), 'bad slot kind');
	ok(dom.specialistBonusApplies(cb, gd.stationById.astro), 'astromech in astro station'); ok(!dom.specialistBonusApplies(cb, gd.stationById.worker), 'astromech not in worker station');
	ok(!dom.specialistBonusApplies(cb, gd.stationById.lounge), 'no bonus in lounge'); ok(!dom.specialistBonusApplies(sa5, gd.stationById.astro), 'no bonus for protocol');
})();

/* ---------- Rebirth status ---------- */
(function () {
	var reqs = dom.requirementsFromRow(dom.rebirthRow(gd, 1, 3));
	eq(reqs.length, 3, '3 requirements'); eq(reqs[0].droid_id, 'a_lt', 'req 1 droid'); eq(reqs[2].tier_id, 'gold', 'req 3 tier');
	var layout = { lounge: { standard: [{ droid: 'a_lt', tier: 'base' }, {}], protocol: [] }, worker: { standard: [{ droid: 'b_u4d', tier: 'gold' }], protocol: [] }, astro: { standard: [{ droid: 'r9', tier: 'base' }], protocol: [] } };
	var s = dom.rebirthStatus(reqs, layout, gd.tiers);
	eq(s[0].status, 'green', 'a_lt in lounge is green'); eq(s[1].status, 'green', 'higher tier counts'); eq(s[2].status, 'red', 'lower tier is red');
	eq(dom.rebirthStatus(reqs, layout, gd.tiers, false)[1].status, 'red', 'higher tier off: red');
	layout.astro.standard[0].tier = 'rainbow';
	eq(dom.rebirthStatus(reqs, layout, gd.tiers)[2].status, 'green', 'r9 rainbow satisfies gold');
	var preq = [{ droid_id: 'sa_5', tier_id: 'base' }];
	eq(dom.rebirthStatus(preq, { worker: { standard: [], protocol: [{ droid: 'sa_5', tier: 'base' }] } }, gd.tiers)[0].status, 'green', 'protocol slot counts');
	eq(dom.rebirthStatus(preq, {}, gd.tiers)[0].status, 'red', 'empty layout red');
	var tiers2 = [{ id: 'base', order: 1 }, { id: 'scourge', order: null }];
	var r2 = dom.rebirthStatus([{ droid_id: 'a', tier_id: 'scourge' }], { x: { standard: [{ droid: 'a', tier: 'base' }], protocol: [] } }, tiers2);
	eq(r2[0].status, 'red', 'unknown order is not comparable'); ok(r2[0].warning, 'unknown order warns');
	eq(dom.rebirthStatus([{ droid_id: 'a', tier_id: 'scourge' }], { x: { standard: [{ droid: 'a', tier: 'scourge' }], protocol: [] } }, tiers2)[0].status, 'green', 'unknown order equal tier is green');
	eq(dom.rebirthStatus([null, 5], { x: 3 }, []).length, 0, 'bad input');
})();

/* ---------- Rebirth: what to do after use ---------- */
(function () {
	var order = { base: 1, gold: 2, diamond: 3, rainbow: 4 };
	function row(n, a, at, b, bt, c, ct) { return { rebirth_number: n, droid1_id: a, droid1_tier: at, droid2_id: b, droid2_tier: bt, droid3_id: c, droid3_tier: ct }; }
	var rows = [row(1, 'a', 'base', 'b', 'gold', 'c', 'base'), row(2, 'd', 'base', 'e', 'base', 'f', 'base'), row(5, 'a', 'diamond', 'd', 'base', 'f', 'base'),
		row(3, 'a', 'gold', 'b', 'base', 'e', 'gold'), row(7, 'c', 'scourge', 'b', 'diamond', 'g', 'base')];
	eq(dom.afterUse(1, 'a', 'base', rows, order), { action: 'upgrade', tier_id: 'gold', rebirth: 3 }, 'after: the nearest later higher variant wins (RB3, not RB5)');
	eq(dom.afterUse(3, 'a', 'gold', rows, order), { action: 'upgrade', tier_id: 'diamond', rebirth: 5 }, 'after: next higher variant later');
	eq(dom.afterUse(5, 'a', 'diamond', rows, order), { action: 'sell' }, 'after: nothing later: sell');
	eq(dom.afterUse(1, 'b', 'gold', rows, order), { action: 'upgrade', tier_id: 'diamond', rebirth: 7 }, 'after: a later lower variant is skipped');
	eq(dom.afterUse(1, 'd', 'base', rows, order), { action: 'sell' }, 'after: the same variant later is not higher: sell');
	eq(dom.afterUse(2, 'e', 'base', rows, order), { action: 'upgrade', tier_id: 'gold', rebirth: 3 }, 'after: upgrade for another droid');
	eq(dom.afterUse(1, 'c', 'base', rows, order), { action: 'sell' }, 'after: a later variant without an order: sell');
	eq(dom.afterUse(7, 'c', 'scourge', rows, order), { action: 'sell' }, 'after: this variant without an order: sell');
	eq(dom.afterUse(1, 'a', null, rows, order), { action: 'sell' }, 'after: no variant given: sell');
	eq(dom.afterUse(1, 'zzz', 'base', rows, order), { action: 'sell' }, 'after: droid not needed later: sell');
	eq(dom.afterUse(0, 'a', 'base', [], order), { action: 'sell' }, 'after: no rows: sell');
	eq(dom.afterUse(1, 'a', 'base', [5, null, { rebirth_number: null }], order), { action: 'sell' }, 'after: bad rows do not crash');
	var other = [row(2, 'd', 'rainbow', 'e', 'base', 'f', 'base')];
	eq(dom.afterUse(1, 'd', 'base', rows, order), { action: 'sell' }, 'after: another path is ignored');
	eq(dom.afterUse(1, 'd', 'base', other, order).tier_id, 'rainbow', 'after: the same data on its own path counts');
	eq(dom.afterUseText({ action: 'upgrade', tier_id: 'gold', rebirth: 7 }, 'Gold'), 'Gold @ RB7', 'after text: upgrade'); eq(dom.afterUseText({ action: 'sell' }, 'x'), 'Sell', 'after text: sell');
	eq(dom.tierOrderMap([{ id: 'base', order: 1 }, { id: 'scourge', order: null }, { id: 'x' }, 5]), { base: 1 }, 'tier order map skips tiers without an order');
	// Real data: every answer agrees with the rows of the same path.
	var tierOrder = dom.tierOrderMap(gd.tiers), foundLo = false, ups = 0, sells = 0;
	dom.cycles(gd).forEach(function (cyc) {
		var pathRows = [];
		for (var n = 1; n <= 40; n++) { var pr = dom.rebirthRow(gd, cyc, n); if (pr) pathRows.push(pr); }
		pathRows.forEach(function (r) {
			dom.requirementsFromRow(r).forEach(function (req) {
				if (req.droid_id === 'lo') foundLo = true;
				var res = dom.afterUse(r.rebirth_number, req.droid_id, req.tier_id, pathRows, tierOrder);
				if (res.action === 'sell') { sells++; return; }
				ups++;
				ok(res.rebirth > r.rebirth_number, 'real after: later rebirth');
				var hit = dom.requirementsFromRow(dom.rebirthRow(gd, cyc, res.rebirth)).some(function (lr) { return lr.droid_id === req.droid_id && lr.tier_id === res.tier_id && tierOrder[lr.tier_id] > tierOrder[req.tier_id]; });
				ok(hit, 'real after: the later row needs the droid at that higher variant');
			});
		});
	});
	ok(foundLo, 'real data: the droid lo is required in a rebirth'); ok(ups > 0 && sells > 0, 'real data: both answers occur (' + ups + ' upgrade, ' + sells + ' sell)');
})();

/* ---------- Nova ---------- */
(function () {
	var nu = gd.novaUpgradeById;
	eq(dom.maxLevel(nu.lounge_slot), 12, 'nova: Lounge Slot has 12 levels'); eq(dom.costToMax(nu.lounge_slot, 0), 3361, 'nova: Lounge Slot costs 3361 in all');
	eq(dom.nextCost(nu.lounge_slot, 4), 150, 'nova: Lounge Slot level 5 costs 150'); eq(dom.nextCost(nu.lounge_slot, 12), -1, 'nova: no price at the maximum');
	eq(dom.maxLevel(nu.credits), -1, 'nova: Credits has no cap'); eq(dom.nextCost(nu.credits, 30), 122, 'nova: Credits level 31 costs 122');
	eq(dom.nextCost(nu.scrap_value, 15), 475, 'nova: Scrap Value level 16 costs 475'); eq(dom.costSpent(nu.credits, 3), 18, 'nova: three Credits levels cost 18');
	eq(dom.isLocked(nu.scrap_value, {}), true, 'nova: Scrap Value needs Blueprint Scrap'); eq(dom.isLocked(nu.scrap_value, { blueprint_scrap: 1 }), false, 'nova: open with Blueprint Scrap');
	eq(dom.novaSuggest(nu, {}, 0, 0).id, 'credits', 'nova advice: Credits first'); eq(dom.novaSuggest(nu, { credits: 1 }, 0, 0).id, 'blueprint_scrap', 'nova advice: Blueprint Scrap second');
	eq(dom.novaSuggest(nu, { credits: 1, blueprint_scrap: 1 }, 0, 0).id, 'scrap_value', 'nova advice: Scrap Value third');
	var first3 = { credits: 30, blueprint_scrap: 1, scrap_value: 15 };
	eq(dom.novaSuggest(nu, first3, 0, 50).reason, 'need_multiplier', 'nova advice: asks for the multiplier');
	eq(dom.estimateMultiplier(5, [], '1', 0), 2.0, 'nova: estimate from 5 Credits levels');
	eq(dom.estimateMultiplier(0, Object.values(gd.rebirthsByKey), '1', 3), 2.3, 'nova: estimate adds the rebirth bonuses of path 1');
	eq(dom.estimateMultiplier(0, Object.values(gd.rebirthsByKey), '2', 3), 1.0, 'nova: no rebirth bonus data for path 2');
	eq(dom.novaSuggest(nu, first3, 195, 50).id, 'scrap_value', 'nova advice: Scrap Value at 195x with a 50% share');
	eq(dom.novaSuggest(nu, first3, 195, 0).id, 'credits', 'nova advice: Credits when the station gives nothing');
	eq(dom.novaSuggest(nu, { credits: 2, blueprint_scrap: 1, scrap_value: 1 }, 3, 5).id, 'credits', 'nova advice: Credits early');
	gd.novaUpgrades.forEach(function (u) { ok(dom.nextCost(u, 0) > 0, 'nova: ' + u.id + ' has a first price'); });
	var t = dom.novaTotals(gd.novaUpgrades, {}); eq(t.spent, 0, 'nova totals: nothing spent'); ok(t.left > 0, 'nova totals: something left');
	var items = gd.novaItems;
	eq(dom.nextNovaPrice(items, {}, 'Blueprint Storage').price, 10, 'storage first level price');
	eq(dom.nextNovaPrice(items, { blueprint_storage_1: true, blueprint_storage_2: true, blueprint_storage_3: true }, 'Blueprint Storage').price, 250, 'storage level 4 price');
	var items2 = [{ id: 'a_1', name: 'Slot', level: 1, price_nova: 100 }, { id: 'a_2', name: 'Slot', level: 2, price_nova: 200 }, { id: 'a_3', name: 'Slot', level: 3, price_nova: null }];
	eq(dom.nextNovaPrice(items2, {}, 'Slot').price, 100, 'next level 1'); eq(dom.nextNovaPrice(items2, { a_1: true }, 'Slot').price, 200, 'next level 2');
	eq(dom.nextNovaPrice(items2, { a_1: true, a_2: true }, 'Slot').price, null, 'unknown price'); eq(dom.nextNovaPrice(items2, { a_1: true, a_2: true, a_3: true }, 'Slot').item, {}, 'all bought');
	eq(dom.nextNovaPrice(items2, {}, 'Nope').item, {}, 'no family');
})();

/* ---------- Player state ---------- */
(function () {
	var ps = newPs();
	eq(ps.ownedCount(), 0, 'empty state'); ok(ps.isEmpty(), 'empty state is empty');
	ps.setTierOwned('cb', 'base', true); ps.setTierOwned('cb', 'gold', true);
	ok(ps.isOwned('cb'), 'cb owned'); ok(ps.hasTier('cb', 'gold'), 'cb gold'); ok(!ps.hasTier('cb', 'diamond'), 'cb diamond not'); eq(ps.ownedCount(), 1, 'one owned'); ok(!ps.isEmpty(), 'not empty');
	ps.setSlot('astro', 'standard', 0, 'cb', 'base');
	ok(ps.isPlaced('cb'), 'cb placed'); ok(ps.isPlaced('cb', 'base'), 'cb base placed'); ok(!ps.isPlaced('cb', 'gold'), 'cb gold not placed');
	ps.setRebirth(5, 2); ps.setNovaPurchased('companion_slot', true); ps.setNovaLevel('lounge_slot', 4); ps.setNovaLevel('no_such_upgrade', 2);
	ps.setNovaInput('multiplier', 12); ps.setNovaInput('scrap_share', 250); ps.setSetting('hide_unowned_names', true);
	var text = ps.exportJson();
	ps.applyDict({}); eq(ps.ownedCount(), 0, 'cleared');
	var res = ps.importJson(text); ok(res.ok, 'import ok');
	ok(ps.hasTier('cb', 'gold'), 'round trip tier'); eq(ps.rebirthNumber, 5, 'round trip rebirth'); eq(ps.novaLevel('lounge_slot'), 4, 'round trip nova level');
	eq(ps.novaLevel('no_such_upgrade'), 0, 'round trip drops an unknown nova id'); eq(ps.novaInput('multiplier'), 12, 'round trip nova multiplier');
	eq(ps.novaInput('scrap_share'), 100, 'nova share is at most 100'); eq(ps.rebirthCycle, 2, 'round trip cycle'); ok(dom.has(ps.novaPurchases, 'companion_slot'), 'round trip nova item');
	eq(ps.getSetting('hide_unowned_names'), true, 'round trip setting'); eq(ps.getSlot('astro', 'standard', 0).droid, 'cb', 'round trip slot');
	eq(JSON.parse(text).format, 'droid_aide_state', 'export format name is the same as the Android app'); eq(JSON.parse(text).version, 1, 'export version is 1');
	eq(Object.keys(JSON.parse(text)), ['format', 'version', 'owned', 'rebirth_number', 'rebirth_cycle', 'base_layout', 'nova_purchases', 'nova_levels', 'nova_inputs', 'fusions', 'settings'], 'export keys are the same as the Android app');
	var bad = { format: 'droid_aide_state', version: 1, owned: { cb: ['base', 'ghost_tier'], ghost: ['base'] },
		base_layout: { worker: { standard: [{ droid: 'ghost', tier: 'base' }, { droid: 'sa_5', tier: 'base' }, { droid: 'cb', tier: 'base' }], protocol: [{ droid: 'sa_5', tier: 'base' }] }, nowhere: { standard: [] } },
		nova_purchases: ['ghost_item', 'companion_slot'], settings: { hide_unowned_names: 'yes', mystery: 1 } };
	ps.applyDict(bad);
	ok(!dom.has(ps.owned, 'ghost'), 'unknown droid dropped'); ok(!ps.hasTier('cb', 'ghost_tier'), 'unknown tier dropped'); ok(!dom.has(ps.baseLayout, 'nowhere'), 'unknown station dropped');
	eq(ps.getSlot('worker', 'standard', 0), {}, 'unknown droid slot emptied'); eq(ps.getSlot('worker', 'standard', 1), {}, 'protocol droid not in standard slot');
	eq(ps.getSlot('worker', 'standard', 2).droid, 'cb', 'valid slot kept'); eq(ps.getSlot('worker', 'protocol', 0).droid, 'sa_5', 'protocol slot kept');
	ok(dom.has(ps.novaPurchases, 'companion_slot') && !dom.has(ps.novaPurchases, 'ghost_item'), 'unknown nova dropped');
	eq(ps.getSetting('hide_unowned_names'), false, 'wrong type setting ignored'); ok(!dom.has(ps.settings, 'mystery'), 'unknown setting dropped');
	ok(!ps.importJson('not json').ok, 'bad json rejected'); ok(!ps.importJson('{"a": 1}').ok, 'wrong format rejected');
	ok(!ps.importJson('{"format":"droid_aide_state","version":99}').ok, 'newer version rejected');
	ps.applyDict({}); ps.setBasicOwned('cb', true); ps.setTierOwned('cb', 'gold', true); ps.setBasicOwned('cb', false); ok(!ps.isOwned('cb'), 'basic off clears all tiers');
	// Undo
	ps.applyDict({}); var offered = null; ps.onUndo(function (i) { offered = i; });
	ps.markTierWithUndo('cb', 'gold', true); ok(ps.hasTier('cb', 'gold') && offered && offered.value === true, 'undo offered after a mark');
	ps.restoreSnapshot(offered.snapshot); ok(!ps.isOwned('cb'), 'undo puts the owned state back');
	ps.setRebirthWithUndo(3, 2, 'number'); eq(ps.rebirthNumber, 3, 'rebirth set'); ps.restoreSnapshot(offered.snapshot); eq(ps.rebirthNumber, 0, 'undo puts the rebirth back');
	// Change events
	var n = 0; ps.onChange(function () { n++; }); ps.setTierOwned('mouse', 'base', true); ps.setSetting('coll_sort', 'Name'); ps.setSetting('coll_sort', 'Name'); eq(n, 2, 'change events: no event when a setting does not change');
})();

/* ---------- Hostile import ---------- */
(function () {
	var ps = newPs(); ps.setTierOwned('cb', 'base', true);
	var before = JSON.stringify(ps.toDict()), head = '{"format":"droid_aide_state","version":1,';
	ok(!ps.importJson(head + '"x":"' + 'a'.repeat(1048576) + '"}').ok, 'hostile: text over 1 MB rejected');
	ok(!ps.importJson('a'.repeat(2000000)).ok, 'hostile: 2 MB of junk rejected');
	ok(!ps.importJson(head + '"x":"' + 'é'.repeat(600000) + '"}').ok, 'hostile: byte cap counts bytes');
	['[]', '[1,2,3]', '5', '"text"', 'null', 'true', '', '   ', '{', '}{', '{"format":'].forEach(function (t) { ok(!ps.importJson(t).ok, 'hostile: root "' + t.slice(0, 12) + '" rejected'); });
	ok(!ps.importJson(head + '"x":' + '['.repeat(40) + ']'.repeat(40) + '}').ok, 'hostile: nesting 40 deep rejected');
	ok(!ps.importJson('['.repeat(3000) + ']'.repeat(3000)).ok, 'hostile: nesting 3000 deep rejected without a crash');
	ok(!ps.importJson('{"a":'.repeat(600) + '1' + '}'.repeat(600)).ok, 'hostile: 600 nested objects rejected');
	eq(JSON.stringify(ps.toDict()), before, 'hostile: rejected input leaves the state unchanged');
	var wrong = { format: 'droid_aide_state', version: 1, owned: { cb: 'base', ghost: ['base'], sa_5: [1, null, { a: 1 }, ['base'], 'gold'], __proto__x: ['base'] },
		rebirth_number: 'many', rebirth_cycle: [1], base_layout: [1, 2], nova_purchases: { a: 1 }, fusions: 'oops',
		settings: { [X + 'sort']: { a: 1 }, [X + 'rarity']: 'x'.repeat(500), hide_unowned_names: 1, unknown_key: 'z' }, unknown_top_key: { deep: [1, 2, 3] } };
	ok(ps.importJson(JSON.stringify(wrong)).ok, 'hostile: wrong types import without a crash');
	ok(!dom.has(ps.owned, 'cb') && !dom.has(ps.owned, 'ghost'), 'hostile: wrong-type and unknown droids dropped');
	ok(ps.hasTier('sa_5', 'gold') && !ps.hasTier('sa_5', '1'), 'hostile: only valid tier ids kept');
	eq(ps.rebirthNumber, 0, 'hostile: text rebirth number gives the default'); eq(ps.rebirthCycle, 1, 'hostile: array rebirth cycle gives the default');
	eq(ps.getSetting('coll_rarity'), '', 'hostile: over-long text setting ignored'); eq(ps.getSetting('coll_sort'), 'Rarity', 'hostile: wrong-type setting ignored');
	ok(!dom.has(ps.settings, 'unknown_key'), 'hostile: unknown setting dropped'); ok(!dom.has(ps.toDict(), 'unknown_top_key'), 'hostile: unknown top key not kept');
	eq(Object.keys(ps.baseLayout).length, 0, 'hostile: wrong-type layout dropped'); eq(Object.keys(ps.fusions).length, 0, 'hostile: wrong-type fusions dropped');
	ps.importJson(JSON.stringify({ format: 'droid_aide_state', version: 1, rebirth_number: 99999999999, rebirth_cycle: -5 }));
	eq(ps.rebirthNumber, 9999, 'hostile: huge rebirth number clamped'); eq(ps.rebirthCycle, 1, 'hostile: negative cycle clamped');
	var slots = []; for (var i = 0; i < 5000; i++) slots.push({ droid: 'cb', tier: 'base' });
	ps.importJson(JSON.stringify({ format: 'droid_aide_state', version: 1, base_layout: { lounge: { standard: slots } } }));
	ok(ps.baseLayout.lounge.standard.length <= 64, 'hostile: slot list capped at 64');
	ok(st.tooDeep({ a: [[[[[[[[[[[[[[1]]]]]]]]]]]]]] }), 'too_deep sees a deep value'); ok(!st.tooDeep({ a: [1, { b: 2 }] }), 'too_deep accepts a normal value');
	ok(ps.importJson(JSON.stringify({ format: 'droid_aide_state', version: 1, owned: JSON.parse('{"__proto__":["base"],"constructor":["base"],"cb":["base"]}') })).ok, 'hostile: prototype keys import without a crash');
	ok(ps.hasTier('cb', 'base') && ({}).base === undefined, 'hostile: prototype keys do not pollute');
})();

/* ---------- Backup file ---------- */
(function () {
	eq(st.MAX_IMPORT_BYTES, 1048576, 'backup: 1 MB cap'); eq(st.backupFileName({ year: 2026, month: 3, day: 9 }), 'shop-hand-backup-2026-03-09.json', 'backup: default file name');
	var ps = newPs(); ps.setTierOwned('cb', 'base', true); ps.setTierOwned('cb', 'gold', true); ps.setRebirth(4, 3); ps.setSetting('hide_unowned_names', true);
	var before = JSON.parse(JSON.stringify(ps.toDict())), text = ps.exportJson();
	ps.applyDict({}); eq(ps.ownedCount(), 0, 'backup: state wiped'); ok(ps.importJson(text).ok, 'backup: import ok'); eq(ps.toDict(), before, 'backup: round trip gives the same state');
	// A backup written by the Android app (its pretty JSON, old shape for fusions) imports.
	var android = JSON.stringify({ format: 'droid_aide_state', version: 1, owned: { l0: ['base', 'gold'], mouse: ['base'] }, rebirth_number: 2, rebirth_cycle: 2, base_layout: {},
		nova_purchases: [], nova_levels: { credits: 3 }, nova_inputs: { multiplier: 20 }, fusions: { whl_ex: { status: 'working', variant: 'diamond', have: [true, false, true] } },
		settings: { [X + 'sort']: 'Name', [X + 'asc']: false, language: 'fr', text_size: 'Large' } }, null, '  ');
	var p2 = newPs(); ok(p2.importJson(android).ok, 'android backup imports');
	ok(p2.hasTier('lo', 'gold'), 'android backup: l0 became lo'); eq(p2.novaLevel('credits'), 3, 'android backup: nova level'); eq(p2.getSetting('coll_sort'), 'Name', 'android backup: sort setting');
	eq(p2.getFusionVariant('whl_ex', 'diamond'), { working: true, have: [true, false, true] }, 'android backup: old fusion shape');
	var back = JSON.parse(p2.exportJson()); eq(back.settings.language, 'fr', 'android backup: language kept for the way back'); eq(back.format, 'droid_aide_state', 'web export has the app format');
	var sk = Object.keys(back.settings); ok(sk.indexOf(X + 'sort') !== -1 && sk.indexOf(X + 'view') !== -1 && !sk.some(function (k) { return k.indexOf('coll_') === 0; }), 'export: settings use the names of the Android backup');
	eq(p2.getSetting('coll_asc'), false, 'android backup: sort direction read from the old name');
	eq(st.checkImport(JSON.stringify({ format: 'droid_aide_state', version: 99 })).key, 'This data comes from a newer app version.', 'check import: newer version key');
	eq(st.checkImport('x').key, 'This text is not valid saved data.', 'check import: invalid key');
})();

/* ---------- Collection filter and sort ---------- */
(function () {
	var tiers = [{ id: 'base', order: 1 }, { id: 'gold', order: 2 }, { id: 'diamond', order: 3 }];
	var droids = [{ id: 'a', name: 'Alpha', rarity: 'rare', role: 'Worker' }, { id: 'b', name: 'Bravo', rarity: 'common', role: 'Battle' },
		{ id: 'c', name: 'Charlie', rarity: 'common', role: 'Worker' }, { id: 'd', name: 'Delta', rarity: 'epic', role: 'Protocol' }];
	var incm = {}; ['a|base', 'a|gold', 'a|diamond', 'b|base', 'b|gold', 'c|base', 'c|gold', 'c|diamond'].forEach(function (k) { incm[k] = {}; });
	var vb = dom.buildVariants(droids, tiers, incm);
	eq(vb.a, ['base', 'gold', 'diamond'], 'variants a'); eq(vb.b, ['base', 'gold'], 'variants b'); eq(vb.d, [], 'variants d none');
	var ro = { common: 1, rare: 2, epic: 3 };
	var owned = { a: { base: true }, b: { base: true, gold: true }, c: { diamond: true } };
	var f = dom.defaultFilters();
	eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['b', 'c', 'a', 'd'], 'sort by rarity then name');
	f.sort = 'Name'; f.asc = false; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['d', 'c', 'b', 'a'], 'sort by name descending');
	f.sort = 'Missing'; f.asc = false; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['c', 'a', 'b', 'd'], 'sort by missing, most first');
	f.asc = true; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['b', 'd', 'c', 'a'], 'sort by missing, fewest first');
	f = dom.defaultFilters(); f.variant = 'diamond'; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['c', 'a'], 'variant hides droids without it');
	f.uncollected = true; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['a'], 'variant uncollected');
	f.variant = ''; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['d'], 'all uncollected: only the droid with no owned variant');
	owned.d = { base: true }; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), [], 'owned droid without variant rows is collected');
	var ord = [{ id: 'x', name: 'B', _order: 1 }, { id: 'y', name: 'A', _order: 0 }], fo = dom.defaultFilters(); fo.sort = 'Default';
	eq(ids(dom.filterSort(ord, {}, {}, ro, fo)), ['y', 'x'], 'sort Default: the order of the data'); fo.asc = false; eq(ids(dom.filterSort(ord, {}, {}, ro, fo)), ['x', 'y'], 'sort Default, last first');
	f = dom.defaultFilters(); f.rarity = 'common'; f.role = 'Worker'; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['c'], 'rarity and role');
	f = dom.defaultFilters(); f.search = '  RAV '; eq(ids(dom.filterSort(droids, vb, owned, ro, f)), ['b'], 'search');
	eq(dom.missingCount(['base', 'gold'], { gold: true }), 1, 'missing count');
	// Income and Cost sorts: unknown values last in both directions, ties by name.
	var vals = { a: 5, b: 9, c: null, d: 5 };
	var fn = function (d) { return vals[d.id]; };
	f = dom.defaultFilters(); f.sort = 'Income'; f.asc = false; eq(ids(dom.filterSort(droids, vb, {}, ro, f, fn)), ['b', 'a', 'd', 'c'], 'sort income, highest first, unknown last');
	f.asc = true; eq(ids(dom.filterSort(droids, vb, {}, ro, f, fn)), ['a', 'd', 'b', 'c'], 'sort income, lowest first, unknown still last');
	f.sort = 'Cost'; f.asc = true; eq(ids(dom.filterSort(droids, vb, {}, ro, f, fn)), ['a', 'd', 'b', 'c'], 'sort cost, cheapest first');
	// Direction label says what comes first.
	eq(dom.dirLabel('Rarity', true, 'Common', 'Iconic'), 'Common first', 'dir label: rarity asc'); eq(dom.dirLabel('Rarity', false, 'Common', 'Iconic'), 'Iconic first', 'dir label: rarity desc');
	eq(dom.dirLabel('Name', true), 'A to Z', 'dir label: name'); eq(dom.dirLabel('Cost', true), 'Cheapest first', 'dir label: cost'); eq(dom.dirLabel('Missing', false), 'Most missing first', 'dir label: missing');
	eq(dom.dirLabel('Default', true), 'First to last', 'dir label: default'); eq(dom.dirLabel('Income', false), 'Highest income first', 'dir label: income'); eq(dom.dirLabel('Nope', true), 'Low to high', 'dir label: other');
	eq(dom.SORTS, ['Default', 'Rarity', 'Name', 'Missing', 'Income', 'Cost'], 'all six sort keys'); eq(dom.SORT_ASC.Missing, false, 'missing sorts most first at first');
	// Every key and direction on the real data is a total order: the same result when the input is reversed.
	var ro2 = dom.rarityOrders(gd), valueFn = function (d, key) { return key === 'Income' ? inc(d.id, 'base') : cost(d.id, 'base'); };
	var owned2 = { cb: { base: true }, mouse: { base: true, gold: true } };
	dom.SORTS.forEach(function (key) { [true, false].forEach(function (asc) {
		var ff = dom.defaultFilters(); ff.sort = key; ff.asc = asc;
		var a1 = ids(dom.filterSort(gd.droids, gd.variantsByDroid, owned2, ro2, ff, valueFn)), a2 = ids(dom.filterSort(gd.droids.slice().reverse(), gd.variantsByDroid, owned2, ro2, ff, valueFn));
		eq(a1, a2, 'real data: sort ' + key + (asc ? ' asc' : ' desc') + ' does not depend on the input order'); eq(a1.length, 101, 'real data: sort ' + key + ' keeps every droid');
	}); });
})();

/* ---------- Iconic droids in the Collection ---------- */
(function () {
	['c_3po', 'cb_23', 'wg_22', 'scourge_prime'].forEach(function (id) {
		eq(dom.variantsOf(gd, id), [], 'iconic ' + id + ' has no variants'); eq(dom.missingCount(dom.variantsOf(gd, id), {}), 0, 'iconic ' + id + ': nothing missing');
	});
	ok(dom.lacks([], {}, ''), 'iconic: not owned counts as uncollected'); ok(!dom.lacks([], { base: true }, ''), 'iconic: owned counts as collected');
	var f = dom.defaultFilters(); f.uncollected = true;
	var shown = ids(dom.filterSort(gd.droids, gd.variantsByDroid, { c_3po: { base: true } }, dom.rarityOrders(gd), f));
	ok(shown.indexOf('c_3po') === -1 && shown.indexOf('cb_23') !== -1, 'uncollected: an owned iconic is hidden, a missing one is shown');
	f.variant = 'scourge';
	var sc = dom.filterSort(gd.droids, gd.variantsByDroid, {}, dom.rarityOrders(gd), f);
	var withScourge = gd.droids.filter(function (d) { return dom.variantsOf(gd, d.id).indexOf('scourge') !== -1; }).length;
	ok(sc.length === withScourge && withScourge >= 90 && !sc.some(function (x) { return x.rarity === 'iconic'; }), 'scourge filter: the droids that have the variant, no iconic');
})();

/* ---------- Upgrade rules ---------- */
(function () {
	var v4 = ['base', 'gold', 'diamond', 'rainbow'], all8 = dom.CHIP_LADDER.slice(), all9 = all8.concat(['scourge']);
	eq(dom.nextOnLadder('base'), 'gold', 'ladder: base to gold'); eq(dom.nextOnLadder('stellar'), 'kyber', 'ladder: stellar to kyber'); eq(dom.nextOnLadder('kyber'), '', 'ladder: nothing above kyber');
	eq(dom.nextOnLadder('scourge'), '', 'ladder: scourge is not on it'); eq(dom.nextOnLadder('nope'), '', 'ladder: unknown id'); eq(dom.prevOnLadder('gold'), 'base', 'ladder: below gold'); eq(dom.prevOnLadder('base'), '', 'ladder: below base');
	eq(dom.ladderVariants(['scourge', 'gold', 'base']), ['base', 'gold'], 'ladder variants drop scourge and keep ladder order');
	var c1 = { 'common|base|gold': 5, 'common|gold|diamond': 6, 'common|diamond|rainbow': 7 };
	eq(dom.pickStep(v4, { base: true }, 'common', c1), { from: 'base', to: 'gold', cost: 5 }, 'step above base');
	eq(dom.pickStep(v4, { base: true, gold: true }, 'common', c1), { from: 'gold', to: 'diamond', cost: 6 }, 'step above gold');
	eq(dom.pickStep(v4, { gold: true }, 'common', c1), { from: 'gold', to: 'diamond', cost: 6 }, 'owned gold only: step from gold');
	eq(dom.pickStep(v4, { base: true, diamond: true }, 'common', c1), { from: 'base', to: 'gold', cost: 5 }, 'lowest owned variant with a step wins');
	eq(dom.pickStep(v4, { rainbow: true }, 'common', c1), {}, 'top variant owned: no step'); eq(dom.pickStep(v4, {}, 'common', c1), {}, 'nothing owned: no step');
	eq(dom.pickStep(v4, { base: true, gold: true, diamond: true, rainbow: true }, 'common', c1), {}, 'nothing missing: no step'); eq(dom.pickStep(v4, { base: true }, 'common', {}), {}, 'cost unknown: no suggestion');
	eq(dom.pickStep(v4, { base: true }, 'rare', c1), {}, 'no cost row for this rarity'); eq(dom.pickStep(v4, { base: true, gold: true }, 'common', { 'common|base|gold': 5 }), {}, 'the only step left has no cost');
	eq(dom.pickStep(['base', 'diamond'], { base: true }, 'common', c1), {}, 'the next ladder variant must exist for the droid');
	var cs = { 'common|stellar|kyber': 240, 'common|kyber|scourge': 1, 'common|scourge|kyber': 1, 'common|base|gold': 5 };
	eq(dom.pickStep(all9, { kyber: true }, 'common', cs), {}, 'kyber owned: scourge is not a target'); eq(dom.pickStep(all9, { scourge: true }, 'common', cs), {}, 'scourge owned: not the start of a step');
	eq(dom.pickStep(all9, { stellar: true, scourge: true }, 'common', cs), { from: 'stellar', to: 'kyber', cost: 240 }, 'scourge owned does not hide the real step');
	eq(dom.pickStep(v4, { base: true }, 'iconic', { 'iconic|base|gold': 1 }), {}, 'iconic: no step');
	var costs = dom.chipCostsFromRows([{ rarity: 'common', from_tier: 'base', to_tier: 'gold', chips: 5 }, { rarity: 'rare', from_tier: 'base', to_tier: 'gold', chips: 30 }, { rarity: 'rare', from_tier: 'gold', to_tier: 'diamond', chips: null }]);
	eq(Object.keys(costs).length, 2, 'null chips skipped'); costs['epic|gold|diamond'] = 40;
	var ro = { common: 1, rare: 2, epic: 3 };
	var droids = [{ id: 'a', name: 'Alpha', rarity: 'rare' }, { id: 'b', name: 'Bravo', rarity: 'common' }, { id: 'c', name: 'Charlie', rarity: 'common' }, { id: 'd', name: 'Delta', rarity: 'epic' },
		{ id: 'e', name: 'Echo', rarity: 'common' }, { id: 'f', name: 'Foxtrot', rarity: 'epic' }, { id: 'g', name: 'Golf', rarity: 'rare' }];
	var vb = { a: v4, b: v4, c: ['base', 'gold'], d: v4, e: ['base'], f: v4, g: v4 };
	var owned = { a: { base: true }, b: { base: true }, c: { base: true }, e: { base: true }, f: { base: true, gold: true }, g: { gold: true } };
	var res = dom.suggest(droids, vb, owned, ro, costs);
	eq(res.length, 3, 'max 3 suggestions'); eq(res.map(function (x) { return x.droid_id; }), ['b', 'a', 'c'], 'score, then chip cost');
	eq(res[0].score, 0.75, 'score is M over A'); eq(res[0].missing, 3, 'missing M'); eq(res[0].available, 4, 'available A'); eq(res[0].cost, 5, 'cost shown'); eq(res[0].to, 'gold', 'target variant');
	eq(dom.suggest(droids, vb, owned, ro, costs, 10).map(function (x) { return x.droid_id; }), ['b', 'a', 'c', 'f'], 'all candidates in order; g has no real step');
	eq(dom.suggest(droids, vb, owned, ro, costs, 2).length, 2, 'limit respected');
	var d2 = [{ id: 'x', name: 'Zed', rarity: 'common' }, { id: 'y', name: 'Amy', rarity: 'common' }, { id: 'z', name: 'Bob', rarity: 'rare' }];
	var v2 = { x: ['base', 'gold'], y: ['base', 'gold'], z: ['base', 'gold'] }, o2 = { x: { base: true }, y: { base: true }, z: { base: true } }, costs2 = { 'common|base|gold': 5, 'rare|base|gold': 5 };
	eq(dom.suggest(d2, v2, o2, ro, costs2).map(function (x) { return x.droid_id; }), ['y', 'x', 'z'], 'tie: rarity then name');
	eq(dom.suggest(d2.slice(0, 1), v2, o2, ro, costs2).length, 1, 'fewer than 3'); eq(dom.suggest(droids, vb, {}, ro, costs).length, 0, 'nothing owned: empty');
	eq(dom.suggest(droids, vb, { e: { base: true } }, ro, costs).length, 0, 'all complete: empty'); eq(dom.suggest([], {}, {}, ro, costs).length, 0, 'no droids');
	var sd = [{ id: 's', name: 'Sigma', rarity: 'common' }], sv = { s: all9 };
	var s1 = dom.suggest(sd, sv, { s: { base: true } }, ro, costs);
	eq(s1.length, 1, 'scourge droid with base owned is a candidate'); eq(s1[0].available, 8, 'A counts the chip ladder only'); eq(s1[0].missing, 7, 'M counts the chip ladder only'); eq(s1[0].score, 7 / 8, 'score 7 of 8');
	eq(dom.suggest(sd, sv, { s: { base: true, scourge: true } }, ro, costs)[0].owned, 1, 'owned scourge is not counted in O'); eq(dom.suggest(sd, sv, { s: { scourge: true } }, ro, costs).length, 0, 'only scourge owned: none');
	var full8 = {}; all8.forEach(function (t) { full8[t] = true; }); eq(dom.suggest(sd, sv, { s: full8 }, ro, costs).length, 0, 'whole ladder owned: nothing to suggest');
	var idr = [{ id: 'i', name: 'Icon', rarity: 'iconic' }];
	eq(dom.suggest(idr, { i: v4 }, { i: { base: true } }, { iconic: 6 }, { 'iconic|base|gold': 1 }).length, 0, 'iconic is never a candidate');
	eq(dom.emptyReason(droids, vb, {}), 'no_owned', 'reason: nothing owned'); eq(dom.emptyReason(droids, vb, { e: { base: true } }), 'none_left', 'reason: owned, no step left');
	eq(dom.emptyReason(sd, sv, { s: { scourge: true } }), 'no_owned', 'reason: only scourge owned'); eq(dom.emptyReason(idr, { i: v4 }, { i: { base: true } }), 'no_owned', 'reason: only an iconic owned');
	eq(dom.emptyReason([], {}, {}), 'no_owned', 'reason: no droids');
	var real = dom.suggest(gd.droids, gd.variantsByDroid, { mouse: { base: true } }, dom.rarityOrders(gd), gd.chipCosts);
	eq(real.length, 1, 'real data: one candidate'); eq(real[0].cost, 10, 'real data: common base to gold is 10 chips'); eq(real[0].available, 8, 'real data: scourge is not in A');
	var realFull = {}; all8.forEach(function (t) { realFull[t] = true; });
	eq(dom.suggest(gd.droids, gd.variantsByDroid, { mouse: realFull }, dom.rarityOrders(gd), gd.chipCosts).length, 0, 'real data: whole ladder owned, nothing to suggest');
	eq(dom.suggest(gd.droids, gd.variantsByDroid, { c_3po: { base: true }, cb_23: { base: true } }, dom.rarityOrders(gd), gd.chipCosts).length, 0, 'real data: iconic droids give no suggestion');
	var every = {}; gd.droids.forEach(function (d) { every[d.id] = { base: true }; });
	dom.suggest(gd.droids, gd.variantsByDroid, every, dom.rarityOrders(gd), gd.chipCosts, 500).forEach(function (s2) {
		ok(s2.to !== 'scourge' && s2.from !== 'scourge' && s2.rarity !== 'iconic' && s2.cost != null, 'real data: ' + s2.droid_id + ' has a real chip step');
	});
})();

/* ---------- Fusion state ---------- */
(function () {
	var ps = newPs();
	eq(Object.keys(ps.fusions).length, 0, 'no fusions'); eq(ps.getFusion('whl_ex'), { selected_variant: '', variants: {} }, 'default fusion');
	eq(ps.getFusionVariant('whl_ex', 'gold'), { working: false, have: [false, false, false] }, 'default fusion variant');
	var vs = dom.variantsOf(gd, 'whl_ex'); ok(vs.length >= 2, 'whl_ex has several variants');
	ps.setFusionSelected('whl_ex', 'gold'); ps.setFusionWorking('whl_ex', 'gold', true); ps.setFusionHave('whl_ex', 'gold', 0, true); ps.setFusionHave('whl_ex', 'gold', 1, true);
	ps.setFusionHave('whl_ex', 'gold', 1, false); ps.setFusionHave('whl_ex', 'diamond', 2, true); ps.setFusionHave('whl_ex', 'gold', 5, true);
	eq(ps.getFusionVariant('whl_ex', 'gold'), { working: true, have: [true, false, false] }, 'gold working and ticks');
	eq(ps.getFusionVariant('whl_ex', 'diamond'), { working: false, have: [false, false, true] }, 'diamond ticks apart from gold');
	ok(ps.isFusionWorking('whl_ex', 'gold'), 'gold working'); ok(!ps.isFusionWorking('whl_ex', 'diamond'), 'diamond not working'); ok(ps.isFusionWorkingAny('whl_ex'), 'any working');
	ps.setFusionCollected('whl_ex', 'base', true); ok(ps.hasTier('whl_ex', 'base'), 'collected writes the Collection'); ok(ps.isFusionWorking('whl_ex', 'gold'), 'collecting base keeps gold working');
	ps.setFusionCollected('whl_ex', 'gold', true); ok(ps.hasTier('whl_ex', 'gold'), 'gold collected is owned'); ok(!ps.isFusionWorking('whl_ex', 'gold'), 'collected clears working');
	eq(ps.getFusionVariant('whl_ex', 'gold').have, [true, false, false], 'collected keeps the ticks');
	ps.setTierOwned('whl_ex', 'diamond', true); ps.setFusionWorking('whl_ex', 'diamond', true); ps.setTierOwned('whl_ex', 'diamond', false); ps.setFusionWorking('whl_ex', 'diamond', true);
	ok(ps.isFusionWorking('whl_ex', 'diamond'), 'not collected: working can be set'); ps.setTierOwned('whl_ex', 'diamond', true); ok(!ps.isFusionWorking('whl_ex', 'diamond'), 'owned from the Collection also clears working');
	ps.setFusionCollected('whl_ex', 'gold', false); ok(!ps.hasTier('whl_ex', 'gold'), 'uncollect clears the Collection mark');
	var dec = JSON.parse(JSON.stringify(ps.fusions)); ps.restoreSnapshot(ps.snapshotDroid('whl_ex')); eq(ps.fusions, dec, 'snapshot restore keeps the fusion state');
	ps.applyDict({});
	ps.setFusionSelected('whl_ex', 'gold'); ps.setFusionWorking('whl_ex', 'gold', true); ps.setFusionHave('whl_ex', 'gold', 0, true); ps.setFusionHave('x_onk', 'base', 2, true);
	var text = ps.exportJson(); ps.applyDict({}); ok(ps.importJson(text).ok, 'fusion import ok');
	eq(ps.getFusion('whl_ex').selected_variant, 'gold', 'selected variant round trip'); eq(ps.getFusionVariant('whl_ex', 'gold'), { working: true, have: [true, false, false] }, 'variant round trip');
	eq(ps.getFusionVariant('x_onk', 'base'), { working: false, have: [false, false, true] }, 'second recipe round trip');
	ps.setFusionSelected('whl_ex', ''); ps.setFusionWorking('whl_ex', 'gold', false); ps.setFusionHave('whl_ex', 'gold', 0, false); ok(!dom.has(ps.fusions, 'whl_ex'), 'default fusion entry removed');
	ps.applyDict({ format: 'droid_aide_state', version: 1, owned: {} }); eq(Object.keys(ps.fusions).length, 0, 'old save without fusions loads');
	ps.applyDict({ fusions: {
		whl_ex: { status: 'working', variant: 'diamond', have: [true, false, true] }, x_onk: { status: 'done', variant: 'gold', have: [true, true, true] },
		n_ul: { status: 'working', variant: '', have: [false, true, false] }, arm_core: { status: 'none', variant: 'base', have: [false, false, false] } } });
	eq(ps.getFusion('whl_ex').selected_variant, 'diamond', 'old variant is the selected variant'); eq(ps.getFusionVariant('whl_ex', 'diamond'), { working: true, have: [true, false, true] }, 'old working moves to its variant');
	eq(ps.getFusionVariant('whl_ex', 'gold'), { working: false, have: [false, false, false] }, 'other variants stay empty'); eq(ps.getFusion('x_onk'), { selected_variant: 'gold', variants: {} }, 'old done adds nothing');
	ok(!ps.hasTier('x_onk', 'gold'), 'old done is not marked owned');
	var nFirst = String(dom.variantsOf(gd, 'n_ul')[0]);
	eq(ps.getFusionVariant('n_ul', nFirst), { working: true, have: [false, true, false] }, 'old working without variant: the first variant');
	eq(ps.getFusion('arm_core'), { selected_variant: 'base', variants: {} }, 'old none keeps only the variant choice');
	ps.applyDict({ fusions: { ghost: { status: 'done' }, n_ul: { status: 'weird', variant: 'nope', have: [true, 'x', true, true] }, arm_core: 5 } });
	ok(!dom.has(ps.fusions, 'ghost'), 'unknown recipe dropped'); ok(!dom.has(ps.fusions, 'arm_core'), 'non-object entry dropped'); eq(ps.getFusionVariant('n_ul', nFirst), { working: false, have: [true, false, true] }, 'bad old fields cleaned');
	ps.applyDict({ fusions: { whl_ex: { selected_variant: 'nope', variants: { gold: { working: 'yes', have: [true, 1, null] }, ghost_tier: { working: true }, base: 7 } } } });
	eq(ps.getFusion('whl_ex'), { selected_variant: '', variants: { gold: { working: false, have: [true, false, false] } } }, 'bad new fields cleaned');
	ps.applyDict({ fusions: { whl_ex: { variants: 'oops' } }, owned: {} }); ok(!dom.has(ps.fusions, 'whl_ex'), 'bad variants value leaves nothing');
	ps.applyDict({ fusions: [1, 2] }); eq(Object.keys(ps.fusions).length, 0, 'fusions not an object');
	ps.applyDict({ owned: { whl_ex: ['gold'] }, fusions: { whl_ex: { selected_variant: 'gold', variants: { gold: { working: true, have: [true, false, false] }, diamond: { working: true } } } } });
	ok(!ps.isFusionWorking('whl_ex', 'gold'), 'owned variant loads not working'); ok(ps.isFusionWorking('whl_ex', 'diamond'), 'unowned variant keeps working');
	ps.setSetting('coll_variant', 'gold'); ps.setSetting('fusion_hide_done', false); var t2 = ps.exportJson(); ps.applyDict({});
	eq(ps.getSetting('coll_variant'), '', 'default variant filter'); eq(ps.getSetting('fusion_hide_done'), true, 'default hide done'); ps.importJson(t2);
	eq(ps.getSetting('coll_variant'), 'gold', 'variant filter round trip'); eq(ps.getSetting('fusion_hide_done'), false, 'hide done round trip');
	// Fusion screen helpers: collected count and the variant in view are plain functions of the state.
	var ps2 = newPs(), v = dom.variantsOf(gd, 'whl_ex');
	v.forEach(function (t) { ps2.setTierOwned('whl_ex', t, true); }); ok(v.every(function (t) { return ps2.hasTier('whl_ex', t); }), 'all variants collected');
})();

/* ---------- Id migration ---------- */
(function () {
	var ps = newPs();
	ps.applyDict({ owned: { l0: ['base', 'gold'] } }); ok(ps.hasTier('lo', 'gold') && ps.hasTier('lo', 'base'), 'migration: owned l0 becomes lo'); ok(!dom.has(ps.owned, 'l0'), 'migration: no l0 left');
	ps.applyDict({ owned: { l0: ['base'], lo: ['gold'] } }); ok(ps.hasTier('lo', 'base') && ps.hasTier('lo', 'gold'), 'migration: l0 and lo are merged');
	ps.applyDict({ base_layout: { worker: { standard: [{ droid: 'l0', tier: 'base' }, {}], protocol: [] } } });
	eq(ps.getSlot('worker', 'standard', 0), { droid: 'lo', tier: 'base' }, 'migration: base layout slot l0 becomes lo'); ok(ps.isOwned('lo') && ps.isPlaced('lo', 'base'), 'migration: the placed droid is owned and placed as lo');
	var src = { owned: { l0: ['base'] }, fusions: { l0: { selected_variant: 'gold', variants: {} }, whl_ex: { selected_variant: 'base', variants: {} } }, base_layout: { lounge: { standard: [{ droid: 'l0', tier: 'gold' }], protocol: [] } } };
	var m = st.migrateIds(src);
	ok(m.owned.lo && !m.owned.l0, 'migrate_ids: owned'); ok(m.fusions.lo && !m.fusions.l0 && m.fusions.whl_ex, 'migrate_ids: fusion keys'); eq(m.base_layout.lounge.standard[0].droid, 'lo', 'migrate_ids: layout');
	ok(src.owned.l0, 'migrate_ids: the input is not changed'); eq(Object.keys(st.migrateIds({ owned: 5, fusions: [1], base_layout: 'x' })).length, 3, 'migrate_ids: bad shapes do not crash');
	ps.applyDict({ owned: { l0: ['base'] } }); ok(ps.exportJson().indexOf('"l0"') === -1, 'migration: the saved state has no l0 after a load');
})();

/* ---------- Events ---------- */
(function () {
	var now = dom.parseUtc('2026-11-16T16:52:45Z');
	eq(now, 1794847965, 'events: parse the UTC text');
	var wm = dom.nextOccurrence({ first_start_utc: '2026-11-16T17:20Z', repeat_minutes: 35, duration_minutes: 5 }, 1794847965);
	eq(wm.start - 1794847965, 1635, 'events: world mission starts in 27:15'); eq(dom.countdown(1635), '27:15', 'events: countdown text');
	eq(dom.countdown(3 * 86400 + 10 * 3600 + 5), '3d 10h', 'events: countdown days'); eq(dom.countdown(22 * 3600 + 7 * 60), '22h 07m', 'events: countdown hours'); eq(dom.countdown(-5), '0:00', 'events: countdown never negative');
	var ky = dom.nextOccurrence({ first_start_utc: '2026-11-16T00:15Z', repeat_minutes: 60 }, 1794847965); eq(ky.start - 1794847965, 1335, 'events: Kyber at minute 15');
	var sf = dom.nextOccurrence({ first_start_utc: '2026-11-20T03:00Z', repeat_minutes: 10080, duration_minutes: 1440, last_start_utc: '2027-03-05T03:00Z' }, dom.parseUtc('2026-11-20T04:00Z'));
	eq(sf.active, true, 'events: Scourge Friday is live one hour after the start');
	eq(dom.nextOccurrence({ first_start_utc: '2026-11-21T21:00Z', repeat_minutes: 10080, duration_minutes: 1440, last_start_utc: '2026-11-28T21:00Z' }, dom.parseUtc('2026-12-01T00:00Z')), null, 'events: Life Day is over after its last date');
	eq(dom.localParts(dom.parseUtc('2026-11-20T03:00Z'), -300).weekday, 'Thu', 'events: local weekday'); eq(dom.localParts(dom.parseUtc('2026-11-20T03:00Z'), -300).time, '22:00', 'events: local time');
	eq(dom.localParts(dom.parseUtc('2026-11-20T03:00Z'), -300).date, '2026-11-19', 'events: local date');
	eq(dom.parseUtc(''), 0, 'events: blank text'); eq(dom.parseUtc(null), 0, 'events: null text'); eq(dom.parseUtc('soon'), 0, 'events: bad text');
	eq(dom.nextOccurrence({ first_start_utc: null }, now), null, 'events: no time gives nothing');
	gd.eventSchedule.forEach(function (r) { ok(dom.parseUtc(r.first_start_utc) > 0, 'events: ' + r.id + ' has a start time'); });
})();

/* ---------- Progress ---------- */
(function () {
	var droids = [{ id: 'a', rarity: 'common' }, { id: 'b', rarity: 'rare' }, { id: 'c', rarity: 'rare' }];
	var variants = { a: ['base', 'gold'], b: ['base', 'gold', 'diamond'], c: [] };
	var owned = { a: { base: true, gold: true }, b: { base: true }, c: { base: true } };
	var r = dom.computeProgress(droids, variants, owned, ['base', 'gold', 'diamond'], ['common', 'rare']);
	eq(r.owned, 3, 'progress fixture: owned marks'); eq(r.available, 5, 'progress fixture: available marks'); eq(r.complete, 1, 'progress fixture: one droid complete'); eq(r.droids_with_variants, 2, 'progress fixture: droids with variants');
	eq(r.by_variant[0], { id: 'base', owned: 2, available: 2 }, 'progress fixture: base bar'); eq(r.by_variant[1], { id: 'gold', owned: 1, available: 2 }, 'progress fixture: gold bar');
	eq(r.by_variant[2], { id: 'diamond', owned: 0, available: 1 }, 'progress fixture: diamond bar'); eq(r.by_rarity[0], { id: 'common', owned: 2, available: 2 }, 'progress fixture: common bar');
	eq(r.by_rarity[1], { id: 'rare', owned: 1, available: 3 }, 'progress fixture: rare bar'); eq(dom.fraction(1, 0), 0, 'progress: no division by zero'); eq(dom.fraction(5, 4), 1, 'progress: the fraction is at most 1');
	var vids = dom.orderedTiers(gd).map(function (t) { return t.id; }), rids = gd.rarities.map(function (x) { return x.id; });
	var real = dom.computeProgress(gd.droids, gd.variantsByDroid, {}, vids, rids), want = 0;
	Object.keys(gd.variantsByDroid).forEach(function (k) { want += gd.variantsByDroid[k].length; });
	eq(real.available, want, 'progress real data: available = all variant rows'); eq(real.owned, 0, 'progress real data: nothing owned at first');
	eq(real.by_variant.reduce(function (s, x) { return s + x.available; }, 0), want, 'progress real data: variant bars add up'); eq(real.by_rarity.reduce(function (s, x) { return s + x.available; }, 0), want, 'progress real data: rarity bars add up');
	eq(dom.computeProgress(gd.droids, gd.variantsByDroid, {}, ['base'], [], 'base').available, 821, 'progress: 821 marks with the 11 Iconic droids');
	var own = { cb: {} }; dom.variantsOf(gd, 'cb').forEach(function (v) { own.cb[v] = true; });
	real = dom.computeProgress(gd.droids, gd.variantsByDroid, own, vids, rids); eq(real.complete, 1, 'progress real data: one complete droid'); eq(real.owned, dom.variantsOf(gd, 'cb').length, 'progress real data: marks of that droid');
})();

/* ---------- Sync rule and Firestore values ---------- */
(function () {
	var D = st.decideSync;
	eq(D({ empty: true }, null, 'u'), 'none', 'sync: nothing anywhere'); eq(D({ empty: false, uid: 'u' }, null, 'u'), 'push', 'sync: no cloud doc, local data: push');
	eq(D({ empty: true, uid: 'u' }, { updated: 5 }, 'u'), 'pull', 'sync: empty local, cloud data: pull');
	eq(D({ empty: false, uid: 'u', dirty: false, cloudSeen: 10 }, { updated: 10 }, 'u'), 'none', 'sync: in sync');
	eq(D({ empty: false, uid: 'u', dirty: true, cloudSeen: 10 }, { updated: 10 }, 'u'), 'push', 'sync: local changed since the last sync: push');
	eq(D({ empty: false, uid: 'u', dirty: false, cloudSeen: 10 }, { updated: 30 }, 'u'), 'pull', 'sync: cloud changed, local did not: pull');
	eq(D({ empty: false, uid: 'u', dirty: true, cloudSeen: 10 }, { updated: 30 }, 'u'), 'conflict', 'sync: both changed: ask the user');
	eq(D({ empty: false, uid: 'a', dirty: true, cloudSeen: 10 }, { updated: 30 }, 'b'), 'conflict', 'sync: another account with local data: ask the user');
	var ps = newPs(); ps.setTierOwned('cb', 'gold', true); ps.setRebirth(3, 2); ps.setFusionHave('whl_ex', 'gold', 0, true); ps.setNovaInput('multiplier', 7);
	var d = JSON.parse(ps.exportJson()), back = st.fromFsValue(st.toFsValue(d));
	eq(back, d, 'firestore values: the save survives the REST conversion');
	eq(st.toFsValue(5), { integerValue: '5' }, 'firestore values: int'); eq(st.toFsValue(1.5), { doubleValue: 1.5 }, 'firestore values: double'); eq(st.toFsValue([]), { arrayValue: { values: [] } }, 'firestore values: empty array');
	eq(st.fromFsValue({ mapValue: {} }), {}, 'firestore values: empty map');
})();

/* ---------- Player name ---------- */
(function () {
	eq(st.validName('  Brass Gear-42 '), 'Brass Gear-42', 'name: trimmed and valid'); eq(st.validName('ab'), null, 'name: too short'); eq(st.validName('  a b  '), 'a b', 'name: 3 characters after trim');
	eq(st.validName('x'.repeat(24)), 'x'.repeat(24), 'name: 24 characters ok'); eq(st.validName('x'.repeat(25)), null, 'name: 25 characters too long');
	eq(st.validName('José_99'), 'José_99', 'name: accented letters ok'); eq(st.validName('a@b.com'), null, 'name: no at sign or dot'); eq(st.validName('<b>hi</b>'), null, 'name: no markup');
	eq(st.validName(5), null, 'name: not a string'); eq(st.validName('   '), null, 'name: blank');
	var seen = {};
	for (var i = 0; i < 200; i++) { var n = st.randomName(); ok(st.validName(n) === n, 'name: random name is valid (' + n + ')'); seen[n] = 1; ok(/^[A-Z][a-z]+[A-Z][a-z]+\d{2,3}$/.test(n), 'name: random name has the shape WordWord42'); }
	ok(Object.keys(seen).length > 50, 'name: random names vary');
	eq(st.randomName(function () { return 0; }), 'BrassGear10', 'name: first words and 10'); eq(st.randomName(function () { return 0.999999; }), 'JollyRotor999', 'name: last words and 999');
})();

/* ---------- Account kind ---------- */
(function () {
	eq(st.accountKind([]), 'guest', 'kind: no providers is a guest'); eq(st.accountKind(undefined), 'guest', 'kind: undefined is a guest');
	eq(st.accountKind(['google.com']), 'google', 'kind: google'); eq(st.accountKind(['password']), 'email', 'kind: password is email');
	eq(st.accountKind(['emailLink']), 'email', 'kind: email link is email'); eq(st.accountKind(['password', 'google.com']), 'google', 'kind: google wins over email');
	eq(st.accountKind(['google.com', 'password']), 'google', 'kind: order does not matter'); eq(st.accountKind(['phone', 'facebook.com']), 'guest', 'kind: other providers count as guest');
})();

/* ---------- Hard rules on the site files ---------- */
(function () {
	var bad = new RegExp(['star\\s*wars', 'droid[\\s_-]*ty' + 'coon', 'droi' + 'dex'].join('|'), 'i'), files = [];
	(function walk(dir) {
		fs.readdirSync(dir).forEach(function (n) {
			var p = path.join(dir, n); var s = fs.statSync(p);
			if (s.isDirectory()) { if (n !== 'tests') walk(p); } else if (/\.(js|css|html|json|txt)$/.test(n)) files.push(p);
		});
	})(path.join(root));
	files.push(path.join(root, '..', 'fr', 'shophand', 'index.html'));
	files.forEach(function (f) { var tx = fs.readFileSync(f, 'utf8'); ok(!bad.test(tx), 'no forbidden game name in ' + path.relative(root, f)); });
	ok(files.length > 5, 'forbidden-name check saw the site files (' + files.length + ')');
})();

require('./sync_tests.js').run({ ok: ok, eq: eq, gd: gd, newPs: newPs }).then(function () {
	console.log(passed + ' passed, ' + failed + ' failed');
	process.exit(failed ? 1 : 0);
}, function (e) { console.log('FAIL: sync tests crashed: ' + (e && e.stack || e)); process.exit(1); });
