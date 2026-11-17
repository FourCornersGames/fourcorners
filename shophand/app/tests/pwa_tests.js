/* Tests of the release version, the service worker rules, the toast timer, and the private art check (trusted or not). */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var dom = require('../domain.js');
var st = require('../state.js');
var core = require('../sw-core.js');

var SITE = path.join(__dirname, '..', '..', '..');
function read(rel) { return fs.readFileSync(path.join(SITE, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(SITE, rel)); }

function versionTests(h) {
	var pages = { en: 'shophand/index.html', fr: 'fr/shophand/index.html' };
	var versions = {};
	Object.keys(pages).forEach(function (lang) {
		var html = read(pages[lang]);
		var m = /<meta name="sh-version" content="([^"]*)">/.exec(html);
		h.ok(!!m && core.isVersion(m[1]), 'version: ' + lang + ' page has a valid sh-version meta');
		var v = m ? m[1] : '';
		versions[lang] = v;
		var refs = [], re = /(?:href|src)="(\/shophand\/app\/[^"]+)"/g, r;
		while ((r = re.exec(html))) refs.push(r[1]);
		h.ok(refs.length >= 12, 'version: ' + lang + ' page lists the app files (' + refs.length + ')');
		refs.forEach(function (u) { h.ok(u.slice(-('?v=' + v).length) === '?v=' + v, 'version: ' + lang + ' ' + u + ' carries ?v=' + v); });
		// The service worker keeps exactly the files the page loads.
		var files = refs.map(function (u) { return u.replace('/shophand/app/', '').replace(/\?.*$/, ''); }).sort();
		h.eq(files, core.APP_FILES.slice().sort(), 'version: ' + lang + ' page files equal the service worker precache list');
		var sw = read((lang === 'fr' ? 'fr/' : '') + 'shophand/sw.js');
		h.ok(sw.indexOf("version: '" + v + "'") !== -1, 'version: ' + lang + ' sw.js version equals the page version');
		h.ok(sw.indexOf("lang: '" + lang + "'") !== -1, 'version: ' + lang + ' sw.js language');
		h.ok(sw.indexOf("importScripts('/shophand/app/sw-core.js?v=" + v + "')") !== -1, 'version: ' + lang + ' sw.js imports the core with the same version');
		h.ok(html.indexOf('rel="manifest" href="' + core.manifestPath(lang) + '"') !== -1, 'version: ' + lang + ' page links its manifest');
		h.ok(html.indexOf('rel="apple-touch-icon"') !== -1 && html.indexOf('name="theme-color"') !== -1, 'version: ' + lang + ' page has apple-touch-icon and theme-color');
	});
	h.eq(versions.en, versions.fr, 'version: both languages have one version');
	h.ok(core.isVersion('20261116-1') && core.isVersion('20261116-12') && !core.isVersion('2026-11-16') && !core.isVersion('') && !core.isVersion(null) && !core.isVersion('20261116-'), 'version: format check');
	var readme = read('README.md');
	h.ok(/bump the version/i.test(readme), 'version: the README says to bump the version');
	// The version is read at run time from the meta tag (ui.js), and the data and vendor URLs use it.
	var ui = read('shophand/app/ui.js'), app = read('shophand/app/app.js'), cloud = read('shophand/app/cloud.js');
	h.ok(/SH\.versioned\s*=/.test(ui) && /SH\.versioned\(DATA_URL\)/.test(app) && /SH\.versioned \? SH\.versioned\(u\) : u/.test(cloud), 'version: data fetch and vendor scripts use SH.versioned');
}

function manifestTests(h) {
	['en', 'fr'].forEach(function (lang) {
		var rel = (lang === 'fr' ? 'fr/' : '') + 'shophand/manifest.webmanifest';
		var m = JSON.parse(read(rel));
		var page = core.pagePath(lang);
		h.eq(m.start_url, page, 'manifest ' + lang + ': start_url'); h.eq(m.scope, page, 'manifest ' + lang + ': scope');
		h.eq(m.display, 'standalone', 'manifest ' + lang + ': standalone'); h.eq(m.name, 'Shop Hand', 'manifest ' + lang + ': name'); h.eq(m.short_name, 'Shop Hand', 'manifest ' + lang + ': short_name');
		h.eq(m.lang, lang, 'manifest ' + lang + ': lang');
		h.ok(/^#[0-9a-f]{6}$/i.test(m.theme_color) && /^#[0-9a-f]{6}$/i.test(m.background_color), 'manifest ' + lang + ': colours');
		var sizes = m.icons.map(function (i) { return i.sizes + ':' + i.purpose; }).sort();
		h.eq(sizes, ['192x192:any', '512x512:any', '512x512:maskable'], 'manifest ' + lang + ': icons 192, 512 and maskable 512');
		m.icons.forEach(function (i) { h.ok(exists(i.src.slice(1)), 'manifest ' + lang + ': icon exists ' + i.src); });
	});
	core.ICONS.concat(core.FONTS, [core.DATA]).forEach(function (u) { h.ok(exists(u.slice(1)), 'precache file exists ' + u); });
	core.APP_FILES.forEach(function (f) { h.ok(exists('shophand/app/' + f), 'precache file exists app/' + f); });
	h.ok(exists('shophand/sw.js') && exists('fr/shophand/sw.js'), 'both service workers exist');
}

function routeTests(h) {
	var ORIGIN = 'https://fourcornersgames.ca';
	function r(url, mode, method, lang) { var u = new URL(url); return core.route(u, { method: method || 'GET', mode: mode || 'cors' }, ORIGIN, lang || 'en'); }
	h.eq(r(ORIGIN + '/shophand/', 'navigate'), 'page', 'route: English page is a page');
	h.eq(r(ORIGIN + '/shophand/?apiKey=x&oobCode=y', 'navigate'), 'page', 'route: the email-link page is a page');
	h.eq(r(ORIGIN + '/fr/shophand/', 'navigate', 'GET', 'fr'), 'page', 'route: French page in the French worker');
	h.eq(r(ORIGIN + '/fr/shophand/', 'navigate', 'GET', 'en'), null, 'route: the English worker ignores the French page');
	h.eq(r(ORIGIN + '/shophand/privacy.html', 'navigate'), null, 'route: legal pages pass through');
	h.eq(r(ORIGIN + '/dev/', 'navigate'), null, 'route: /dev/ is not touched'); h.eq(r(ORIGIN + '/', 'navigate'), null, 'route: the site root is not touched');
	h.eq(r(ORIGIN + '/dev/shophand/gateway.js'), null, 'route: dev scripts are not touched');
	h.eq(r(ORIGIN + '/yarntoss/index.html', 'navigate'), null, 'route: other pages are not touched');
	h.eq(r(ORIGIN + '/shophand/app/app.js?v=20261116-1'), 'asset', 'route: an app file');
	h.eq(r(ORIGIN + '/shophand/app/vendor/firebase-auth-compat.js?v=20261116-1'), 'asset', 'route: a vendor file');
	h.eq(r(ORIGIN + '/shophand/data/gamedata.json?v=20261116-1'), 'asset', 'route: the data');
	h.eq(r(ORIGIN + '/assets/fonts/baloo2.woff2'), 'asset', 'route: a font'); h.eq(r(ORIGIN + '/shophand/icons/icon-192.png'), 'asset', 'route: an icon');
	h.eq(r(ORIGIN + '/assets/images/hero.jpg'), null, 'route: other assets are not touched');
	h.eq(r(ORIGIN + '/shophand/app/app.js', 'cors', 'POST'), null, 'route: POST is never handled');
	[
		'https://firestore.googleapis.com/v1/projects/shophand-fcg/databases/(default)/documents:batchGet',
		'https://identitytoolkit.googleapis.com/v1/accounts:signUp', 'https://securetoken.googleapis.com/v1/token',
		'https://apis.google.com/js/api.js', 'https://www.gstatic.com/firebasejs/x.js', 'https://shophand-fcg.firebaseapp.com/__/auth/handler',
		'https://accounts.google.com/o/oauth2', 'https://fonts.googleapis.com/css', 'https://evil.example/shophand/app/app.js'
	].forEach(function (u) { h.eq(r(u), null, 'route: not handled ' + new URL(u).hostname); h.eq(r(u, 'navigate'), null, 'route: not handled (navigation) ' + new URL(u).hostname); });
	// Even a same-origin look-alike on a Google host name never counts.
	h.eq(core.route({ origin: 'https://x.googleapis.com', hostname: 'x.googleapis.com', pathname: '/shophand/app/app.js' }, { method: 'GET', mode: 'cors' }, 'https://x.googleapis.com', 'en'), null, 'route: a Google host is never handled, even as the own origin');
	// The cache names.
	h.eq(core.cacheName('en', '20261116-1'), 'shophand-en-20261116-1', 'cache name en'); h.eq(core.cacheName('fr', '20261116-1'), 'shophand-fr-20261116-1', 'cache name fr');
	h.ok(core.cacheName('fr', '1').indexOf(core.cachePrefix('en')) !== 0, 'cache names: the languages do not delete each other');
	var urls = core.shellUrls('fr', '20261116-1');
	h.ok(urls.indexOf('/fr/shophand/') !== -1 && urls.indexOf('/shophand/data/gamedata.json?v=20261116-1') !== -1 && urls.indexOf('/shophand/app/app.js?v=20261116-1') !== -1, 'shell urls: page, data and code with the version');
	h.ok(urls.every(function (u) { return u.charAt(0) === '/' && u.indexOf('//') === -1; }), 'shell urls: all own paths');
}

// A fake clock with timers.
function fakeClock() {
	var now = 0, next = 1, tm = {};
	return {
		now: function () { return now; },
		timers: { set: function (f, ms) { tm[next] = { at: now + ms, f: f }; return next++; }, clear: function (id) { delete tm[id]; } },
		advance: function (ms) {
			var end = now + ms;
			for (;;) {
				var ids = Object.keys(tm).filter(function (k) { return tm[k].at <= end; }).sort(function (a, b) { return tm[a].at - tm[b].at; });
				if (!ids.length) break;
				var t = tm[ids[0]]; delete tm[ids[0]]; now = Math.max(now, t.at); t.f();
			}
			now = end;
		}
	};
}
function timerTests(h) {
	var c = fakeClock(), fired = 0;
	var t = dom.pauseTimer(function () { fired++; }, 3000, c.timers, c.now);
	c.advance(2999); h.eq(fired, 0, 'toast timer: not fired at 2.999 s'); c.advance(1); h.eq(fired, 1, 'toast timer: fires at 3 s');
	c.advance(10000); h.eq(fired, 1, 'toast timer: fires once');
	fired = 0; c = fakeClock(); t = dom.pauseTimer(function () { fired++; }, 3000, c.timers, c.now);
	c.advance(1000); t.pause(); h.ok(!t.running(), 'toast timer: paused'); h.eq(t.left(), 2000, 'toast timer: 2 s left after 1 s');
	c.advance(60000); h.eq(fired, 0, 'toast timer: never fires while paused');
	t.resume(); c.advance(1999); h.eq(fired, 0, 'toast timer: after resume it waits the time that was left'); c.advance(1); h.eq(fired, 1, 'toast timer: fires after the rest of the time');
	fired = 0; c = fakeClock(); t = dom.pauseTimer(function () { fired++; }, 3000, c.timers, c.now);
	c.advance(500); t.pause(); c.advance(500); t.resume(); t.resume(); c.advance(500); t.pause(); t.pause(); c.advance(9000); t.resume();
	h.eq(t.left(), 2000, 'toast timer: double pause and double resume do not change the time'); c.advance(2000); h.eq(fired, 1, 'toast timer: total un-paused time is 3 s');
	fired = 0; c = fakeClock(); t = dom.pauseTimer(function () { fired++; }, 3000, c.timers, c.now); t.cancel(); c.advance(5000); t.resume();
	h.eq(fired, 0, 'toast timer: a cancelled timer never fires, not even after resume');
	var ui = read('shophand/app/ui.js');
	h.ok(/TOAST_MS = ui\.TOAST_MS = 3000/.test(ui) && !/5000/.test(ui), 'toast: 3 s by default, no 5 s left');
	h.ok(/pointerenter/.test(ui) && /focusin/.test(ui), 'toast: pauses on hover and focus');
	h.ok(/bottom: calc\(5rem \+ env\(safe-area-inset-bottom\)\)/.test(read('shophand/app/app.css')), 'toast: above the tab bar with a margin on a phone');
}

function firstFoundTests(h) {
	h.eq(st.firstFound(null), null, 'firstFound: null'); h.eq(st.firstFound([{ missing: 'projects/p/databases/(default)/documents/art_readers/u' }]), null, 'firstFound: missing is a normal no');
	h.eq(st.firstFound([]), null, 'firstFound: empty'); h.eq(st.firstFound({ error: {} }), null, 'firstFound: an error object');
	var d = { name: 'x', fields: { by: { stringValue: 'a' } }, updateTime: 't' };
	h.eq(st.firstFound([{ found: d }]), d, 'firstFound: a found document');
}

// art.js in a sandbox: no IndexedDB, a fake cloud that counts the requests.
function loadArt() {
	var blobs = 0;
	var win = { SH: {}, atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); }, Blob: function () { blobs++; } };
	win.window = win; win.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };
	win.localStorage = { _m: { 'shophand.artdenied': '{"uid":"u","at":1}' }, removeItem: function (k) { delete this._m[k]; }, getItem: function (k) { return this._m[k] || null; }, setItem: function (k, v) { this._m[k] = v; } };
	win.Uint8Array = Uint8Array; win.Object = Object; win.Date = Date; win.JSON = JSON; win.Promise = Promise; win.Error = Error;
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'art.js'), 'utf8'), win);
	return win;
}
function fakeCloud(trusted, opts) {
	opts = opts || {};
	var c = { trustedCalls: 0, listCalls: 0, getCalls: 0 };
	c.isTrusted = function () { c.trustedCalls++; return opts.trustedError ? Promise.reject(opts.trustedError) : Promise.resolve(trusted); };
	c.listArt = function () { c.listCalls++; return opts.listError ? Promise.reject(opts.listError) : Promise.resolve([{ id: 'bb_8', updated: 5 }, { id: 'r2_d2', updated: 6 }]); };
	c.getArt = function () { c.getCalls++; return Promise.resolve('aGk='); };
	return c;
}

function artTests(h) {
	var win = loadArt();
	h.ok(win.localStorage.getItem('shophand.artdenied') === null, 'art: the old 10-minute denied marker is removed');
	var art = win.SH.art, c = fakeCloud(false);
	return art.check('player1', c).then(function () {
		h.eq([c.trustedCalls, c.listCalls, c.getCalls], [1, 0, 0], 'art: not trusted asks once for its own record and never for private_art');
		h.ok(!art.has(), 'art: not trusted has no images');
		return art.check('player1', c);
	}).then(function () {
		h.eq(c.trustedCalls, 1, 'art: the same account is not asked again');
		art.forget(); return art.check('player1', c);
	}).then(function () {
		h.eq([c.trustedCalls, c.listCalls], [2, 0], 'art: forget (sign-in or link) asks again, still no private_art');
		var w2 = loadArt(), c2 = fakeCloud(true);
		return w2.SH.art.check('owner1', c2).then(function () {
			h.eq([c2.trustedCalls, c2.listCalls, c2.getCalls], [1, 1, 2], 'art: trusted lists private_art and loads the images');
			h.ok(w2.SH.art.has() && w2.SH.art.url('bb_8') === 'blob:x', 'art: trusted shows the images');
		});
	}).then(function () {
		var w3 = loadArt(), c3 = fakeCloud(true, { trustedError: { code: 'offline' } });
		return w3.SH.art.check('owner1', c3).then(function () {
			h.eq([c3.trustedCalls, c3.listCalls], [1, 0], 'art: offline on the trust check makes no image request');
			return w3.SH.art.check('owner1', c3);
		}).then(function () { h.eq(c3.trustedCalls, 2, 'art: offline is tried again at the next check'); });
	}).then(function () {
		var w4 = loadArt(), c4 = fakeCloud(true, { listError: { code: 'denied' } });
		return w4.SH.art.check('p', c4).then(function () { h.ok(!w4.SH.art.has(), 'art: a refused list (rules changed) falls back to no images'); return w4.SH.art.check('p', c4); })
			.then(function () { h.eq(c4.listCalls, 1, 'art: a refused list is not retried in the same page'); });
	}).then(function () {
		var cl = read('shophand/app/cloud.js'), ar = read('shophand/app/art.js');
		h.ok(/art_readers\/' \+ uid/.test(cl) && /:batchGet/.test(cl.slice(cl.indexOf('cloud.isTrusted'))), 'art: isTrusted uses :batchGet on art_readers (no 404)');
		h.ok(ar.indexOf('DENIED_MS') === -1, 'art: no 10-minute marker code left');
	});
}

exports.run = function (h) {
	versionTests(h); manifestTests(h); routeTests(h); timerTests(h); firstFoundTests(h);
	return artTests(h);
};
