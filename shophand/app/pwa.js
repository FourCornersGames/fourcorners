/* Shop Hand installable web app: registers the service worker (own files only, no Google request), shows the
   "new version is ready" banner and keeps the browser's install prompt for the About page.
   The page never reloads by itself: a waiting worker only starts when the player taps Reload. */
(function () {
	'use strict';
	var SH = window.SH = window.SH || {};
	var ui = SH.ui, t = ui.t, h = ui.h, LANG = ui.LANG;
	var pwa = SH.pwa = {};
	var deferred = null, listeners = [], banner = null, reloading = false, registered = false;

	function notify() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* a listener failed */ } }); }
	pwa.onChange = function (fn) { listeners.push(fn); };

	/* ---------- install (About) ---------- */

	function standalone() {
		try { return !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)); } catch (e) { return false; }
	}
	function isIos() {
		var ua = navigator.userAgent || '';
		return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	}
	// 'prompt': the browser offered an install button (Android, desktop Chrome). 'ios': show the Share hint.
	// 'installed': already open as an app. '': nothing to show.
	pwa.installState = function () {
		if (standalone()) return 'installed';
		if (deferred) return 'prompt';
		if (isIos()) return 'ios';
		return '';
	};
	pwa.install = function () {
		var d = deferred; if (!d) return Promise.resolve(false);
		deferred = null; notify();
		return d.prompt().then(function () { return d.userChoice; }).then(function (c) { return !!c && c.outcome === 'accepted'; }, function () { return false; });
	};
	window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; notify(); });
	window.addEventListener('appinstalled', function () { deferred = null; notify(); });

	/* ---------- update banner ---------- */

	function showBanner(worker) {
		if (banner) return;
		var reload = h('button', { class: 'btn primary', type: 'button', onclick: function () { reloading = true; worker.postMessage('skip-waiting'); } }, t('Reload'));
		var later = h('button', { class: 'btn', type: 'button', onclick: function () { if (banner.parentNode) banner.parentNode.removeChild(banner); banner = null; } }, t('Later'));
		banner = h('div', { class: 'update-banner', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'update-text' }, t('A new version is ready.')), reload, later);
		document.body.appendChild(banner);
	}
	function watch(reg) {
		function check() { if (reg.waiting && navigator.serviceWorker.controller) showBanner(reg.waiting); }
		check();
		reg.addEventListener('updatefound', function () {
			var nw = reg.installing; if (!nw) return;
			nw.addEventListener('statechange', function () { if (nw.state === 'installed') check(); });
		});
	}

	/* ---------- register ---------- */

	pwa.register = function () {
		if (registered || !('serviceWorker' in navigator) || !window.isSecureContext) return;
		registered = true;
		var base = LANG === 'fr' ? '/fr/shophand/' : '/shophand/';
		// Reload once, and only after the player tapped Reload (reloading is set there).
		navigator.serviceWorker.addEventListener('controllerchange', function () { if (reloading) { reloading = false; location.reload(); } });
		navigator.serviceWorker.register(base + 'sw.js', { scope: base }).then(watch, function (e) { console.warn('Shop Hand offline copy not started:', e && e.message); });
	};
	if (document.readyState === 'complete') pwa.register(); else window.addEventListener('load', pwa.register);
})();
