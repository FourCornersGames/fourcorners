/* Shop Hand save and sync (milestone W4). The rule is described at the top of state.js.
   No DOM and no network here: the storage, the cloud and the timers are given in, so Node tests can drive it.
   Privacy rule: the only things saved are the game state and a player name (a friendly name the player may change).
   An email, a Google display name, a photo or any provider data is never written to localStorage or Firestore. */
(function (root, factory) {
	'use strict';
	var dom = typeof module === 'object' && module.exports ? require('./domain.js') : root.SH.domain;
	var st = typeof module === 'object' && module.exports ? require('./state.js') : root.SH.state;
	var api = factory(dom, st);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.SH = root.SH || {}; root.SH.sync = api; }
})(typeof self !== 'undefined' ? self : this, function (dom, st) {
	'use strict';

	var SAVE_KEY = 'shophand.save';
	var BACKUP_KEY = 'shophand.backup';
	var DEBOUNCE_MS = 2000, MAX_WAIT_MS = 10000, RETRY_MIN_MS = 2000, RETRY_MAX_MS = 60000;
	var MAX_DOC_BYTES = 900000; // The Firestore limit is 1 MB per document.

	// opts: {ps, storage {getItem,setItem,removeItem}, cloud {getSave,setSave}, now(), timers {set, clear}, askConflict(info), rng, kind() -> guest|google|email}
	function createSync(opts) {
		var ps = opts.ps, storage = opts.storage, cloud = opts.cloud;
		var now = opts.now || function () { return Date.now(); };
		var timers = opts.timers || { set: function (fn, ms) { return setTimeout(fn, ms); }, clear: function (h) { clearTimeout(h); } };
		var listeners = [];
		var rec = { v: 1, state: null, dirty: false, cloudSeen: 0, uid: '', name: '', edited: 0 };
		var status = 'local'; // local, syncing, synced, offline, error, conflict, too_big
		var uid = '';
		var editCount = 0, debounceT = null, firstEditAt = 0, retryT = null, retryN = 0, busy = false, again = false, storageOk = true;
		var self = {};

		function setStatus(s) { if (s !== status) { status = s; emit(); } }
		function emit() { listeners.slice().forEach(function (fn) { fn(status); }); }
		self.onStatus = function (fn) { listeners.push(fn); };
		self.getStatus = function () { return status; };
		self.name = function () { return rec.name; };
		self.uid = function () { return uid; };
		self.isDirty = function () { return rec.dirty; };
		self.storageOk = function () { return storageOk; };
		self.record = function () { return rec; };

		function persist() {
			rec.state = ps.toDict();
			try { storage.setItem(SAVE_KEY, JSON.stringify(rec)); storageOk = true; } catch (e) { storageOk = false; }
		}

		// Read the local record. Applies it to the player state. Returns true when there was a record.
		self.loadLocal = function () {
			var text = null;
			try { text = storage.getItem(SAVE_KEY); } catch (e) { storageOk = false; }
			if (!text || text.length > st.MAX_IMPORT_BYTES * 2) return false;
			var r = null;
			try { r = JSON.parse(text); } catch (e) { r = null; }
			if (!dom.isObj(r) || !dom.isObj(r.state) || st.tooDeep(r.state)) return false;
			ps.applyDict(r.state);
			rec = { v: 1, state: r.state, dirty: r.dirty === true, cloudSeen: dom.isNum(r.cloudSeen) ? r.cloudSeen : 0,
				uid: dom.isStr(r.uid) ? r.uid : '', name: st.validName(r.name) || '', edited: dom.isNum(r.edited) ? r.edited : 0 };
			return true;
		};

		// Start saving: every change goes to localStorage at once and to the cloud after a short wait.
		self.start = function () {
			ps.onChange(function () {
				editCount++;
				rec.dirty = true; rec.edited = now();
				persist();
				schedulePush();
			});
		};

		function schedulePush() {
			if (!uid) { setStatus('local'); return; }
			if (!firstEditAt) firstEditAt = now();
			if (debounceT) timers.clear(debounceT);
			var wait = Math.min(DEBOUNCE_MS, Math.max(MAX_WAIT_MS - (now() - firstEditAt), 0));
			debounceT = timers.set(function () { debounceT = null; firstEditAt = 0; self.flush(); }, wait);
		}

		// "guest", "google" or "email" from opts.kind (a function), or '' when not known. Never anything else about the account.
		function currentKind() {
			var k = opts.kind ? opts.kind() : '';
			return k === 'guest' || k === 'google' || k === 'email' ? k : '';
		}
		function ensureName() {
			if (!rec.name) { rec.name = st.randomName(opts.rng); persist(); }
			return rec.name;
		}

		// Push now when there is something to push. Resolves when done (also when it failed: see the status).
		self.flush = function () {
			if (!uid || !rec.dirty) return Promise.resolve();
			if (busy) { again = true; return Promise.resolve(); }
			if (debounceT) { timers.clear(debounceT); debounceT = null; firstEditAt = 0; }
			return pushNow();
		};

		function pushNow() {
			var myUid = uid, v = editCount, dict = ps.toDict();
			if (JSON.stringify(dict).length > MAX_DOC_BYTES) { setStatus('too_big'); return Promise.resolve(); }
			busy = true; setStatus('syncing');
			return Promise.resolve().then(function () { return cloud.setSave(myUid, { state: dict, name: ensureName(), kind: currentKind() }); }).then(function (res) {
				busy = false;
				if (myUid !== uid) return;
				rec.cloudSeen = res.updated; retryN = 0;
				if (editCount === v) rec.dirty = false;
				persist();
				if (rec.dirty || again) { again = false; schedulePush(); } else setStatus('synced');
			}, function (err) {
				busy = false; again = false;
				if (err && err.code === 'offline') { setStatus('offline'); scheduleRetry(); }
				else { setStatus('error'); scheduleRetry(); }
			});
		}

		function scheduleRetry() {
			if (retryT) timers.clear(retryT);
			var wait = Math.min(RETRY_MIN_MS * Math.pow(2, retryN), RETRY_MAX_MS); retryN++;
			retryT = timers.set(function () { retryT = null; self.retryNow(); }, wait);
		}
		// Called when the browser says it is online again, or when the page becomes visible.
		self.retryNow = function (force) {
			if (!uid) return Promise.resolve();
			if (retryT) { timers.clear(retryT); retryT = null; }
			if (status === 'conflict' && !force) return Promise.resolve();
			return reconcile();
		};

		function summary(dict, cloudUpdated) {
			var d = dict || {}, n = 0;
			if (dom.isObj(d.owned)) Object.keys(d.owned).forEach(function (k) { if (Array.isArray(d.owned[k]) && d.owned[k].length) n++; });
			var marks = 0;
			if (dom.isObj(d.owned)) Object.keys(d.owned).forEach(function (k) { if (Array.isArray(d.owned[k])) marks += d.owned[k].length; });
			return { droids: n, marks: marks, rebirth: dom.toInt(d.rebirth_number), updated: cloudUpdated || 0 };
		}

		function stashBackup(dict, reason) {
			try { storage.setItem(BACKUP_KEY, JSON.stringify({ v: 1, state: dict, saved: now(), reason: reason })); } catch (e) { /* no room: the user still has the choice dialog */ }
		}
		self.stashBackup = function (dict, reason) { stashBackup(dict, reason || 'replaced by an import'); };
		self.getBackup = function () {
			try {
				var b = JSON.parse(storage.getItem(BACKUP_KEY));
				return dom.isObj(b) && dom.isObj(b.state) ? { summary: summary(b.state), saved: b.saved, reason: b.reason } : null;
			} catch (e) { return null; }
		};
		// Put the saved backup back as the current data. The data it replaces becomes the new backup.
		self.restoreBackup = function () {
			var b = null;
			try { b = JSON.parse(storage.getItem(BACKUP_KEY)); } catch (e) { b = null; }
			if (!dom.isObj(b) || !dom.isObj(b.state)) return false;
			var current = ps.toDict();
			stashBackup(current, 'restore');
			ps.applyDict(b.state); markChanged(); emitData();
			return true;
		};
		function markChanged() { editCount++; rec.dirty = true; rec.edited = now(); persist(); schedulePush(); }

		function adopt(cloudDoc) {
			ps.applyDict(cloudDoc.state);
			rec.uid = uid; rec.cloudSeen = cloudDoc.updated; rec.dirty = false; rec.edited = now();
			if (st.validName(cloudDoc.name)) rec.name = st.validName(cloudDoc.name);
			persist();
		}

		// Compare this device with the cloud doc of the signed-in account. See decideSync.
		function reconcile() {
			if (!uid || busy) return Promise.resolve();
			var myUid = uid;
			return Promise.resolve().then(function () { return cloud.getSave(myUid); }).then(function (doc) {
				if (myUid !== uid) return;
				var empty = ps.isEmpty();
				var choice = st.decideSync({ empty: empty, uid: rec.uid, dirty: rec.dirty, cloudSeen: rec.cloudSeen }, doc, myUid);
				if (choice === 'none') {
					if (rec.uid !== myUid) { rec.uid = myUid; if (doc) { rec.cloudSeen = doc.updated; if (st.validName(doc.name)) rec.name = st.validName(doc.name); } persist(); }
					setStatus('synced'); return;
				}
				if (choice === 'pull') { adopt(doc); retryN = 0; setStatus('synced'); emitData(); return; }
				if (choice === 'push') {
					if (doc && st.validName(doc.name)) rec.name = st.validName(doc.name);
					rec.uid = myUid; if (doc) rec.cloudSeen = doc.updated; rec.dirty = true; persist(); return pushNow();
				}
				// conflict: both sides have data. Ask. Nothing is dropped before the user chooses.
				setStatus('conflict');
				var info = { local: summary(ps.toDict()), cloud: summary(doc.state, doc.updated), sameAccount: rec.uid === myUid };
				return Promise.resolve(opts.askConflict ? opts.askConflict(info) : null).then(function (pick) {
					if (myUid !== uid) return;
					if (pick === 'cloud') { stashBackup(ps.toDict(), 'local before taking the account data'); adopt(doc); setStatus('synced'); emitData(); }
					else if (pick === 'local') {
						stashBackup(doc.state, 'account data before keeping this device');
						if (st.validName(doc.name)) rec.name = st.validName(doc.name);
						rec.uid = myUid; rec.cloudSeen = doc.updated; rec.dirty = true; persist(); return pushNow();
					}
					// no answer: stay in "conflict". The next start asks again.
				});
			}, function (err) {
				if (err && err.code === 'offline') { setStatus('offline'); scheduleRetry(); }
				else { setStatus('error'); scheduleRetry(); }
			});
		}
		var dataListeners = [];
		self.onData = function (fn) { dataListeners.push(fn); };
		function emitData() { dataListeners.slice().forEach(function (fn) { fn(); }); }

		// The signed-in account is known (or changed). Pass '' when signed out.
		self.attach = function (newUid) {
			uid = newUid || '';
			retryN = 0;
			if (!uid) { setStatus('local'); return Promise.resolve(); }
			return reconcile();
		};

		// The player changes the name. Returns true when the name is valid.
		self.setName = function (n) {
			var v = st.validName(n);
			if (!v) return false;
			if (v === rec.name) return true;
			rec.name = v; markChanged();
			return true;
		};

		// Start again with empty data (after sign-out or after deleting the account).
		self.resetLocal = function () {
			ps.reset();
			rec = { v: 1, state: null, dirty: false, cloudSeen: 0, uid: '', name: '', edited: 0 };
			editCount++;
			persist();
		};
		// After linking or switching: the record now belongs to this account.
		self.claim = function (newUid) { rec.uid = newUid; persist(); };
		// The sign-in kind changed (a link was added): save again so users/{uid}.kind is current. Skips an empty guest.
		self.refreshKind = function () { if (uid && !ps.isEmpty()) markChanged(); };

		return self;
	}

	return { createSync: createSync, SAVE_KEY: SAVE_KEY, BACKUP_KEY: BACKUP_KEY, DEBOUNCE_MS: DEBOUNCE_MS, MAX_WAIT_MS: MAX_WAIT_MS };
});
