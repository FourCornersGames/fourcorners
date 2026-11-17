/* Shop Hand web page (milestone W4): start-up, routing, About and the account. Vanilla JS, no build step.
   The pieces: domain.js (rules), state.js (the save), sync.js (local + cloud save), cloud.js (sign-in, Firestore REST),
   art.js (owner-only images), ui.js (helpers), screens.js (the five tabs).
   Text comes from window.SH_STRINGS (made by tools/export_web.py in the app repo).
   Data comes from /shophand/data/gamedata.json (the public build only). */
(function () {
	'use strict';
	var SH = window.SH, dom = SH.domain, st = SH.state, ui = SH.ui;
	var t = ui.t, h = ui.h, clear = ui.clear, C = ui.ctx, LANG = ui.LANG;

	var DATA_URL = '/shophand/data/gamedata.json';
	var DISCLAIMER = 'This is an unofficial fan-made helper for a Fortnite creator-made island (island code 7865-8305-9184). It is not affiliated with or endorsed by Epic Games, Disney, Lucasfilm or FOAD.';
	var NO_LOGOS = 'It uses no game logos and no key art. All names belong to their owners.';
	var LEGAL = {
		en: { privacy: '/shophand/privacy.html', terms: '/shophand/terms.html', home: '/' },
		fr: { privacy: '/fr/shophand/confidentialite.html', terms: '/fr/shophand/conditions.html', home: '/fr/' }
	}[LANG];

	var TABS = ['collection', 'fusions', 'rebirth', 'upgrades', 'info'];
	var SUBS = { upgrades: ['chips', 'nova'], info: ['events', 'traits'] };
	var SUB_SETTING = { upgrades: 'upgrades_section', info: 'info_section' };
	var lastHash = '#collection', aboutPushed = false, detailPushed = false;
	var views = {}, els = {}, D = null, current = '';
	var wideMq = window.matchMedia('(min-width: 1100px)');
	var authReady = false, emailLinkDone = false;

	/* ---------- storage (localStorage may be blocked: then the page works in memory only) ---------- */

	function makeStorage() {
		try { var x = window.localStorage; x.setItem('shophand.t', '1'); x.removeItem('shophand.t'); return x; }
		catch (e) {
			var m = {};
			return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function () { throw new Error('storage blocked'); }, removeItem: function (k) { delete m[k]; } };
		}
	}

	/* ---------- cloud adapter for sync.js ---------- */

	function offlineErr() { var e = new Error('offline'); e.code = 'offline'; return e; }
	var cloudAdapter = {
		getSave: function (uid) { return SH.cloud && SH.cloud.available ? SH.cloud.getSave(uid) : Promise.reject(offlineErr()); },
		setSave: function (uid, p) { return SH.cloud && SH.cloud.available ? SH.cloud.setSave(uid, p) : Promise.reject(offlineErr()); }
	};

	/* ---------- conflict question ---------- */

	function askConflict(info) {
		var lines = [];
		lines.push(info.sameAccount ? t('This device and your account both changed. Choose which data to keep.') : t('You signed in to an account that already has data. Choose which data to keep.'));
		lines.push(t('This device: %d droids owned, rebirth %d.', info.local.droids, info.local.rebirth));
		lines.push(t('Your account: %d droids owned, rebirth %d.', info.cloud.droids, info.cloud.rebirth) + (info.cloud.updated ? ' ' + t('Saved %s.', new Date(info.cloud.updated).toLocaleString(LANG)) : ''));
		lines.push(t('The data you do not keep is saved as a backup on this device. You can restore it in About.'));
		return ui.choose(t('Which data do you want to keep?'), lines, [
			{ value: 'cloud', label: t('Keep the data of my account'), cls: 'primary' },
			{ value: 'local', label: t('Keep the data on this device') },
			{ value: null, label: t('Decide later') }]);
	}

	/* ---------- helpers ---------- */

	function errText(e) {
		var code = e && e.code ? String(e.code) : '';
		if (code === 'offline' || code === 'auth/network-request-failed') return t('No connection. Try again when you are online.');
		if (code === 'auth/popup-blocked') return t('The sign-in window was blocked. Allow pop-ups for this page and try again.');
		if (code === 'auth/invalid-email') return t('This email is not valid.');
		if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') return t('This link is not valid any more. Ask for a new link.');
		if (code === 'auth/too-many-requests') return t('Too many tries. Wait a moment and try again.');
		return t('Something went wrong (%s).', code || 'error');
	}
	function syncText(s) {
		switch (s) {
			case 'syncing': return t('Saving to your account…');
			case 'synced': return t('Saved on this device and in your account.');
			case 'offline': return t('Offline. Your changes are saved on this device. They go to your account when the connection is back.');
			case 'error': return t('The save to your account failed. The page will try again.');
			case 'conflict': return t('Two different saves were found. Choose which one to keep.');
			case 'too_big': return t('Your save is too big for the account. Save a backup file.');
		}
		return t('Saved on this device only.');
	}
	function toastUndo(info) {
		var text;
		if (info.kind === 'rebirth') {
			var sup = info.what === 'super';
			text = t(sup ? 'Super rebirth count set to %d' : 'Rebirth set to %d', sup ? (info.cycle || 1) - 1 : (info.number || 0));
		} else {
			var d = C.gd.droidsById[info.droid_id], nm = d && !ui.isBlank(d.name) ? d.name : String(info.droid_id);
			var vn = info.tier_id ? ui.tierName(info.tier_id) : t('all variants');
			text = t('Marked %s (%s) as %s', nm, vn, info.value ? t('owned') : t('not owned'));
		}
		ui.toast(text, function () { C.ps.restoreSnapshot(info.snapshot); });
	}

	/* ---------- views: refresh when the data changes ---------- */

	function isVisible(name) { return current === name; }
	function refreshView(name) {
		var v = views[name]; if (!v) return;
		if (name === 'collection') { v.refreshAll(); return; }
		if (v.refresh) { v.dirty = false; v.refresh(); }
	}
	function onStateChange(kind, id) {
		TABS.forEach(function (name) {
			var v = views[name]; if (!v) return;
			if (name === 'collection') {
				if (isVisible(name) || (kind === 'owned' && col().getSelected())) v.onChange(kind, id); else v.dirty = true;
				return;
			}
			v.dirty = true;
			if (isVisible(name)) requestAnimationFrame(function () { if (v.dirty && isVisible(name)) refreshView(name); });
		});
	}
	function col() { return views.collection; }
	function refreshAllViews() { TABS.forEach(function (n) { if (views[n]) { if (isVisible(n) || n === 'collection') refreshView(n); else views[n].dirty = true; } }); }

	/* ---------- About ---------- */

	function section(title) { var box = h('section', { class: 'about-sec' }, h('h3', null, title)); return box; }
	function buildAbout() {
		var dlg = els.about;
		var top = dlg.querySelector('.about-in'), keep = top ? top.scrollTop : 0;
		var close = h('button', { class: 'btn', type: 'button', onclick: closeAbout, 'aria-label': t('Close') }, t('Close'));
		var meta = [];
		if (D && D.data_version) meta.push(t('Data version: %s (%s)', D.data_version, D.updated || t('unknown')));
		var inner = h('div', { class: 'about-in' }, h('header', null, h('h2', { id: 'about-title' }, t('About')), close));

		var s1 = section(t('Free and unofficial'));
		s1.appendChild(h('p', null, 'Shop Hand · ' + t('Four Corners Games')));
		s1.appendChild(h('p', { class: 'test-line' }, t('Test version')));
		s1.appendChild(h('p', { class: 'dim' }, t('A two-person indie studio from Quebec.')));
		s1.appendChild(h('p', null, t('Contact: %s', ''), h('a', { href: 'mailto:support@fourcornersgames.ca' }, 'support@fourcornersgames.ca')));
		inner.appendChild(s1);

		var s2 = section(t('Disclaimer'));
		s2.appendChild(h('p', { class: 'disclaimer' }, t(DISCLAIMER)));
		s2.appendChild(h('p', { class: 'dim' }, t(NO_LOGOS)));
		s2.appendChild(h('p', { class: 'dim' }, t('This app is free. It has no ads and no purchases. The studio earns no money from it.')));
		inner.appendChild(s2);

		if (C.ps) {
			inner.appendChild(accountSection());
			var s3 = section(t('Settings'));
			var hn = h('input', { type: 'checkbox', id: 'hide-names', onchange: function () { C.ps.setSetting('hide_unowned_names', this.checked); } });
			hn.checked = !!C.ps.getSetting('hide_unowned_names');
			s3.appendChild(h('label', { class: 'check-row', for: 'hide-names' }, hn, t('Hide names of droids I do not own')));
			inner.appendChild(s3);
			inner.appendChild(backupSection());
		}

		var s5 = section(t('Privacy'));
		s5.appendChild(h('p', null, t('Your data stays on this device. When you use the page, it is also saved in your account on a Google Firebase server. The studio does not see your email address.')));
		inner.appendChild(s5);

		if (meta.length) inner.appendChild(h('p', { class: 'dim small', style: 'margin-top:0.75rem' }, meta.join(' ')));
		inner.appendChild(h('div', { class: 'about-links' },
			h('a', { class: 'btn', href: LEGAL.privacy }, t('Privacy Policy')), h('a', { class: 'btn', href: LEGAL.terms }, t('Terms of Use')),
			h('a', { class: 'btn', href: LEGAL.home }, t('Four Corners Games'))));
		clear(dlg).appendChild(inner);
		inner.scrollTop = keep;
	}

	function accountSection() {
		var cloud = SH.cloud, sync = C.sync;
		var box = section(t('Account and saving'));
		var status = sync.getStatus();
		box.appendChild(h('p', { class: 'sync-line', 'data-sync': status }, syncText(status)));
		if (!sync.storageOk()) box.appendChild(h('p', { class: 'warn' }, t('This browser does not let the page save on this device. Save a backup file to keep your data.')));
		if (status === 'conflict') box.appendChild(h('button', { class: 'btn primary', type: 'button', onclick: function () { sync.retryNow(true); } }, t('Choose which data to keep')));
		if (!cloud || !cloud.available) { box.appendChild(h('p', { class: 'dim' }, t('Sign-in is not available now. Your data is saved on this device.'))); return box; }
		var user = cloud.user();
		if (!user) { box.appendChild(h('p', { class: 'dim' }, authReady ? t('Starting a guest account…') : t('Starting a guest account…'))); return box; }

		var name = sync.name();
		box.appendChild(h('div', { class: 'acct-row' }, h('span', { class: 'dim' }, t('Your name') + ': '), h('strong', null, name || '…'),
			h('button', { class: 'btn', type: 'button', onclick: changeName }, t('Change name'))));
		box.appendChild(h('p', { class: 'dim small' }, t('This name is not your real name. The studio never stores your email address or your Google name.')));

		var provs = cloud.providers();
		if (user.isAnonymous) {
			box.appendChild(h('p', null, t('You are using a guest account. Link a sign-in to keep your data if you clear this browser or change device.')));
		} else {
			box.appendChild(h('p', null, provs.length ? t('Signed in with: %s', provs.map(function (p) { return p === 'google' ? 'Google' : t('email link'); }).join(', ')) : t('Signed in.')));
		}
		var acts = h('div', { class: 'acct-actions' });
		if (provs.indexOf('google') === -1) acts.appendChild(h('button', { class: 'btn', type: 'button', onclick: linkGoogle }, t('Link Google')));
		if (provs.indexOf('email') === -1) acts.appendChild(h('button', { class: 'btn', type: 'button', onclick: linkEmail }, t('Link email (link sent by email)')));
		if (!user.isAnonymous) acts.appendChild(h('button', { class: 'btn', type: 'button', onclick: signOut }, t('Sign out')));
		box.appendChild(acts);
		if (user.isAnonymous) box.appendChild(h('p', { class: 'dim small' }, t('You can also sign in to an account you already have: use Link Google or Link email. You will choose which data to keep.')));
		box.appendChild(h('div', { class: 'acct-actions' }, h('button', { class: 'btn danger', type: 'button', onclick: deleteAccount }, t('Delete my account and data'))));

		var bk = sync.getBackup();
		if (bk) {
			box.appendChild(h('h4', null, t('Previous data on this device')));
			box.appendChild(h('p', { class: 'dim small' }, t('A backup of data that was replaced: %d droids owned, rebirth %d, saved %s.', bk.summary.droids, bk.summary.rebirth, new Date(bk.saved).toLocaleString(LANG))));
			box.appendChild(h('button', { class: 'btn', type: 'button', onclick: restoreBackup }, t('Restore the previous data')));
		}
		return box;
	}

	function changeName() {
		ui.prompt({ title: t('Change name'), label: t('Your name'), value: C.sync.name(), maxlength: 24, hint: t('3 to 24 characters: letters, digits, space, _ and -.'),
			validate: function (v) { return st.validName(v) ? '' : t('Use 3 to 24 characters: letters, digits, space, _ and -.'); } })
			.then(function (v) { if (v != null && C.sync.setName(v)) { ui.toast(t('Name saved.')); buildAbout(); } });
	}
	function linkGoogle() {
		SH.art.forget();
		SH.cloud.linkGoogle().then(function (r) {
			if (r.ok) { C.sync.claim(SH.cloud.uid()); ui.toast(t('Google is linked to your account.')); buildAbout(); }
			else if (r.inUse) return handleInUse(r);
		}).catch(function (e) { ui.alert(t('Sign-in'), errText(e)); });
	}
	function linkEmail() {
		ui.prompt({ title: t('Link email (link sent by email)'), label: t('Your email'), type: 'email', autocomplete: 'email', ok: t('Send the link'),
			hint: t('The studio does not keep your email. It is used only by the sign-in service to send you the link.'),
			validate: function (v) { return /^\S+@\S+\.\S+$/.test(v.trim()) ? '' : t('This email is not valid.'); } })
			.then(function (v) {
				if (v == null) return;
				return SH.cloud.sendEmailLink(v).then(function () {
					return ui.alert(t('Check your email'), t('We sent a link. Open it on this device to finish. If you open it on another device, the page will ask for your email again.'));
				}, function (e) { return ui.alert(t('Sign-in'), errText(e)); });
			});
	}
	function handleInUse(r) {
		return ui.choose(t('This sign-in already has an account'), [t('Switch to that account? The data on this device and the data in that account are not mixed. You choose which one to keep.')], [
			{ value: 'switch', label: t('Switch to that account'), cls: 'primary' }, { value: null, label: t('Cancel') }]).then(function (pick) {
			if (pick !== 'switch') return;
			return SH.cloud.switchAccount(r).then(function () { ui.toast(t('Signed in.')); }, function (e) { return ui.alert(t('Sign-in'), errText(e)); });
		});
	}
	// The page was opened from an email link.
	function finishEmailLink() {
		if (emailLinkDone || !SH.cloud.available || !SH.cloud.isEmailLink()) return;
		emailLinkDone = true;
		var href = location.href;
		function done() { history.replaceState(null, '', location.pathname + (location.hash && location.hash !== '#about' ? location.hash : '')); }
		var email = SH.cloud.pendingEmail();
		var ask = email ? Promise.resolve(email) : ui.prompt({ title: t('Finish signing in'), label: t('Enter the email that got the link'), type: 'email', autocomplete: 'email', ok: t('Continue'),
			validate: function (v) { return /^\S+@\S+\.\S+$/.test(v.trim()) ? '' : t('This email is not valid.'); } });
		ask.then(function (em) {
			if (em == null) { done(); return; }
			return SH.cloud.completeEmailLink(em, href).then(function (r) {
				done();
				if (r.ok) { C.sync.claim(SH.cloud.uid()); ui.toast(t('Your email is linked.')); }
				else if (r.inUse) return handleInUse(r);
			}, function (e) { done(); return ui.alert(t('Sign-in'), errText(e)); });
		});
	}
	function signOut() {
		ui.confirm({ title: t('Sign out?'), text: t('This device will start with empty data. Your data stays in your account. Sign in again to get it back.'), ok: t('Sign out') }).then(function (yes) {
			if (!yes) return;
			return C.sync.flush().then(function () {
				if (C.sync.isDirty()) return ui.confirm({ title: t('Some changes are not saved yet'), text: t('Some changes are only on this device. If you sign out now, they are lost. Save a backup file first, or cancel.'), ok: t('Sign out anyway'), danger: true });
				return true;
			}).then(function (go) {
				if (!go) return;
				return C.sync.attach('').then(function () { C.sync.resetLocal(); SH.art.clear(); return SH.cloud.signOut(); }).then(function () { refreshAllViews(); buildAbout(); ui.toast(t('Signed out.')); });
			});
		});
	}
	function deleteAccount() {
		ui.confirm({ title: t('Delete my account and data'), text: t('This deletes your save in the cloud and your account. It also clears the data on this device. You cannot undo this. Save a backup file first if you want to keep your data.'), ok: t('Delete everything'), danger: true }).then(function (yes) {
			if (!yes) return;
			var uid = SH.cloud.uid(), provs = SH.cloud.providers();
			return C.sync.attach('').then(function () { return SH.cloud.deleteAccount(); }).then(function (r) {
				if (r.needsRecentLogin) {
					return C.sync.attach(uid).then(function () {
						if (provs.indexOf('google') !== -1) {
							return ui.alert(t('Sign in again'), t('For safety, sign in again with Google. Then delete your account.')).then(function () { return SH.cloud.reauthGoogle(); }).then(function (rr) { if (rr.ok) deleteAccount(); });
						}
						return ui.alert(t('Sign in again'), t('For safety, sign out, sign in again with your email link, and then delete your account.'));
					});
				}
				C.sync.resetLocal(); SH.art.clear(); refreshAllViews(); buildAbout(); ui.toast(t('Your account and data are deleted.'));
			}).catch(function (e) { C.sync.attach(uid); ui.alert(t('Delete my account and data'), errText(e)); });
		});
	}
	function restoreBackup() {
		ui.confirm({ title: t('Restore the previous data'), text: t('This replaces the data on this device with the backup. The data now on this device becomes the new backup.'), ok: t('Restore') }).then(function (yes) {
			if (yes && C.sync.restoreBackup()) { refreshAllViews(); buildAbout(); ui.toast(t('Restored.')); }
		});
	}

	function backupSection() {
		var s = section(t('Back up your data'));
		var info = h('p', { class: 'dim', role: 'status' });
		s.appendChild(h('p', { class: 'dim' }, t('Save your data as a file. The file also works in the Android app.')));
		s.appendChild(h('div', { class: 'acct-actions' },
			h('button', { class: 'btn', type: 'button', onclick: function () { exportFile(info); } }, t('Save backup to a file')),
			h('button', { class: 'btn', type: 'button', onclick: function () { exportClipboard(info); } }, t('Copy my data to clipboard'))));
		var fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'import-file', tabindex: '-1', onchange: function () { loadFile(this, info); } });
		s.appendChild(h('h4', null, t('Restore your data')));
		s.appendChild(h('p', { class: 'dim' }, t('Load a backup file. This replaces the data on this device.')));
		s.appendChild(fileIn);
		s.appendChild(h('button', { class: 'btn', type: 'button', onclick: function () { fileIn.click(); } }, t('Load backup from a file')));
		s.appendChild(info);
		return s;
	}
	function exportFile(info) {
		var text = C.ps.exportJson(), d = new Date();
		var name = st.backupFileName({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
		try {
			var url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = h('a', { href: url, download: name });
			document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
			info.textContent = t('Saved %s.', name);
		} catch (e) { info.textContent = t('Save failed: %s.', t('the file could not be written')); }
	}
	function exportClipboard(info) {
		var text = C.ps.exportJson();
		(navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
			info.textContent = t('Copied %d characters. Keep the text in a safe place.', text.length);
		}, function () { info.textContent = t('Save failed: %s.', t('the file could not be written')); });
	}
	function loadFile(input, info) {
		var file = input.files && input.files[0]; input.value = '';
		if (!file) { info.textContent = t('Load failed: no file was chosen.'); return; }
		if (file.size > st.MAX_IMPORT_BYTES) { info.textContent = t('Load failed: the file is too big to be a backup (over 1 MB).'); return; }
		if (file.size === 0) { info.textContent = t('Load failed: the file is empty.'); return; }
		file.slice(0, st.MAX_IMPORT_BYTES + 1).text().then(function (text) {
			var chk = st.checkImport(text);
			if (!chk.ok) { info.textContent = t('Load failed: %s', t(chk.key)); return; }
			return ui.confirm({ title: t('Replace your data?'), text: t('Import replaces the owned droids, base and settings on this device. Continue?') }).then(function (yes) {
				if (!yes) { info.textContent = t('Load cancelled.'); return; }
				var snap = C.ps.toDict();
				var res = C.ps.importJson(text);
				if (res.ok) { C.sync.stashBackup && C.sync.stashBackup(snap); refreshAllViews(); info.textContent = t('Loaded %s. %s', file.name, t(res.key, res.count)); }
				else info.textContent = t('Load failed: %s', t(res.key));
			});
		}, function () { info.textContent = t('Load failed: %s.', t('the file could not be opened')); });
	}

	function openAbout() {
		if (!els.about.open) {
			buildAbout();
			if (typeof els.about.showModal === 'function') els.about.showModal(); else els.about.setAttribute('open', '');
		}
	}
	function closeAbout() {
		if (aboutPushed) { aboutPushed = false; history.back(); }
		else { history.replaceState(null, '', lastHash); route(); }
	}

	/* ---------- detail (Collection) ---------- */

	var api = {
		openDetail: function (id) {
			var target = '#collection/' + encodeURIComponent(id);
			if (current === 'collection' && wideMq.matches) { history.replaceState(null, '', target); route(); }
			else { detailPushed = true; location.hash = target; }
		},
		closeDetail: function () {
			if (detailPushed) { detailPushed = false; history.back(); }
			else { history.replaceState(null, '', '#collection'); route(); }
		}
	};

	/* ---------- router ---------- */

	function route() {
		var parts = location.hash.replace(/^#\/?/, '').split('/').map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
		var name = parts[0];
		if (name === 'about') { if (D) openAbout(); return; }
		aboutPushed = false;
		if (els.about.open) els.about.close();
		if (!D) return;
		if (TABS.indexOf(name) === -1) { name = 'collection'; parts = [name]; history.replaceState(null, '', '#collection'); }
		var prev = current;
		current = name;
		document.body.setAttribute('data-tab', name);
		TABS.forEach(function (tab) { if (views[tab]) views[tab].el.hidden = tab !== name; });
		Array.prototype.forEach.call(els.tabs.querySelectorAll('.tab'), function (a) { if (a.getAttribute('data-tab') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

		if (prev !== name) {
			if (prev && views[prev] && views[prev].onHide) views[prev].onHide();
			els.content.scrollTop = 0;
		}
		var sub = null;
		if (SUBS[name]) {
			sub = SUBS[name].indexOf(parts[1]) !== -1 ? parts[1] : String(C.ps.getSetting(SUB_SETTING[name]));
			if (SUBS[name].indexOf(sub) === -1) sub = SUBS[name][0];
			views[name].setSub(sub);
			if (C.ps.getSetting(SUB_SETTING[name]) !== sub) { C.ps.setSetting(SUB_SETTING[name], sub); }
			lastHash = '#' + name + '/' + sub;
		} else lastHash = '#' + parts.map(encodeURIComponent).join('/');

		if (name === 'collection') {
			var id = parts[1] || null;
			views.collection.setSelected(id);
			if (!id) detailPushed = false;
			else if (!wideMq.matches) { var tt = document.getElementById('detail-title'); if (tt) tt.focus({ preventScroll: true }); }
			if (prev !== name) views.collection.refreshAll();
		} else if (prev !== name || views[name].dirty) {
			if (views[name].onShow && prev !== name) views[name].onShow();
			refreshView(name);
		}
	}

	/* ---------- sign-in events ---------- */

	function onUser(user) {
		authReady = true;
		var cloud = SH.cloud;
		if (user) {
			C.sync.attach(user.uid).then(function () { SH.art.check(user.uid, cloud); finishEmailLink(); });
			finishEmailLink();
		} else C.sync.attach('');
		if (els.about.open) buildAbout();
	}
	function setSyncDot(status) { els.aboutBtn.setAttribute('data-sync', status); }

	/* ---------- start ---------- */

	function applyStatic() {
		Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (e) { e.textContent = t(e.getAttribute('data-i18n')); });
		Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-label]'), function (e) { e.setAttribute('aria-label', t(e.getAttribute('data-i18n-label'))); });
	}

	function start() {
		C.gd = dom.buildIndexes(D);
		C.ps = st.createPlayerState(C.gd);
		C.art = SH.art;
		C.sync = SH.sync.createSync({ ps: C.ps, storage: makeStorage(), cloud: cloudAdapter, askConflict: askConflict });
		C.sync.loadLocal();
		C.sync.start();
		C.ps.onUndo(toastUndo);
		C.ps.onChange(onStateChange);
		C.sync.onData(function () { refreshAllViews(); if (els.about.open) buildAbout(); if (views.collection) views.collection.onData(); });
		C.sync.onStatus(function (s) { setSyncDot(s); if (els.about.open) buildAbout(); });
		SH.art.onChange(function () { refreshAllViews(); });

		views.collection = SH.screens.collection(api);
		views.fusions = SH.screens.fusions();
		views.rebirth = SH.screens.rebirth();
		views.upgrades = SH.screens.upgrades();
		views.info = SH.screens.info();
		TABS.forEach(function (tab) { views[tab].el.hidden = true; els.view.appendChild(views[tab].el); });
		window.addEventListener('online', function () { C.sync.retryNow(); });
		document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') C.sync.flush(); else C.sync.retryNow(); });
		window.addEventListener('pagehide', function () { C.sync.flush(); });
		route();
		if (location.hash === '#about') openAbout();

		SH.cloud.init(LANG);
		SH.cloud.onUser(onUser);
	}

	function init() {
		els.content = document.getElementById('main');
		els.view = document.getElementById('view');
		els.tabs = document.getElementById('tabs');
		els.about = document.getElementById('about');
		els.aboutBtn = document.getElementById('about-btn');
		applyStatic();

		els.aboutBtn.addEventListener('click', function (e) { e.preventDefault(); aboutPushed = true; location.hash = '#about'; });
		els.about.addEventListener('close', function () { if (location.hash === '#about') closeAbout(); });
		els.about.addEventListener('click', function (e) { if (e.target === els.about) els.about.close(); });
		document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !els.about.open && !document.querySelector('dialog.sheet[open]') && views.collection && views.collection.getSelected() && !wideMq.matches) api.closeDetail(); });
		wideMq.addEventListener('change', function () { if (views.collection) views.collection.renderDetail(); });
		window.addEventListener('hashchange', route);

		fetch(DATA_URL, { credentials: 'same-origin' })
			.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
			.then(function (j) { if (!dom.isUsableData(j)) throw new Error('bad data'); D = j; })
			.catch(function (err) { console.warn('Shop Hand data not loaded:', err); D = null; })
			.then(function () {
				clear(els.view);
				if (!D) {
					els.view.appendChild(h('section', { class: 'view' }, ui.emptyState(t('No data yet'), t('Data could not be loaded.'))));
					buildAbout();
					if (location.hash === '#about') openAbout();
					return;
				}
				start();
			});
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
