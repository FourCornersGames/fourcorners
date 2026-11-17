/* Shop Hand service worker core (shared by /shophand/sw.js and /fr/shophand/sw.js). Plain JS, no build step.
   It keeps a copy of the page's OWN files so the page opens full screen and works offline. Personal data never goes in here.
   Rules:
   - The cache name holds the release version, so a new release makes a new cache and the old ones are deleted when it activates.
   - The page (navigation) is network first, with the cached copy as fallback. Files under /shophand/app/, the data, the icons and the
     fonts are cache first (their URLs carry ?v=version).
   - Only same-origin GET requests for the paths in route() are handled. Everything else (Google, Firebase, gstatic, the rest of the
     site, /dev/) is not touched: the worker does not call respondWith for it.
   - A new worker waits. The page shows "A new version is ready. Reload" and sends 'skip-waiting' when the player agrees.
   The version is set in sw.js (SH_SW.version). Keep it equal to <meta name="sh-version"> (see the README, "bump the version"). */
(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else {
		root.SHSW = api;
		if (root.SH_SW && typeof root.addEventListener === 'function' && typeof root.skipWaiting === 'function') api.attach(root, root.SH_SW);
	}
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var APP_FILES = ['app.css', 'firebase-config.js', 'strings.js', 'domain.js', 'state.js', 'sync.js', 'consent.js', 'ui.js', 'pwa.js', 'cloud.js', 'art.js', 'screens.js', 'app.js'];
	var ICONS = ['/shophand/icons/icon-192.png', '/shophand/icons/icon-512.png', '/shophand/icons/icon-maskable-512.png', '/shophand/icons/apple-touch-icon.png'];
	var FONTS = ['/assets/fonts/lato-semibold.woff2', '/assets/fonts/baloo2.woff2'];
	var DATA = '/shophand/data/gamedata.json';
	var ASSET_PREFIXES = ['/shophand/app/', '/shophand/data/', '/shophand/icons/', '/assets/fonts/'];
	var HOSTS_NEVER = /(^|\.)(googleapis\.com|gstatic\.com|google\.com|firebaseapp\.com|firebaseio\.com|firebase\.com|googleusercontent\.com)$/i;

	function isVersion(v) { return typeof v === 'string' && /^\d{8}-\d{1,3}$/.test(v); }
	function pagePath(lang) { return lang === 'fr' ? '/fr/shophand/' : '/shophand/'; }
	function manifestPath(lang) { return pagePath(lang) + 'manifest.webmanifest'; }
	function cachePrefix(lang) { return 'shophand-' + (lang === 'fr' ? 'fr' : 'en') + '-'; }
	function cacheName(lang, v) { return cachePrefix(lang) + v; }

	// The files to keep at install. The versioned URLs are exactly the ones the page asks for.
	function shellUrls(lang, v) {
		var out = [pagePath(lang), manifestPath(lang)];
		APP_FILES.forEach(function (f) { out.push('/shophand/app/' + f + '?v=' + v); });
		out.push(DATA + '?v=' + v);
		return out.concat(ICONS, FONTS);
	}

	// What to do with a request. u: {origin, hostname, pathname}. req: {method, mode}. Returns 'page', 'asset' or null (do not touch).
	function route(u, req, selfOrigin, lang) {
		if (!u || !req || req.method !== 'GET') return null;
		if (u.origin !== selfOrigin) return null;
		if (HOSTS_NEVER.test(String(u.hostname || ''))) return null;
		var path = u.pathname, page = pagePath(lang);
		if (req.mode === 'navigate') return path === page || path === page + 'index.html' ? 'page' : null;
		if (path === manifestPath(lang)) return 'asset';
		for (var i = 0; i < ASSET_PREFIXES.length; i++) if (path.indexOf(ASSET_PREFIXES[i]) === 0 && path.indexOf('..') === -1) return 'asset';
		return null;
	}

	function attach(self, cfg) {
		var lang = cfg.lang === 'fr' ? 'fr' : 'en', version = cfg.version, NAME = cacheName(lang, version);
		var PAGE_WAIT_MS = 4000;

		self.addEventListener('install', function (e) {
			// No skipWaiting here: a new worker waits until the player chooses to reload.
			e.waitUntil(caches.open(NAME).then(function (cache) {
				return Promise.all(shellUrls(lang, version).map(function (u) {
					// 'reload': never take the file from the browser's HTTP cache into the precache.
					return fetch(new Request(u, { cache: 'reload', credentials: 'same-origin' })).then(function (res) {
						if (!res.ok) throw new Error('precache ' + u + ' ' + res.status);
						return cache.put(u, res);
					});
				}));
			}));
		});

		self.addEventListener('activate', function (e) {
			e.waitUntil(caches.keys().then(function (keys) {
				return Promise.all(keys.filter(function (k) { return k.indexOf(cachePrefix(lang)) === 0 && k !== NAME; }).map(function (k) { return caches.delete(k); }));
			}).then(function () { return self.clients.claim(); }));
		});

		self.addEventListener('message', function (e) { if (e.data === 'skip-waiting') self.skipWaiting(); });

		function networkFirstPage(req) {
			var key = pagePath(lang);
			return caches.open(NAME).then(function (cache) {
				return new Promise(function (resolve, reject) {
					var settled = false;
					function useCache(err) {
						cache.match(key).then(function (hit) { if (settled) return; settled = true; if (hit) resolve(hit); else reject(err); });
					}
					var timer = setTimeout(function () { useCache(new Error('slow')); }, PAGE_WAIT_MS);
					fetch(req).then(function (res) {
						clearTimeout(timer);
						if (res && res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone());
						if (!settled) { settled = true; resolve(res); }
					}, function (err) { clearTimeout(timer); useCache(err); });
				});
			});
		}
		function cacheFirst(req) {
			return caches.open(NAME).then(function (cache) {
				return cache.match(req).then(function (hit) {
					if (hit) return hit;
					return fetch(req).then(function (res) {
						if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
						return res;
					});
				});
			});
		}

		self.addEventListener('fetch', function (e) {
			var req = e.request, url = new URL(req.url);
			var kind = route(url, req, self.location.origin, lang);
			if (!kind) return;   // not ours: the browser handles it as if no worker existed
			e.respondWith(kind === 'page' ? networkFirstPage(req) : cacheFirst(req));
		});
	}

	return { APP_FILES: APP_FILES, ICONS: ICONS, FONTS: FONTS, DATA: DATA, isVersion: isVersion, pagePath: pagePath, manifestPath: manifestPath,
		cachePrefix: cachePrefix, cacheName: cacheName, shellUrls: shellUrls, route: route, attach: attach };
});
