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

	cloud.init = function (lang) {
		if (typeof firebase === 'undefined') return false;
		try {
			if (!firebase.apps.length) firebase.initializeApp(cfg);
			auth = firebase.auth();
			auth.languageCode = lang;
		} catch (e) { console.warn('Firebase did not start:', e); return false; }
		cloud.available = true;
		auth.onAuthStateChanged(function (user) {
			firstState = true;
			userListeners.slice().forEach(function (fn) { fn(user); });
			if (!user) ensureGuest();
		});
		window.addEventListener('online', function () { if (auth && !auth.currentUser) ensureGuest(); });
		return true;
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

	// Start as a guest (anonymous) so saving works at once. Retries when the network comes back.
	function ensureGuest() {
		if (!auth || auth.currentUser || guestTimer) return;
		guestTimer = setTimeout(function () {
			guestTimer = null;
			if (auth.currentUser) return;
			auth.signInAnonymously().catch(function (e) {
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
	cloud.signOut = function () { return auth.signOut(); };
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
			if (!res.ok) throw codeError('Request failed ' + res.status, 'request', { status: res.status });
			return res.text().then(function (t) { return { status: res.status, json: t ? JSON.parse(t) : {} }; });
		});
	}
	function ms(ts) {
		var m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(String(ts || ''));
		if (!m) return 0;
		return Date.parse(m[1] + '.' + ((m[2] || '0') + '000').slice(0, 3) + 'Z');
	}

	// Resolves null (no doc) or {state, updated (ms), name}.
	// A POST with batchGet answers 200 also when the doc is missing, so a new player does not get a 404 in the console.
	cloud.getSave = function (uid) {
		return fs('POST', BASE + ':batchGet', { documents: [DB_NAME + '/users/' + uid] }).then(function (r) {
			var item = Array.isArray(r.json) ? r.json[0] : null;
			if (!item || !item.found || !item.found.fields) return null;
			var f = item.found.fields;
			return { state: st.fromFsValue(f.state) || {}, updated: ms(f.updated && f.updated.timestampValue), name: f.name ? st.fromFsValue(f.name) : '' };
		});
	};
	// One commit: the fields and the server time for "updated" (the rules need updated == request.time).
	cloud.setSave = function (uid, p) {
		var fields = { schema: { integerValue: '1' }, state: st.toFsValue(p.state), name: { stringValue: p.name } };
		if (p.kind) fields.kind = { stringValue: p.kind };
		var body = { writes: [{
			update: { name: DB_NAME + '/users/' + uid, fields: fields },
			updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }]
		}] };
		return fs('POST', BASE + ':commit', body).then(function (r) { return { updated: ms(r.json && r.json.commitTime) || Date.now() }; });
	};
	cloud.deleteSave = function (uid) { return fs('DELETE', BASE + '/users/' + encodeURIComponent(uid)).then(function () { return true; }); };

	// Private art: ids and update times only (small), then single documents. Throws code "denied" for anyone but the owner.
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
	cloud.getArt = function (id) {
		return fs('GET', BASE + '/private_art/' + encodeURIComponent(id)).then(function (r) {
			var f = r.json && r.json.fields;
			return f && f.png_b64 ? String(f.png_b64.stringValue || '') : '';
		});
	};
})();
