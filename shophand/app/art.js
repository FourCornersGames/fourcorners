/* Shop Hand private art (milestone W4, owner only).
   The droid images are never in the site files. After sign-in the page tries to read the Firestore collection
   private_art (first the index document private_art_index/main, 1 read; the listing only when the index is
   missing). The rules allow it only for an account listed in art_readers (set by the studio, not by the page).
   The page first reads its own art_readers record (a "missing" answer is a normal "no", no console error). Only a
   trusted account goes on: the images go in IndexedDB and show instead of the letter tiles. Anyone else stays with
   the letter tiles and makes no image request. The cache is cleared on sign-out, on a denied read and when the
   account changes, so a next person on the same browser never sees it. */
(function () {
	'use strict';
	var SH = window.SH = window.SH || {};
	var DB = 'shophand-art', STORE = 'png', META = 'meta', CHUNK = 10;
	var urls = Object.create(null);   // id -> blob URL
	var listeners = [];
	var dbp = null, checkedUid = '', running = false;

	function open() {
		if (dbp) return dbp;
		dbp = new Promise(function (resolve, reject) {
			if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
			var rq = indexedDB.open(DB, 1);
			rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); rq.result.createObjectStore(META); };
			rq.onsuccess = function () { resolve(rq.result); };
			rq.onerror = function () { reject(rq.error); };
		});
		dbp.catch(function () { dbp = null; });
		return dbp;
	}
	function tx(store, mode, fn) {
		return open().then(function (db) {
			return new Promise(function (resolve, reject) {
				var t = db.transaction(store, mode), s = t.objectStore(store), r = fn(s);
				t.oncomplete = function () { resolve(r && r.result); };
				t.onerror = t.onabort = function () { reject(t.error); };
			});
		});
	}
	function b64ToBlob(b64) {
		var bin = atob(b64), n = bin.length, a = new Uint8Array(n);
		for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
		return new Blob([a], { type: 'image/png' });
	}
	function setUrl(id, blob) {
		if (urls[id]) URL.revokeObjectURL(urls[id]);
		urls[id] = URL.createObjectURL(blob);
	}
	function notify() { listeners.slice().forEach(function (fn) { fn(); }); }

	var art = SH.art = {};
	art.onChange = function (fn) { listeners.push(fn); };
	art.has = function () { return Object.keys(urls).length > 0; };
	// The image for a droid (and variant). The variant image first, then the droid image. null = no image.
	art.url = function (droidId, tierId) {
		if (tierId && urls[droidId + '__' + tierId]) return urls[droidId + '__' + tierId];
		return urls[droidId] || null;
	};

	art.clear = function () {
		Object.keys(urls).forEach(function (k) { URL.revokeObjectURL(urls[k]); delete urls[k]; });
		checkedUid = '';
		var had = true;
		return open().then(function (db) {
			return new Promise(function (resolve) {
				var t = db.transaction([STORE, META], 'readwrite'); t.objectStore(STORE).clear(); t.objectStore(META).clear();
				t.oncomplete = t.onerror = t.onabort = function () { resolve(); };
			});
		}).catch(function () { had = false; }).then(function () { notify(); return had; });
	};

	// Called with the signed-in uid. cloud: SH.cloud.
	// First the page reads its own art_readers record (allowed for every signed-in player, a "no" is not an error).
	// Not trusted: no request for private_art at all. Trusted: the images load as below.
	// Signing in or linking again calls art.forget, so a newly trusted player is looked at again.
	try { localStorage.removeItem('shophand.artdenied'); } catch (e) { /* no storage; the old 10-minute marker is not used any more */ }
	art.forget = function () { checkedUid = ''; };
	art.check = function (uid, cloud) {
		if (!uid || running || checkedUid === uid) return Promise.resolve();
		running = true;
		var cached = {}, owner = '';
		function showCache() {
			return open().then(function () {
				return tx(META, 'readonly', function (s) { return s.get('uid'); }).then(function (u) { owner = u || ''; });
			}).then(function () {
				return tx(STORE, 'readonly', function (s) { return s.getAll(); });
			}).then(function (rowsv) {
				// Show the cache only for the account that filled it (it works offline for the owner).
				return tx(STORE, 'readonly', function (s) { return s.getAllKeys(); }).then(function (keys) {
					if (owner === uid) {
						keys.forEach(function (k, i) { var row = rowsv[i]; if (row && row.blob) { cached[k] = row.updated || 0; setUrl(k, row.blob); } });
						if (keys.length) notify();
					} else if (keys.length) { return art.clear(); }
				});
			}).catch(function () { /* no IndexedDB: the page works without the cache */ });
		}
		return cloud.isTrusted(uid).then(function (yes) {
			if (!yes) return art.clear().then(function () { checkedUid = uid; return null; });   // clear() resets checkedUid, so set it after
			return showCache().then(function () {
				// The index document is 1 read for all ids. When it is missing, list private_art as before (1 read for each image).
				return cloud.getArtIndex().then(function (idx) { return idx || cloud.listArt(); });
			});
		}).then(function (list) {
			if (!list) return;   // not trusted: letter tiles, no image request was made
			// Allowed. Fetch only the new or changed images: CHUNK documents in one request, 3 requests at a time.
			var todo = list.filter(function (x) { return !(x.id in cached) || (x.updated && x.updated > cached[x.id]); });
			var chunks = [], i = 0;
			for (var c = 0; c < todo.length; c += CHUNK) chunks.push(todo.slice(c, c + CHUNK));
			function worker() {
				if (i >= chunks.length) return Promise.resolve();
				var items = chunks[i++];
				return cloud.getArtMany(items.map(function (x) { return x.id; })).then(function (got) {
					return Promise.all(items.map(function (item) {
						var b64 = got[item.id];
						if (!b64) return;
						var blob = b64ToBlob(b64);
						setUrl(item.id, blob);
						return tx(STORE, 'readwrite', function (s) { return s.put({ blob: blob, updated: item.updated }, item.id); }).catch(function () { /* no room: it still shows this session */ });
					}));
				}).catch(function () { /* one chunk failed: the others still load, the next sign-in tries it again */ }).then(worker);
			}
			var gone = Object.keys(urls).filter(function (k) { return !list.some(function (x) { return x.id === k; }); });
			gone.forEach(function (k) { URL.revokeObjectURL(urls[k]); delete urls[k]; });
			return Promise.all([worker(), worker(), worker()]).then(function () {
				return tx(META, 'readwrite', function (s) { return s.put(uid, 'uid'); }).catch(function () {});
			}).then(function () { checkedUid = uid; notify(); });
		}, function (err) {
			if (err && err.code === 'denied') return art.clear().then(function () { checkedUid = uid; });   // fallback: the read was refused
			// offline or a server error: keep what is shown, try again at the next sign-in or page load
		}).then(function () { running = false; }, function () { running = false; });
	};
})();
