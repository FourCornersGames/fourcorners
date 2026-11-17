/* Tests of sync.js with a fake cloud, a fake storage and fake timers. */
'use strict';
var sync = require('../sync.js');

function fakeStorage() {
	var m = {};
	return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; }, _m: m };
}
function fakeTimers() {
	var t = { now: 1000, list: [], id: 0 };
	t.set = function (fn, ms) { var h = ++t.id; t.list.push({ h: h, at: t.now + ms, fn: fn }); return h; };
	t.clear = function (h) { t.list = t.list.filter(function (x) { return x.h !== h; }); };
	t.advance = function (ms) {
		var end = t.now + ms;
		for (;;) {
			var due = t.list.filter(function (x) { return x.at <= end; }).sort(function (a, b) { return a.at - b.at; })[0];
			if (!due) break;
			t.list = t.list.filter(function (x) { return x !== due; }); t.now = due.at; due.fn();
		}
		t.now = end;
	};
	return t;
}
function offlineError() { return Object.assign(new Error('offline'), { code: 'offline' }); }
function fakeCloud() {
	var c = { docs: {}, clock: 5000, online: true, writes: 0, reads: 0 };
	c.getSave = function (uid) {
		c.reads++;
		if (!c.online) return Promise.reject(offlineError());
		var d = c.docs[uid]; return Promise.resolve(d ? JSON.parse(JSON.stringify(d)) : null);
	};
	c.setSave = function (uid, p) {
		if (!c.online) return Promise.reject(offlineError());
		c.writes++; c.clock += 1000;
		c.docs[uid] = { state: JSON.parse(JSON.stringify(p.state)), name: p.name, updated: c.clock };
		return Promise.resolve({ updated: c.clock });
	};
	return c;
}
function tick() { return new Promise(function (r) { setImmediate(r); }); }
async function settle() { for (var i = 0; i < 8; i++) await tick(); }

async function run(h) {
	var ok = h.ok, eq = h.eq;
	function make(over) {
		var ps = h.newPs(), storage = (over && over.storage) || fakeStorage(), cloud = (over && over.cloud) || fakeCloud(), timers = fakeTimers();
		var asked = [], answer = over && over.answer;
		var s = sync.createSync({ ps: ps, storage: storage, cloud: cloud, timers: timers, now: function () { return timers.now; }, rng: function () { return 0; },
			askConflict: function (info) { asked.push(info); return Promise.resolve(answer); } });
		s.loadLocal(); s.start();
		return { ps: ps, s: s, storage: storage, cloud: cloud, timers: timers, asked: asked };
	}

	// 1. Local save at once, cloud save after about 2 seconds, one write for a burst.
	var a = make();
	await a.s.attach('u1');
	eq(a.s.getStatus(), 'synced', 'sync: a new guest with no data is in sync'); eq(a.cloud.writes, 0, 'sync: nothing is written for an empty guest');
	a.ps.setTierOwned('cb', 'base', true);
	ok(JSON.parse(a.storage.getItem(sync.SAVE_KEY)).state.owned.cb.length === 1, 'sync: a change is in localStorage at once');
	a.ps.setTierOwned('cb', 'gold', true); a.ps.setRebirth(2, 1);
	a.timers.advance(1500); await settle(); eq(a.cloud.writes, 0, 'sync: no cloud write before the wait ends');
	a.timers.advance(600); await settle(); eq(a.cloud.writes, 1, 'sync: one cloud write for a burst of changes');
	eq(a.cloud.docs.u1.state.owned.cb, ['base', 'gold'], 'sync: the cloud doc has the state'); eq(a.cloud.docs.u1.name, 'BrassGear10', 'sync: the first save gets a friendly name');
	eq(a.s.getStatus(), 'synced', 'sync: status synced after the write'); ok(!a.s.isDirty(), 'sync: not dirty after the write');
	ok(!/@|photo|displayName/i.test(JSON.stringify(a.storage._m)), 'sync: nothing like an email or a photo is stored locally');
	eq(Object.keys(a.cloud.docs.u1).sort(), ['name', 'state', 'updated'], 'sync: the cloud doc holds only state, name and the time');

	// 2. A reload: the local record comes back, and nothing is pushed again.
	var b = make({ storage: a.storage, cloud: a.cloud });
	ok(b.ps.hasTier('cb', 'gold'), 'sync: the state survives a reload'); eq(b.s.name(), 'BrassGear10', 'sync: the name survives a reload');
	var w = a.cloud.writes; await b.s.attach('u1'); eq(a.cloud.writes, w, 'sync: a reload with no change writes nothing'); eq(b.s.getStatus(), 'synced', 'sync: reload is in sync');

	// 3. Offline: changes are kept, the write retries, and it succeeds when online again.
	a.cloud.online = false; b.ps.setTierOwned('mouse', 'base', true); b.timers.advance(2100); await settle();
	eq(b.s.getStatus(), 'offline', 'sync: a failed write shows offline'); ok(b.s.isDirty(), 'sync: still dirty offline'); ok(JSON.parse(b.storage.getItem(sync.SAVE_KEY)).state.owned.mouse, 'sync: offline changes are in localStorage');
	b.timers.advance(3000); await settle(); eq(b.s.getStatus(), 'offline', 'sync: the retry fails while offline');
	a.cloud.online = true; b.timers.advance(70000); await settle(); eq(b.s.getStatus(), 'synced', 'sync: the retry works when online'); ok(a.cloud.docs.u1.state.owned.mouse, 'sync: the offline change reached the cloud');
	a.cloud.online = false; b.ps.setTierOwned('mouse', 'gold', true); b.timers.advance(2100); await settle(); a.cloud.online = true; await b.s.retryNow(); await settle();
	eq(b.s.getStatus(), 'synced', 'sync: retryNow after the online event'); ok(a.cloud.docs.u1.state.owned.mouse.indexOf('gold') !== -1, 'sync: the change is in the cloud');

	// 4. Another device changed the cloud, this device did not: take the cloud data.
	var c = make({ storage: fakeStorage(), cloud: a.cloud }); await c.s.attach('u1');
	ok(c.ps.hasTier('cb', 'gold') && c.ps.hasTier('mouse', 'gold'), 'sync: an empty device takes the cloud data'); eq(c.s.name(), 'BrassGear10', 'sync: the device takes the account name');
	c.ps.setTierOwned('r2', 'base', true); c.timers.advance(2100); await settle();
	await b.s.retryNow(); await settle(); ok(b.ps.hasTier('r2', 'base'), 'sync: the first device takes the newer cloud data when it has no change');

	// 5. Both changed: ask. Choice "cloud" keeps a backup of the local data.
	var d1 = make({ storage: fakeStorage(), cloud: a.cloud, answer: 'cloud' }); await d1.s.attach('u1');
	a.cloud.online = false; d1.ps.setTierOwned('zro_tec', 'base', true); d1.timers.advance(2100); await settle();
	a.cloud.online = true; c.ps.setTierOwned('x_onk', 'base', true); c.timers.advance(2100); await settle();
	await d1.s.retryNow(); await settle();
	eq(d1.asked.length, 1, 'sync: both changed: the user is asked'); eq(d1.asked[0].sameAccount, true, 'sync: the question says it is the same account');
	ok(d1.asked[0].local.droids > 0 && d1.asked[0].cloud.droids > 0, 'sync: the question has both summaries');
	ok(d1.ps.hasTier('x_onk', 'base') && !d1.ps.hasTier('zro_tec', 'base'), 'sync: choice cloud takes the cloud data');
	ok(d1.s.getBackup() && d1.s.getBackup().summary.droids > 0, 'sync: the local data is kept as a backup');
	ok(d1.s.restoreBackup() && d1.ps.hasTier('zro_tec', 'base'), 'sync: the backup can be restored'); ok(d1.s.getBackup() !== null, 'sync: restoring keeps the replaced data as the new backup');
	// Choice "local" pushes the local data and keeps the cloud one as a backup.
	var e = make({ storage: fakeStorage(), cloud: a.cloud, answer: 'local' }); await e.s.attach('u1');
	a.cloud.online = false; e.ps.setTierOwned('lo', 'base', true); e.timers.advance(2100); await settle(); a.cloud.online = true;
	c.ps.setTierOwned('wg_22', 'base', true); c.timers.advance(2100); await settle();
	await e.s.retryNow(); await settle();
	ok(a.cloud.docs.u1.state.owned.lo && !a.cloud.docs.u1.state.owned.wg_22, 'sync: choice local overwrites the cloud with this device');
	ok(e.s.getBackup() && e.s.getBackup().summary.droids > 0, 'sync: the cloud data is kept as a backup');
	// No answer: nothing changes and nothing is lost.
	var f = make({ storage: fakeStorage(), cloud: a.cloud, answer: null }); await f.s.attach('u1');
	a.cloud.online = false; f.ps.setTierOwned('b_u4d', 'base', true); f.timers.advance(2100); await settle(); a.cloud.online = true;
	c.ps.setTierOwned('gonk', 'base', true); c.timers.advance(2100); await settle(); await f.s.retryNow(); await settle();
	eq(f.s.getStatus(), 'conflict', 'sync: no answer leaves the conflict open'); ok(f.ps.hasTier('b_u4d', 'base'), 'sync: no answer keeps the local data'); ok(f.s.isDirty(), 'sync: no answer keeps the local change to push later');

	// 6. A different account (sign-in switch): local guest data against the account data.
	var g = make({ storage: fakeStorage(), cloud: fakeCloud(), answer: 'cloud' });
	g.cloud.docs.acct = { state: { format: 'droid_aide_state', version: 1, owned: { cb: ['base'] } }, name: 'CopperBolt77', updated: 9000 };
	await g.s.attach('guest1'); g.ps.setTierOwned('mouse', 'base', true); g.timers.advance(2100); await settle();
	await g.s.attach('acct'); await settle();
	eq(g.asked.length, 1, 'sync: another account with local data: the user is asked'); eq(g.asked[0].sameAccount, false, 'sync: the question says it is another account');
	ok(g.ps.hasTier('cb', 'base') && !g.ps.hasTier('mouse', 'base'), 'sync: switching to the account data'); eq(g.s.name(), 'CopperBolt77', 'sync: the account name is used');
	var g2 = make({ storage: fakeStorage(), cloud: g.cloud }); await g2.s.attach('acct'); eq(g2.asked.length, 0, 'sync: an empty device does not ask'); ok(g2.ps.hasTier('cb', 'base'), 'sync: an empty device takes the account data');

	// 7. Name.
	ok(!g2.s.setName('ab') && !g2.s.setName('<x>'), 'sync: bad names are refused'); ok(g2.s.setName('  Lucky Cog 7 '), 'sync: a good name is accepted'); eq(g2.s.name(), 'Lucky Cog 7', 'sync: the name is trimmed');
	g2.timers.advance(2100); await settle(); eq(g.cloud.docs.acct.name, 'Lucky Cog 7', 'sync: a new name is saved to the cloud');

	// 8. Signed out: only local. Reset gives a clean device.
	var o = make(); o.ps.setTierOwned('cb', 'base', true); o.timers.advance(5000); await settle(); eq(o.cloud.writes, 0, 'sync: no cloud write without an account'); eq(o.s.getStatus(), 'local', 'sync: status local without an account');
	o.s.resetLocal(); ok(o.ps.isEmpty(), 'sync: reset gives empty data'); eq(o.s.name(), '', 'sync: reset clears the name');

	// 9. Storage that throws (private window) does not crash. A corrupt record is ignored. A save over the document limit is not sent.
	var bad = { getItem: function () { throw new Error('no'); }, setItem: function () { throw new Error('no'); } };
	var p = make({ storage: bad }); p.ps.setTierOwned('cb', 'base', true); ok(!p.s.storageOk(), 'sync: a broken localStorage is reported'); ok(p.ps.hasTier('cb', 'base'), 'sync: the state still works in memory');
	var cs = fakeStorage(); cs.setItem(sync.SAVE_KEY, '{"state": [1]}'); var q = make({ storage: cs }); ok(q.ps.isEmpty(), 'sync: a corrupt local record is ignored');
	var big = make(); await big.s.attach('u9'); big.ps.setNovaInput('multiplier', 5);
	var origDict = big.ps.toDict; big.ps.toDict = function () { var d = origDict(); d.pad = 'x'.repeat(950000); return d; };
	big.timers.advance(2100); await settle(); eq(big.s.getStatus(), 'too_big', 'sync: a save over the document limit is flagged, not sent'); eq(big.cloud.writes, 0, 'sync: too big: nothing is written');
}
module.exports = { run: run };
