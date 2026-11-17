/* Shop Hand cloud (milestone W4): sign-in with the self-hosted Firebase Auth SDK, and the save with the Firestore REST API.
   Why REST for the save: it fails fast when offline (the sync queue in sync.js retries), it needs no big SDK file,
   and /dev/gateway.js and /dev/yarntoss use the same approach. Only sign-in needs the SDK (Google pop-up, email link).
   Privacy rule: an email, a Google name, a photo or provider data is never read into the page state, never written
   to localStorage and never written to Firestore. The email an email link needs is kept in memory only. */
(function () {
	'use strict';
	var SH = window.SH = window.SH || {};
	var st = SH.state;
	var cfg = window.SH_FIREBASE;
	var BASE = 'https://firestore.googleapis.com/v1/projects/' + cfg.projectId + '/databases/(default)/documents';
	var DB_NAME = 'projects/' + cfg.projectId + '/databases/(default)/documents';
	var TIMEOUT_MS = 15000;

	var cloud = SH.cloud = { available: false };
	var auth = null, userListeners = [], firstState = false, guestTimer = null, pendingEmail = '';

	function codeError(message, code, extra) { var e = new Error(message); e.code = code; if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); return e; }

	/* ---------- auth ---------- */

	// The Firebase sign-in files are loaded only after the player turns on online saving (see consent.js).
	// Before that, the page makes no request to Firebase or Google.
	var VENDOR = ['/shophand/app/vendor/firebase-app-compat.js', '/shophand/app/vendor/firebase-auth-compat.js'].map(function (u) { return SH.versioned ? SH.versioned(u) : u; });   // ?v=release, see ui.js
	var loading = null;
	function loadScript(src) {
		return new Promise(function (resolve, reject) {
			var s = document.createElement('script');
			s.src = src; s.async = false;
			s.onload = function () { resolve(); };
			s.onerror = function () { loading = null; reject(codeError('Script not loaded', 'offline')); };
			document.head.appendChild(s);
		});
	}
	cloud.load = function () {
		if (typeof firebase !== 'undefined') return Promise.resolve();
		if (!loading) loading = VENDOR.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve());
		return loading;
	};

	// wantGuest(): true only while the player has online saving turned on. A guest account is never made without it.
	var wantGuest = function () { return false; };
	cloud.init = function (lang, wantGuestFn) {
		if (wantGuestFn) wantGuest = wantGuestFn;
		if (auth) { auth.languageCode = lang; return true; }
		if (typeof firebase === 'undefined') return false;
		try {
			if (!firebase.apps.length) firebase.initializeApp(cfg);
			auth = firebase.auth();
			auth.languageCode = lang;
		} catch (e) { console.warn('Firebase did not start:', e); auth = null; return false; }
		cloud.available = true;
		auth.onAuthStateChanged(function (user) {
			firstState = true;
			userListeners.slice().forEach(function (fn) { fn(user); });
			if (!user) ensureGuest();
		});
		window.addEventListener('online', function () { if (auth && !auth.currentUser) ensureGuest(); });
		return true;
	};
	// Turn on: load the sign-in files, start, wait for the saved sign-in (if any), then make the guest account.
	// Rejects with .code on failure.
	cloud.enable = function (lang, wantGuestFn) {
		return cloud.load().then(function () {
			if (!cloud.init(lang, wantGuestFn)) throw codeError('Sign-in did not start', 'no-auth');
			return new Promise(function (resolve) { var off = auth.onAuthStateChanged(function (u) { off(); resolve(u); }); });
		}).then(function (u) { return u ? null : signInGuest(); });
	};
	cloud.onUser = function (fn) { userListeners.push(fn); };
	cloud.user = function () { return auth ? auth.currentUser : null; };
	cloud.uid = function () { var u = cloud.user(); return u ? u.uid : ''; };
	cloud.isGuest = function () { var u = cloud.user(); return !!u && u.isAnonymous; };
	// Only the kinds of sign-in, never an email or a name: ["google", "email"].
	cloud.providers = function () {
		var u = cloud.user(), out = [];
		if (!u) return out;
		(u.providerData || []).forEach(function (p) {
			var k = p.providerId === 'google.com' ? 'google' : (p.providerId === 'password' || p.providerId === 'emailLink' ? 'email' : '');
			if (k && out.indexOf(k) === -1) out.push(k);
		});
		return out;
	};

	// The account kind saved with the data: "guest", "google" or "email". Derived from the provider ids only.
	cloud.kind = function () {
		var u = cloud.user();
		if (!u) return '';
		return st.accountKind((u.providerData || []).map(function (p) { return p.providerId; }));
	};

	// One sign-in at a time, so two callers never make two guest accounts.
	var guestPromise = null;
	function signInGuest() {
		if (!guestPromise) guestPromise = auth.signInAnonymously().then(function (r) { guestPromise = null; return r; }, function (e) { guestPromise = null; throw e; });
		return guestPromise;
	}
	// Make a guest (anonymous) account, only when wantGuest() says the player turned on online saving. Retries when the network comes back.
	function ensureGuest() {
		if (!auth || auth.currentUser || guestTimer || guestPromise || !wantGuest()) return;
		guestTimer = setTimeout(function () {
			guestTimer = null;
			if (auth.currentUser || !wantGuest()) return;
			signInGuest().catch(function (e) {
				console.warn('Guest sign-in failed:', e && e.code);
				guestTimer = setTimeout(function () { guestTimer = null; ensureGuest(); }, 15000);
			});
		}, 0);
	}
	cloud.ensureGuest = ensureGuest;

	// Link Google to the guest account. Keeps the uid and the data.
	// Resolves {ok:true}, {inUse:true, credential}, {cancelled:true} or throws with .code.
	cloud.linkGoogle = function () {
		var u = auth.currentUser;
		var provider = new firebase.auth.GoogleAuthProvider();
		// No extra scopes: the page does not ask for the name, the email or the photo.
		return u.linkWithPopup(provider).then(function () { return { ok: true }; }, function (e) { return classifyLinkError(e); });
	};
	cloud.sendEmailLink = function (email) {
		pendingEmail = String(email || '').trim();
		var url = location.origin + location.pathname;
		return auth.sendSignInLinkToEmail(pendingEmail, { url: url, handleCodeInApp: true });
	};
	cloud.pendingEmail = function () { return pendingEmail; };
	cloud.isEmailLink = function (href) { return !!auth && auth.isSignInWithEmailLink(href || location.href); };
	cloud.completeEmailLink = function (email, href) {
		var u = auth.currentUser;
		var em = String(email || pendingEmail || '').trim();
		pendingEmail = '';
		if (u && u.isAnonymous) {
			var cred = firebase.auth.EmailAuthProvider.credentialWithLink(em, href || location.href);
			return u.linkWithCredential(cred).then(function () { return { ok: true }; }, function (e) {
				if (e && (e.code === 'auth/email-already-in-use' || e.code === 'auth/credential-already-in-use')) {
					return { inUse: true, emailLink: { email: em, href: href || location.href }, credential: e.credential || null };
				}
				return classifyLinkError(e);
			});
		}
		return auth.signInWithEmailLink(em, href || location.href).then(function () { return { ok: true, switched: true }; });
	};
	function classifyLinkError(e) {
		var code = e && e.code;
		if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') return { inUse: true, credential: e.credential || null };
		if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return { cancelled: true };
		throw e;
	}
	// The credential is already used by another account: sign in to that account (the guest account is left).
	// The guest save document is deleted first so no orphan copy stays in the cloud. The local data stays on this device.
	cloud.switchAccount = function (inUse) {
		var guestUid = cloud.uid();
		return cloud.deleteSave(guestUid).catch(function () { /* none to delete */ }).then(function () {
			if (inUse.credential) return auth.signInWithCredential(inUse.credential);
			if (inUse.emailLink) return auth.signInWithEmailLink(inUse.emailLink.email, inUse.emailLink.href);
			throw codeError('No credential to switch with', 'no-credential');
		}).then(function () { return { ok: true }; });
	};
	cloud.signOut = function () { return auth ? auth.signOut() : Promise.resolve(); };
	// Delete the save document, then the auth user. Resolves {ok:true}, {needsRecentLogin:true}.
	cloud.deleteAccount = function () {
		var u = auth.currentUser, uid = u.uid;
		return cloud.deleteSave(uid).then(function () { return u.delete(); }).then(function () { return { ok: true }; }, function (e) {
			if (e && e.code === 'auth/requires-recent-login') return { needsRecentLogin: true };
			throw e;
		});
	};
	cloud.reauthGoogle = function () {
		return auth.currentUser.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider()).then(function () { return { ok: true }; }, function (e) {
			if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return { cancelled: true };
			throw e;
		});
	};
	cloud.reauthEmailLink = function (email, href) {
		var cred = firebase.auth.EmailAuthProvider.credentialWithLink(String(email || '').trim(), href || location.href);
		return auth.currentUser.reauthenticateWithCredential(cred).then(function () { return { ok: true }; });
	};

	/* ---------- Firestore REST ---------- */

	function token() {
		var u = auth && auth.currentUser;
		if (!u) return Promise.reject(codeError('Not signed in', 'no-user'));
		return u.getIdToken().catch(function (e) { throw codeError('Token failed', (e && e.code === 'auth/network-request-failed') ? 'offline' : 'no-token'); });
	}
	function fs(method, url, body) {
		return token().then(function (tk) {
			var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
			var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
			return fetch(url, { method: method, headers: { 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
				.then(function (res) { if (timer) clearTimeout(timer); return res; }, function () { if (timer) clearTimeout(timer); throw codeError('Network error', 'offline'); });
		}).then(function (res) {
			if (res.status === 404) return { status: 404, json: null };
			if (res.status === 401 || res.status === 403) throw codeError('Access denied', 'denied', { status: res.status });
			if (res.status === 429 || res.status >= 500) throw codeError('Server busy', 'server', { status: res.status });
			if (!res.ok) {
				// A write with a precondition that no longer holds: 400 FAILED_PRECONDITION, or 409 ALREADY_EXISTS (the doc exists now).
				return res.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return j; }, function () { return null; }).then(function (j) {
					var fsStatus = j && j.error && j.error.status ? String(j.error.status) : '';
					var refused = fsStatus === 'FAILED_PRECONDITION' || fsStatus === 'ALREADY_EXISTS';
					throw codeError('Request failed ' + res.status, refused ? 'precondition' : 'request', { status: res.status, fsStatus: fsStatus });
				});
			}
			return res.text().then(function (t) { return { status: res.status, json: t ? JSON.parse(t) : {} }; });
		});
	}
	function ms(ts) {
		var m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(String(ts || ''));
		if (!m) return 0;
		return Date.parse(m[1] + '.' + ((m[2] || '0') + '000').slice(0, 3) + 'Z');
	}

	// Resolves null (no doc) or {state, updated (ms), name, version}.
	// version = the Firestore document updateTime, exactly as the server wrote it (nanosecond text, never rounded).
	// Why not the "updated" field: it is rounded to ms here, and a precondition needs the exact value. updateTime is the value
	// the server itself compares in currentDocument.updateTime. It is also set by every write, including an admin name fix.
	// A POST with batchGet answers 200 also when the doc is missing, so a new player does not get a 404 in the console.
	cloud.getSave = function (uid) {
		return fs('POST', BASE + ':batchGet', { documents: [DB_NAME + '/users/' + uid] }).then(function (r) {
			var found = st.firstFound(r.json);
			if (!found) return null;
			var f = found.fields;
			return { state: st.fromFsValue(f.state) || {}, updated: ms(f.updated && f.updated.timestampValue), name: f.name ? st.fromFsValue(f.name) : '', version: String(found.updateTime || '') };
		});
	};
	// Is this account in art_readers (trusted)? The rules let a player read only their own record there.
	// :batchGet answers 200 with "missing" when it is not there, so a "no" is not a 404 and not a console error.
	// Resolves true or false. Rejects (offline, server) so the caller keeps what it has.
	cloud.isTrusted = function (uid) {
		return fs('POST', BASE + ':batchGet', { documents: [DB_NAME + '/art_readers/' + uid] }).then(function (r) { return !!st.firstFound(r.json); });
	};
	// One commit: the fields and the server time for "updated" (the rules need updated == request.time).
	// expect: {updateTime: version} (the doc must still have this version), {exists: false} (no doc yet) or null (no check).
	// A refused write rejects with code "precondition". Resolves {updated (ms), version}.
	cloud.setSave = function (uid, p, expect) {
		var fields = { schema: { integerValue: '1' }, state: st.toFsValue(p.state), name: { stringValue: p.name } };
		if (p.kind) fields.kind = { stringValue: p.kind };
		var body = { writes: [{
			update: { name: DB_NAME + '/users/' + uid, fields: fields },
			updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }]
		}] };
		if (expect && expect.updateTime) body.writes[0].currentDocument = { updateTime: expect.updateTime };
		else if (expect && expect.exists === false) body.writes[0].currentDocument = { exists: false };
		return fs('POST', BASE + ':commit', body).then(function (r) {
			if (r.status === 404 && expect) throw codeError('The save is gone', 'precondition', { status: 404 }); // Expected an existing doc.
			var wr = r.json && r.json.writeResults && r.json.writeResults[0];
			return { updated: ms(r.json && r.json.commitTime) || Date.now(), version: String((wr && wr.updateTime) || '') };
		});
	};
	cloud.deleteSave = function (uid) { return fs('DELETE', BASE + '/users/' + encodeURIComponent(uid)).then(function () { return true; }); };

	// Private art: the index (1 read) or, when it is missing, the listing (1 read each); then the images in chunks. Throws code "denied" for anyone but the owner.
	cloud.listArt = function () {
		var out = [];
		function page(token) {
			return fs('GET', BASE + '/private_art?pageSize=300&mask.fieldPaths=updated' + (token ? '&pageToken=' + encodeURIComponent(token) : '')).then(function (r) {
				((r.json && r.json.documents) || []).forEach(function (d) {
					var id = d.name.split('/').pop();
					out.push({ id: id, updated: ms(d.fields && d.fields.updated && d.fields.updated.timestampValue) || ms(d.updateTime) });
				});
				return r.json && r.json.nextPageToken ? page(r.json.nextPageToken) : out;
			});
		}
		return page('');
	};
	// The art index: one document private_art_index/main = { items: { id: updated }, updated } (1 read for all ids).
	// updated is milliseconds (integer) or an ISO time. Resolves [{id, updated (ms)}], or null when the index is missing or empty
	// (the caller then lists private_art as before). Throws code "denied" for anyone but a trusted player.
	cloud.getArtIndex = function () {
		return fs('POST', BASE + ':batchGet', { documents: [DB_NAME + '/private_art_index/main'] }).then(function (r) {
			var found = st.firstFound(r.json);
			var items = found && found.fields && found.fields.items && found.fields.items.mapValue && found.fields.items.mapValue.fields;
			if (!items) return null;
			var out = [];
			Object.keys(items).forEach(function (id) {
				var v = items[id] || {}, t = 0;
				if (v.integerValue !== undefined) t = Number(v.integerValue);
				else if (v.doubleValue !== undefined) t = Number(v.doubleValue);
				else if (v.timestampValue) t = ms(v.timestampValue);
				else if (v.stringValue) t = ms(v.stringValue) || Number(v.stringValue);
				out.push({ id: id, updated: isFinite(t) && t > 0 ? t : 0 });
			});
			return out.length ? out : null;
		});
	};
	// Several images in one request (:batchGet). Resolves {id: base64}. A missing document is left out.
	cloud.getArtMany = function (ids) {
		return fs('POST', BASE + ':batchGet', { documents: ids.map(function (id) { return DB_NAME + '/private_art/' + id; }), mask: { fieldPaths: ['png_b64'] } }).then(function (r) {
			var out = {};
			(Array.isArray(r.json) ? r.json : []).forEach(function (x) {
				var f = x && x.found;
				if (f && f.fields && f.fields.png_b64 && f.fields.png_b64.stringValue) out[f.name.split('/').pop()] = String(f.fields.png_b64.stringValue);
			});
			return out;
		});
	};
	cloud.getArt = function (id) {
		return fs('GET', BASE + '/private_art/' + encodeURIComponent(id)).then(function (r) {
			var f = r.json && r.json.fields;
			return f && f.png_b64 ? String(f.png_b64.stringValue || '') : '';
		});
	};
})();
