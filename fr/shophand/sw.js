/* Old Bolt Bucket address (it was called Shop Hand here). This worker removes itself:
   it deletes the old caches (names that start with "shophand"), unregisters, and sends open pages to the new site.
   Keep this file here so browsers that still have the old worker find it and clean up. */
var NEW = 'https://boltbucket.fourcornersgames.ca';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
	e.waitUntil(caches.keys().then(function (keys) {
		return Promise.all(keys.filter(function (k) { return k.indexOf('shophand') === 0; }).map(function (k) { return caches.delete(k); }));
	}).then(function () {
		return self.registration.unregister();
	}).then(function () {
		return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	}).then(function (list) {
		list.forEach(function (c) {
			try {
				var u = new URL(c.url), p = u.pathname.replace(/index\.html$/, '');
				var to = p.indexOf('/fr/shophand/') === 0 ? '/fr/' + p.slice('/fr/shophand/'.length) : p.indexOf('/shophand/') === 0 ? '/' + p.slice('/shophand/'.length) : '/';
				c.navigate(NEW + to + u.search + u.hash);
			} catch (err) { /* this page cannot be moved: it will be moved the next time it loads */ }
		});
	}));
});
