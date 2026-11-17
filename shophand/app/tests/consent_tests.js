/* Tests of the W5 consent rule: consent.js, the guest-account guard in cloud.js, and sync.forgetAccount. */
'use strict';
var consent = require('../consent.js');
var st = require('../state.js');
var sync = require('../sync.js');

function fakeStorage(opts) {
	var m = {}, blocked = opts && opts.blocked;
	return {
		getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
		setItem: function (k, v) { if (blocked) throw new Error('blocked'); m[k] = String(v); },
		removeItem: function (k) { delete m[k]; }, _m: m
	};
}
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

// A fake Firebase: counts the guest sign-ins.
function installFirebase(persistedUser) {
	var handlers = [], fake = { guests: 0, loadedApps: 0 };
	var auth = { currentUser: persistedUser || null, languageCode: '' };
	auth.onAuthStateChanged = function (fn) {
		handlers.push(fn);
		setImmediate(function () { fn(auth.currentUser); });   // like the real SDK: the first call is async
		return function () { handlers = handlers.filter(function (h) { return h !== fn; }); };
	};
	auth.signInAnonymously = function () {
		fake.guests++;
		return new Promise(function (resolve) { setImmediate(function () { auth.currentUser = { uid: 'g' + fake.guests, isAnonymous: true, providerData: [] }; handlers.slice().forEach(function (h) { h(auth.currentUser); }); resolve({}); }); });
	};
	auth.signOut = function () { auth.currentUser = null; handlers.slice().forEach(function (h) { h(null); }); return Promise.resolve(); };
	fake.auth = auth;
	fake.fire = function (u) { auth.currentUser = u; handlers.slice().forEach(function (h) { h(u); }); };
	global.firebase = { apps: [], initializeApp: function () { fake.loadedApps++; global.firebase.apps.push({}); }, auth: function () { return auth; } };
	return fake;
}
function freshCloud() {
	delete require.cache[require.resolve('../cloud.js')];
	global.window = { SH: { state: st }, SH_FIREBASE: { projectId: 'p' }, addEventListener: function () {} };
	global.document = {};
	require('../cloud.js');
	return global.window.SH.cloud;
}

async function run(h) {
	var ok = h.ok, eq = h.eq;

	/* consent.js */
	var s = fakeStorage(), c = consent.create(s, function () { return new Date('2026-11-16T12:00:00Z'); });
	ok(!c.has() && c.get() === null, 'consent: none at the start');
	ok(!c.grant(false) && !c.has(), 'consent: the box not ticked gives no consent');
	ok(!c.grant('yes') && !c.has(), 'consent: only true counts as ticked');
	ok(c.grant(true) && c.has(), 'consent: granted when ticked');
	eq(c.get(), { v: consent.POLICY_VERSION, at: '2026-11-16T12:00:00.000Z', age14: true }, 'consent: the stored record');
	eq(JSON.parse(s.getItem(consent.KEY)).age14, true, 'consent: stored under shophand.consent');
	eq(consent.KEY, 'shophand.consent', 'consent: the key');
	var prev = c.get(); c.revoke(); ok(!c.has(), 'consent: revoke removes it'); c.restore(prev); ok(c.has(), 'consent: restore puts it back');
	['not json', '[]', '{"v":"x","at":"2026-11-16T00:00:00Z"}', '{"v":"x","at":"2026-11-16T00:00:00Z","age14":false}', '{"v":"","at":"2026-11-16T00:00:00Z","age14":true}',
		'{"v":"x","at":"nope","age14":true}', '{"v":1,"at":"2026-11-16T00:00:00Z","age14":true}', 'null'].forEach(function (bad, i) {
		var bs = fakeStorage(); bs.setItem(consent.KEY, bad); ok(!consent.create(bs).has(), 'consent: bad record ' + i + ' is not consent');
	});
	var blocked = consent.create(fakeStorage({ blocked: true })); ok(!blocked.grant(true) && !blocked.has(), 'consent: blocked storage gives no consent');
	var thrower = consent.create({ getItem: function () { throw new Error('x'); }, setItem: function () {}, removeItem: function () { throw new Error('x'); } });
	ok(!thrower.has(), 'consent: a storage that throws gives no consent'); thrower.revoke(); ok(true, 'consent: revoke does not throw');

	/* cloud.js: no guest account without consent */
	var want = false, fb = installFirebase(null), cloud = freshCloud();
	ok(cloud.init('fr', function () { return want; }), 'cloud: init works once the SDK is there'); eq(fb.auth.languageCode, 'fr', 'cloud: the sign-in language is the page language');
	await tick(); await tick(); eq(fb.guests, 0, 'cloud: no guest account at load without consent');
	fb.fire(null); await tick(); eq(fb.guests, 0, 'cloud: no guest account after sign-out without consent');
	want = true; fb.fire(null); await tick(); await tick(); eq(fb.guests, 1, 'cloud: with consent, a missing user gets one guest account');
	fb.fire(null); want = false; await tick(); await tick(); eq(fb.guests, 1, 'cloud: after consent is revoked, no new guest account (sign-out or delete)');

	/* cloud.enable: one guest account, also when the listener fires at the same time */
	fb = installFirebase(null); cloud = freshCloud(); want = true;
	await cloud.enable('en', function () { return want; }); await tick(); await tick();
	eq(fb.guests, 1, 'cloud: enable makes exactly one guest account'); eq(fb.auth.languageCode, 'en', 'cloud: enable sets the language');
	fb = installFirebase({ uid: 'old', isAnonymous: false, providerData: [{ providerId: 'google.com' }] }); cloud = freshCloud();
	await cloud.enable('en', function () { return true; }); await tick(); eq(fb.guests, 0, 'cloud: enable keeps a saved sign-in and makes no guest account');
	ok(!cloud.init || cloud.available, 'cloud: available after enable');
	delete global.firebase; cloud = freshCloud(); ok(!cloud.init('en'), 'cloud: init is false without the SDK (the SDK is not loaded before consent)');
	ok(!cloud.available, 'cloud: not available before the SDK is loaded');

	/* sync.forgetAccount: the data stays, the account link goes, a later opt-in pushes as new data */
	function mk() {
		var ps = h.newPs(), storage = fakeStorage(), docs = {}, writes = 0;
		var cl = { getSave: function (uid) { return Promise.resolve(docs[uid] ? JSON.parse(JSON.stringify(docs[uid])) : null); },
			setSave: function (uid, p) { writes++; docs[uid] = { state: JSON.parse(JSON.stringify(p.state)), name: p.name, updated: 1000 + writes }; return Promise.resolve({ updated: 1000 + writes }); } };
		var timers = { set: function (fn) { return setTimeout(fn, 0); }, clear: function (x) { clearTimeout(x); } };
		var sy = sync.createSync({ ps: ps, storage: storage, cloud: cl, timers: timers, rng: function () { return 0; }, askConflict: function () { return Promise.resolve(null); } });
		sy.loadLocal(); sy.start();
		return { ps: ps, sy: sy, docs: docs, writes: function () { return writes; }, storage: storage };
	}
	var a = mk(); await a.sy.attach('u1'); a.ps.setTierOwned('cb', 'base', true); await a.sy.flush(); await tick();
	ok(a.docs.u1, 'forget: the first account has the save');
	await a.sy.attach(''); a.sy.forgetAccount();
	eq(a.sy.getStatus(), 'local', 'forget: status is local'); ok(a.ps.hasTier('cb', 'base'), 'forget: the data stays on the device');
	eq(JSON.parse(a.storage.getItem(sync.SAVE_KEY)).uid, '', 'forget: the record has no account'); ok(!a.sy.isDirty(), 'forget: nothing is waiting to be pushed');
	var w = a.writes(); a.ps.setTierOwned('lo', 'base', true); await tick(); await tick(); eq(a.writes(), w, 'forget: no cloud write while online saving is off');
	await a.sy.attach('u2'); await tick(); await tick();
	ok(a.docs.u2 && a.docs.u2.state.owned.cb, 'forget: a new opt-in uploads the local save to the new account without a question');

	/* W5: rebirth checks (which of the 3 required droids are obtained) */
	var rp = h.newPs(), offers = [];
	rp.onUndo(function (i) { offers.push(i); });
	ok(!rp.rebirthCheck(1, 3, 0) && !('rebirth_checks' in rp.toDict()), 'rebirth checks: none at the start, and no key in an unused save');
	rp.toggleRebirthCheckWithUndo(1, 3, 1);
	ok(rp.rebirthCheck(1, 3, 1) && !rp.rebirthCheck(1, 3, 0) && !rp.rebirthCheck(2, 3, 1) && !rp.rebirthCheck(1, 4, 1), 'rebirth checks: a tap marks one droid of one rebirth of one path');
	eq(rp.toDict().rebirth_checks, { '1:3': [false, true, false] }, 'rebirth checks: saved as "<path>:<number>": [bool, bool, bool]');
	ok(!rp.isEmpty(), 'rebirth checks: a check counts as data (an empty guest does not overwrite it)');
	eq(offers.length, 1, 'rebirth checks: a tap offers undo'); eq(offers[0].kind, 'rebirth_check', 'rebirth checks: the undo info has its own kind');
	rp.restoreSnapshot(offers[0].snapshot); ok(!rp.rebirthCheck(1, 3, 1) && !('rebirth_checks' in rp.toDict()), 'rebirth checks: undo clears the check and the empty row');
	rp.toggleRebirthCheckWithUndo(1, 3, 0); rp.toggleRebirthCheckWithUndo(1, 3, 0); ok(!rp.rebirthCheck(1, 3, 0), 'rebirth checks: a second tap clears it');
	rp.setRebirthCheck(1, 3, 3, true); rp.setRebirthCheck(1, 3, -1, true); ok(!('rebirth_checks' in rp.toDict()), 'rebirth checks: a bad index is ignored');
	rp.toggleRebirthCheckWithUndo(2, 5, 2); rp.toggleRebirthCheckWithUndo(2, 5, 0); offers.length = 0; rp.toggleRebirthCheckWithUndo(2, 5, 0);
	rp.restoreSnapshot(offers[0].snapshot); ok(rp.rebirthCheck(2, 5, 0) && rp.rebirthCheck(2, 5, 2), 'rebirth checks: undo puts the old row back');
	var text = rp.exportJson(), rp2 = h.newPs(); ok(rp2.importJson(text).ok, 'rebirth checks: a web backup with the key imports');
	ok(rp2.rebirthCheck(2, 5, 0) && rp2.rebirthCheck(2, 5, 2) && !rp2.rebirthCheck(2, 5, 1), 'rebirth checks: the import restores them');
	var android = JSON.parse(text); delete android.rebirth_checks; android.rebirth_number = 4;
	var rp3 = h.newPs(); rp3.setRebirthCheck(1, 1, 0, true); ok(rp3.importJson(JSON.stringify(android)).ok, 'rebirth checks: an Android backup without the key imports');
	ok(!rp3.rebirthCheck(1, 1, 0) && rp3.rebirthNumber === 4 && !('rebirth_checks' in rp3.toDict()), 'rebirth checks: no key means no checks (the import replaces the state)');
	var bad = JSON.parse(text); bad.rebirth_checks = { '1:2': [true, 'yes', 1, true], 'x': [true], '1:99999': [true], '3:4': 'no', '99:9': [false, false, false], '5:6': [true] };
	var rp4 = h.newPs(); rp4.importJson(JSON.stringify(bad));
	eq(rp4.toDict().rebirth_checks, { '1:2': [true, false, false], '5:6': [true, false, false] }, 'rebirth checks: bad keys and values are cleaned');
	var rp5 = h.newPs(); rp5.importJson(JSON.stringify(Object.assign(JSON.parse(text), { rebirth_checks: [1, 2] }))); ok(!('rebirth_checks' in rp5.toDict()), 'rebirth checks: a wrong type is ignored');
	var many = {}; for (var i = 0; i < 2500; i++) many[(1 + i % 90) + ':' + i] = [true, false, false];
	var rp6 = h.newPs(); rp6.importJson(JSON.stringify(Object.assign(JSON.parse(text), { rebirth_checks: many }))); ok(Object.keys(rp6.toDict().rebirth_checks).length <= 2000, 'rebirth checks: at most 2000 rows are kept');
}
module.exports = { run: run };
