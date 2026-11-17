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
	var c = { docs: {}, clock: 5000, online: true, writes: 0, reads: 0, refused: 0, ver: 0, vers: {} };
	c.getSave = function (uid) {
		c.reads++;
		if (!c.online) return Promise.reject(offlineError());
		var d = c.docs[uid]; if (!d) return Promise.resolve(null);
		var out = JSON.parse(JSON.stringify(d)); out.version = c.vers[uid] || ''; return Promise.resolve(out);
	};
	// Like Firestore: expect {updateTime} or {exists:false} is checked on the server side; a failed check rejects with code "precondition".
	c.setSave = function (uid, p, expect) {
		if (!c.online) return Promise.reject(offlineError());
		var cur = c.docs[uid];
		if (expect && expect.updateTime && (!cur || c.vers[uid] !== expect.updateTime)) { c.refused++; return Promise.reject(Object.assign(new Error('precondition'), { code: 'precondition' })); }
		if (expect && expect.exists === false && cur) { c.refused++; return Promise.reject(Object.assign(new Error('precondition'), { code: 'precondition' })); }
		c.writes++; c.clock += 1000; c.ver++;
		c.docs[uid] = { state: JSON.parse(JSON.stringify(p.state)), name: p.name, updated: c.clock };
		c.vers[uid] = '2026-11-16T10:00:00.' + String(c.ver).padStart(9, '0') + 'Z';
		if (p.kind) c.docs[uid].kind = p.kind;
		return Promise.resolve({ updated: c.clock, version: c.vers[uid] });
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
		var s = sync.createSync({ kind: over && over.kind, ps: ps, storage: storage, cloud: cloud, timers: timers, now: function () { return timers.now; }, rng: function () { return 0; },
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
	a.cloud.online = true; await c.s.checkCloud({ force: true }); c.ps.setTierOwned('x_onk', 'base', true); c.timers.advance(2100); await settle();
	await d1.s.retryNow(); await settle();
	eq(d1.asked.length, 1, 'sync: both changed: the user is asked'); eq(d1.asked[0].sameAccount, true, 'sync: the question says it is the same account');
	ok(d1.asked[0].local.droids > 0 && d1.asked[0].cloud.droids > 0, 'sync: the question has both summaries');
	ok(d1.ps.hasTier('x_onk', 'base') && !d1.ps.hasTier('zro_tec', 'base'), 'sync: choice cloud takes the cloud data');
	ok(d1.s.getBackup() && d1.s.getBackup().summary.droids > 0, 'sync: the local data is kept as a backup');
	ok(d1.s.restoreBackup() && d1.ps.hasTier('zro_tec', 'base'), 'sync: the backup can be restored'); ok(d1.s.getBackup() !== null, 'sync: restoring keeps the replaced data as the new backup');
	// Choice "local" pushes the local data and keeps the cloud one as a backup.
	var e = make({ storage: fakeStorage(), cloud: a.cloud, answer: 'local' }); await e.s.attach('u1');
	a.cloud.online = false; e.ps.setTierOwned('lo', 'base', true); e.timers.advance(2100); await settle(); a.cloud.online = true;
	await c.s.checkCloud({ force: true }); c.ps.setTierOwned('wg_22', 'base', true); c.timers.advance(2100); await settle();
	await e.s.retryNow(); await settle();
	ok(a.cloud.docs.u1.state.owned.lo && !a.cloud.docs.u1.state.owned.wg_22, 'sync: choice local overwrites the cloud with this device');
	ok(e.s.getBackup() && e.s.getBackup().summary.droids > 0, 'sync: the cloud data is kept as a backup');
	// No answer: nothing changes and nothing is lost.
	var f = make({ storage: fakeStorage(), cloud: a.cloud, answer: null }); await f.s.attach('u1');
	a.cloud.online = false; f.ps.setTierOwned('b_u4d', 'base', true); f.timers.advance(2100); await settle(); a.cloud.online = true;
	await c.s.checkCloud({ force: true }); c.ps.setTierOwned('gonk', 'base', true); c.timers.advance(2100); await settle(); await f.s.retryNow(); await settle();
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

	// 8b. The account kind is saved with the data and refreshed after a link.
	var kk = { v: 'guest' }, kg = make({ kind: function () { return kk.v; } });
	await kg.s.attach('k1'); kg.ps.setTierOwned('cb', 'base', true); kg.timers.advance(2100); await settle();
	eq(kg.cloud.docs.k1.kind, 'guest', 'sync: a guest save has kind guest');
	kk.v = 'google'; kg.s.refreshKind(); kg.timers.advance(2100); await settle();
	eq(kg.cloud.docs.k1.kind, 'google', 'sync: after linking, the next save has the new kind');
	var ke = make({ kind: function () { return 'admin'; } }); await ke.s.attach('k2'); ke.ps.setTierOwned('cb', 'base', true); ke.timers.advance(2100); await settle();
	ok(!('kind' in ke.cloud.docs.k2), 'sync: an unknown kind is never saved');
	var kn = make(); await kn.s.attach('k3'); kn.s.refreshKind(); kn.timers.advance(2100); await settle(); eq(kn.cloud.writes, 0, 'sync: refreshKind writes nothing for an empty guest');

	// 9. Storage that throws (private window) does not crash. A corrupt record is ignored. A save over the document limit is not sent.
	var bad = { getItem: function () { throw new Error('no'); }, setItem: function () { throw new Error('no'); } };
	var p = make({ storage: bad }); p.ps.setTierOwned('cb', 'base', true); ok(!p.s.storageOk(), 'sync: a broken localStorage is reported'); ok(p.ps.hasTier('cb', 'base'), 'sync: the state still works in memory');
	var cs = fakeStorage(); cs.setItem(sync.SAVE_KEY, '{"state": [1]}'); var q = make({ storage: cs }); ok(q.ps.isEmpty(), 'sync: a corrupt local record is ignored');
	var big = make(); await big.s.attach('u9'); big.ps.setNovaInput('multiplier', 5);
	var origDict = big.ps.toDict; big.ps.toDict = function () { var d = origDict(); d.pad = 'x'.repeat(950000); return d; };
	big.timers.advance(2100); await settle(); eq(big.s.getStatus(), 'too_big', 'sync: a save over the document limit is flagged, not sent'); eq(big.cloud.writes, 0, 'sync: too big: nothing is written');

	// 10. Two devices on one account: every write carries the cloud version. A refused write never overwrites.
	async function pair(answerB) {
		var cl = fakeCloud();
		var A = make({ storage: fakeStorage(), cloud: cl }); await A.s.attach('acc');
		A.ps.setTierOwned('cb', 'base', true); A.timers.advance(2100); await settle();
		var B = make({ storage: fakeStorage(), cloud: cl, answer: answerB }); await B.s.attach('acc');
		ok(B.ps.hasTier('cb', 'base') && !B.s.isDirty(), 'two devices: B starts with the data of A');
		ok(typeof B.s.record().cloudVer === 'string' && B.s.record().cloudVer.length > 0, 'two devices: B keeps the cloud version it saw');
		return { cl: cl, A: A, B: B };
	}
	// 10a. A writes, B (changed, not knowing) writes: refused, asked, choice cloud. B's copy goes to the backup slot.
	var p1 = await pair('cloud');
	p1.A.ps.setTierOwned('mouse', 'base', true); p1.A.timers.advance(2100); await settle();
	p1.B.ps.setTierOwned('gonk', 'base', true); var w1 = p1.cl.writes; p1.B.timers.advance(2100); await settle();
	eq(p1.cl.refused, 1, 'two devices: the stale write is refused by the version check'); eq(p1.cl.writes, w1, 'two devices: the refused write changed nothing');
	eq(p1.B.asked.length, 1, 'two devices: the refusal asks the player'); eq(p1.B.asked[0].sameAccount, true, 'two devices: the question is for the same account');
	ok(p1.B.ps.hasTier('mouse', 'base') && !p1.B.ps.hasTier('gonk', 'base'), 'two devices: Load newer progress takes the cloud data');
	ok(p1.B.s.getBackup() && p1.B.s.getBackup().summary.marks === 2, 'two devices: the not-kept copy of B (cb + gonk) is in the backup slot');
	ok(!p1.cl.docs.acc.state.owned.gonk && p1.cl.docs.acc.state.owned.mouse, 'two devices: the cloud still has the data of A'); eq(p1.B.s.getStatus(), 'synced', 'two devices: synced after the choice'); ok(!p1.B.s.isDirty(), 'two devices: B is clean after loading');
	// 10b. Same, choice local: the cloud gets the save of B with a fresh version. A's copy is in the backup slot.
	var p2 = await pair('local');
	p2.A.ps.setTierOwned('mouse', 'base', true); p2.A.timers.advance(2100); await settle();
	p2.B.ps.setTierOwned('gonk', 'base', true); p2.B.timers.advance(2100); await settle();
	eq(p2.B.asked.length, 1, 'two devices: keep this device: asked once'); ok(p2.cl.docs.acc.state.owned.gonk && !p2.cl.docs.acc.state.owned.mouse, 'two devices: Keep this device writes the save of B over the cloud');
	ok(p2.B.s.getBackup() && p2.B.s.getBackup().summary.marks === 2, 'two devices: the cloud copy (cb + mouse) is in the backup slot'); eq(p2.B.s.getStatus(), 'synced', 'two devices: synced after keeping this device'); ok(!p2.B.s.isDirty(), 'two devices: B is clean after keeping');
	eq(p2.B.s.record().cloudVer, p2.cl.vers.acc, 'two devices: B holds the version it just wrote');
	// A sees the save of B later and takes it silently (A has no change).
	var dataEv = 0; p2.A.s.onData(function () { dataEv++; }); p2.A.timers.advance(20000); await p2.A.s.checkCloud(); await settle();
	ok(p2.A.ps.hasTier('gonk', 'base') && !p2.A.ps.hasTier('mouse', 'base'), 'two devices: A takes the newer cloud save'); eq(p2.A.asked.length, 0, 'two devices: no question when this device has no change'); eq(dataEv, 1, 'two devices: the page is told to draw again');
	// 10c. B not dirty: the comeback check takes the save of A silently, and no write happens.
	var p3 = await pair('local');
	p3.A.ps.setTierOwned('mouse', 'base', true); p3.A.timers.advance(2100); await settle();
	var w3 = p3.cl.writes; p3.B.timers.advance(16000); await p3.B.s.checkCloud(); await settle();
	ok(p3.B.ps.hasTier('mouse', 'base'), 'comeback: a clean device takes the newer cloud save'); eq(p3.B.asked.length, 0, 'comeback: no question for a clean device'); eq(p3.cl.writes, w3, 'comeback: nothing is written'); ok(p3.B.s.getBackup() === null, 'comeback: no backup needed for a silent take');
	// 10d. Sleeping tab: B is old, A changed the cloud, B wakes and the player changes something. The check asks, nothing is written.
	var p4 = await pair(null);
	p4.A.ps.setTierOwned('mouse', 'base', true); p4.A.timers.advance(2100); await settle();
	p4.B.timers.advance(3 * 3600 * 1000); p4.B.ps.setTierOwned('gonk', 'base', true); var w4 = p4.cl.writes;
	await p4.B.s.checkCloud(); await settle();
	eq(p4.B.asked.length, 1, 'sleeping tab: the check on waking asks the player'); eq(p4.cl.writes, w4, 'sleeping tab: nothing written before the choice'); ok(!p4.cl.docs.acc.state.owned.gonk, 'sleeping tab: the cloud still has A only');
	// 10e. Sleeping tab, the waiting write fires before any check: the version check refuses it. Nothing is lost.
	var p5 = await pair(null);
	p5.A.ps.setTierOwned('mouse', 'base', true); p5.A.timers.advance(2100); await settle();
	p5.B.ps.setTierOwned('gonk', 'base', true); p5.B.timers.advance(2100); await settle();
	eq(p5.cl.refused, 1, 'sleeping tab: the write that fires first is refused'); ok(p5.cl.docs.acc.state.owned.mouse && !p5.cl.docs.acc.state.owned.gonk, 'sleeping tab: the cloud is not overwritten'); ok(p5.B.ps.hasTier('gonk', 'base'), 'sleeping tab: B still has its change');
	// 10f. Escape (no answer): both sides stay as they are, no write, and the next check asks again.
	eq(p5.B.s.getStatus(), 'conflict', 'escape: the conflict stays open'); ok(p5.B.s.isDirty(), 'escape: B stays changed'); eq(p5.B.asked.length, 1, 'escape: asked once so far');
	var w5 = p5.cl.writes; p5.B.ps.setTierOwned('b_u4d', 'base', true); p5.B.timers.advance(30000); await settle(); eq(p5.cl.writes, w5, 'escape: more changes are not written while the conflict is open');
	await p5.B.s.checkCloud(); await settle(); eq(p5.B.asked.length, 2, 'escape: the next check asks again'); eq(p5.cl.writes, w5, 'escape: still no write'); ok(p5.B.ps.hasTier('b_u4d', 'base') && p5.B.ps.hasTier('gonk', 'base'), 'escape: B keeps all its changes');
	ok(p5.B.s.getBackup() === null, 'escape: no backup is made without a choice');
	// 10g. A question that is still open is not asked twice.
	var p6 = await pair(null), openQ = null, pend = new Promise(function (r) { openQ = r; }), asks = 0;
	p6.A.ps.setTierOwned('mouse', 'base', true); p6.A.timers.advance(2100); await settle();
	var S6 = sync.createSync({ ps: p6.B.ps, storage: p6.B.storage, cloud: p6.cl, timers: p6.B.timers, now: function () { return p6.B.timers.now; }, askConflict: function () { asks++; return pend; } });
	S6.loadLocal(); S6.start(); await S6.attach('acc'); await settle(); eq(asks, 0, 'open question: a clean device takes the cloud data without asking');
	p6.A.ps.setTierOwned('gonk', 'base', true); p6.A.timers.advance(2100); await settle(); p6.B.ps.setTierOwned('b_u4d', 'base', true);
	var r1 = S6.checkCloud({ force: true }), r2 = S6.checkCloud({ force: true }); await settle(); eq(asks, 1, 'open question: one dialog only'); openQ('cloud'); await r1; await r2; await settle(); ok(p6.B.ps.hasTier('gonk', 'base'), 'open question: the answer is used');
	// 10h. Offline, then online: the change still goes out when the cloud did not change.
	var p7 = await pair(null);
	p7.cl.online = false; p7.B.ps.setTierOwned('gonk', 'base', true); p7.B.timers.advance(2100); await settle(); eq(p7.B.s.getStatus(), 'offline', 'offline: shows offline'); p7.cl.online = true;
	await p7.B.s.checkCloud({ force: true }); await settle(); eq(p7.B.s.getStatus(), 'synced', 'offline: the online check pushes'); ok(p7.cl.docs.acc.state.owned.gonk, 'offline: the change is in the cloud'); eq(p7.B.asked.length, 0, 'offline: no question when the cloud did not change'); eq(p7.cl.refused, 0, 'offline: nothing refused');
	// 10i. Throttle: at most one read per 15 s for the comeback checks. Offline or error is not throttled.
	var p8 = await pair(null); p8.B.timers.advance(16000); var rd = p8.cl.reads;
	await p8.B.s.checkCloud(); await p8.B.s.checkCloud(); await settle(); eq(p8.cl.reads - rd, 1, 'throttle: two checks in a row read once');
	rd = p8.cl.reads; p8.B.timers.advance(5000); await p8.B.s.checkCloud(); eq(p8.cl.reads, rd, 'throttle: no read after 5 s'); p8.B.timers.advance(11000); await p8.B.s.checkCloud(); await settle(); eq(p8.cl.reads, rd + 1, 'throttle: one read after 16 s');
	// 10j. A device that thinks there is no cloud doc while one exists: the write is refused (exists=false), the player is asked.
	var cl9 = fakeCloud(), n1 = make({ storage: fakeStorage(), cloud: cl9, answer: 'cloud' }); n1.ps.setTierOwned('cb', 'base', true);
	var n0 = make({ storage: fakeStorage(), cloud: cl9 }); await n0.s.attach('acc9'); n0.ps.setTierOwned('mouse', 'base', true); n0.timers.advance(2100); await settle();
	await n1.s.attach('acc9'); await settle(); ok(n1.asked.length === 1 && cl9.docs.acc9.state.owned.mouse && !cl9.docs.acc9.state.owned.cb, 'new doc: local data against an existing doc asks and does not overwrite');
	// 10k. A record saved before this version (cloudSeen only, no version): the first write reads the cloud first, then writes.
	var oldSt = fakeStorage(), oc = fakeCloud(); var o1 = make({ storage: oldSt, cloud: oc }); await o1.s.attach('old'); o1.ps.setTierOwned('cb', 'base', true); o1.timers.advance(2100); await settle();
	var rec = JSON.parse(oldSt.getItem(sync.SAVE_KEY)); delete rec.cloudVer; oldSt.setItem(sync.SAVE_KEY, JSON.stringify(rec));
	var o2 = make({ storage: oldSt, cloud: oc }); eq(o2.s.record().cloudVer, '', 'old record: no version yet'); o2.ps.setTierOwned('mouse', 'base', true); await o2.s.attach('old'); o2.timers.advance(2100); await settle();
	ok(oc.docs.old.state.owned.mouse, 'old record: the change is written'); ok(o2.s.record().cloudVer === oc.vers.old, 'old record: the version is learned'); eq(oc.refused, 0, 'old record: nothing refused'); eq(o2.asked.length, 0, 'old record: no question');
	// 10l. Nothing new is stored: the local record has the same keys plus the version, and the cloud doc has the same keys.
	eq(Object.keys(JSON.parse(p3.B.storage.getItem(sync.SAVE_KEY))).sort(), ['cloudSeen', 'cloudVer', 'dirty', 'edited', 'name', 'state', 'uid', 'v'], 'privacy: the local record only gains the version');
	eq(Object.keys(p3.cl.docs.acc).sort(), ['name', 'state', 'updated'], 'privacy: the cloud doc has the same fields as before');
	// 10m. Online saving off: no check, no write.
	var p10 = await pair(null); p10.B.s.forgetAccount(); eq(p10.B.s.record().cloudVer, '', 'forget: the version is cleared'); var r10 = p10.cl.reads; await p10.B.s.checkCloud({ force: true }); eq(p10.cl.reads, r10, 'forget: no check without an account');
	// 11. Two tabs of one browser share the local record (no account). The page passes the "storage" event to takeFromOtherTab.
	var shared = fakeStorage(), t1 = make({ storage: shared, cloud: fakeCloud() }), t2 = make({ storage: shared, cloud: fakeCloud() });
	t1.ps.setTierOwned('cb', 'base', true);
	var written = shared.getItem(sync.SAVE_KEY);
	ok(t2.s.takeFromOtherTab(written), 'tabs: the other tab takes the record');
	ok(t2.ps.toDict().owned && t2.ps.toDict().owned.cb, 'tabs: the other tab shows the change');
	eq(shared.getItem(sync.SAVE_KEY), written, 'tabs: taking the record writes nothing back (no loop)');
	t2.ps.setTierOwned('mouse', 'base', true);
	var both = JSON.parse(shared.getItem(sync.SAVE_KEY)).state.owned;
	ok(both.cb && both.mouse, 'tabs: a change in the second tab keeps the first tab\'s change');
	ok(!t2.s.takeFromOtherTab('{not json'), 'tabs: a broken record is ignored');
	ok(t2.ps.toDict().owned.mouse, 'tabs: a broken record changes nothing');
}
module.exports = { run: run };
