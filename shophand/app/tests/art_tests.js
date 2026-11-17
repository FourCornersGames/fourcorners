/* Tests of art.js (private art) in a Node vm with a fake window, a fake IndexedDB and a fake cloud.
   They count the requests: the index path must not list private_art, and it must fetch only new or changed images. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'art.js'), 'utf8');

function fakeIdb() {
	var data = {};   // store name -> {key: value}
	function store(name) {
		var m = data[name] = data[name] || {};
		function req(fn) { return { result: fn() }; }
		return {
			get: function (k) { return req(function () { return m[k]; }); },
			getAll: function () { return req(function () { return Object.keys(m).sort().map(function (k) { return m[k]; }); }); },
			getAllKeys: function () { return req(function () { return Object.keys(m).sort(); }); },
			put: function (v, k) { return req(function () { m[k] = v; return k; }); },
			clear: function () { return req(function () { Object.keys(m).forEach(function (k) { delete m[k]; }); }); }
		};
	}
	var db = { createObjectStore: function () {}, transaction: function () {
		var t = {};
		t.objectStore = function (n) { return store(n); };
		setImmediate(function () { setImmediate(function () { if (t.oncomplete) t.oncomplete(); }); });
		return t;
	} };
	return { data: data, open: function () {
		var rq = {};
		setImmediate(function () { rq.result = db; if (rq.onupgradeneeded) rq.onupgradeneeded(); if (rq.onsuccess) rq.onsuccess(); });
		return rq;
	} };
}

function load() {
	var idb = fakeIdb(), n = 0;
	var win = { SH: {}, indexedDB: idb };
	var ctx = { window: win, indexedDB: idb, localStorage: { removeItem: function () {} }, Promise: Promise, Uint8Array: Uint8Array,
		Blob: function (parts, o) { this.parts = parts; this.type = o && o.type; },
		atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
		URL: { createObjectURL: function () { return 'blob:' + (++n); }, revokeObjectURL: function () {} } };
	vm.createContext(ctx);
	vm.runInContext(SRC, ctx);
	return { art: ctx.window.SH.art, idb: idb };
}
function b64(s) { return Buffer.from(s).toString('base64'); }
// A fake cloud with the same calls as cloud.js. index: array, or null when the index is missing.
function fakeCloud(images, index) {
	var c = { trusted: true, calls: { isTrusted: 0, getArtIndex: 0, listArt: 0, getArt: 0, getArtMany: 0, docsFetched: 0 }, index: index, images: images, fetched: [] };
	c.isTrusted = function () { c.calls.isTrusted++; return Promise.resolve(c.trusted); };
	c.getArtIndex = function () { c.calls.getArtIndex++; return Promise.resolve(c.index ? c.index.slice() : null); };
	c.listArt = function () { c.calls.listArt++; return Promise.resolve(Object.keys(c.images).map(function (id) { return { id: id, updated: c.images[id].updated }; })); };
	c.getArt = function (id) { c.calls.getArt++; c.calls.docsFetched++; c.fetched.push(id); return Promise.resolve(c.images[id] ? c.images[id].b64 : ''); };
	c.getArtMany = function (ids) {
		c.calls.getArtMany++; var out = {};
		ids.forEach(function (id) { c.calls.docsFetched++; c.fetched.push(id); if (c.images[id]) out[id] = c.images[id].b64; });
		return Promise.resolve(out);
	};
	return c;
}
function makeImages(n, t) { var o = {}; for (var i = 0; i < n; i++) o['d' + i] = { updated: t, b64: b64('png' + i) }; return o; }
function toIndex(images) { return Object.keys(images).map(function (id) { return { id: id, updated: images[id].updated }; }); }
async function settle() { for (var i = 0; i < 30; i++) await new Promise(function (r) { setImmediate(r); }); }

async function run(h) {
	var ok = h.ok, eq = h.eq;
	// 1. Index present, empty cache: 1 index read, no listing, 25 images in batches of 10 (3 requests).
	var imgs = makeImages(25, 1000), L = load(), cl = fakeCloud(imgs, toIndex(imgs));
	await L.art.check('u1', cl); await settle();
	eq([cl.calls.getArtIndex, cl.calls.listArt, cl.calls.getArt], [1, 0, 0], 'art index: one index read, no listing, no single reads');
	eq(cl.calls.getArtMany, 3, 'art index: 25 images are fetched in 3 batches'); eq(cl.calls.docsFetched, 25, 'art index: every image once');
	ok(L.art.has() && L.art.url('d0') && L.art.url('d24'), 'art index: the images show');
	// 2. A new page load, same account, nothing changed: the index is read, no image is fetched.
	var cl2 = fakeCloud(imgs, toIndex(imgs));
	L.art.forget(); await L.art.check('u1', cl2); await settle();
	eq([cl2.calls.getArtIndex, cl2.calls.listArt, cl2.calls.getArtMany, cl2.calls.getArt], [1, 0, 0, 0], 'art index: nothing changed, no image fetched');
	ok(L.art.url('d3'), 'art index: the cached image still shows');
	// 3. One image changed and one is new: only these two are fetched.
	var imgs3 = JSON.parse(JSON.stringify(imgs)); imgs3.d4.updated = 2000; imgs3.d4.b64 = b64('new4'); imgs3.d99 = { updated: 1500, b64: b64('png99') };
	var cl3 = fakeCloud(imgs3, toIndex(imgs3));
	L.art.forget(); await L.art.check('u1', cl3); await settle();
	eq(cl3.fetched.sort(), ['d4', 'd99'], 'art index: only the changed and the new image are fetched'); eq(cl3.calls.listArt, 0, 'art index: no listing');
	ok(L.art.url('d99'), 'art index: the new image shows');
	// 4. An image removed from the index is dropped from the page.
	var imgs4 = JSON.parse(JSON.stringify(imgs3)); delete imgs4.d0; var cl4 = fakeCloud(imgs4, toIndex(imgs4));
	L.art.forget(); await L.art.check('u1', cl4); await settle();
	ok(!L.art.url('d0'), 'art index: an id that left the index does not show'); eq(cl4.calls.docsFetched, 0, 'art index: removal fetches nothing');
	// 5. Index missing: the old listing is used and still only changed images are fetched.
	var L5 = load(), imgs5 = makeImages(12, 500), cl5 = fakeCloud(imgs5, null);
	await L5.art.check('u2', cl5); await settle();
	eq([cl5.calls.getArtIndex, cl5.calls.listArt], [1, 1], 'fallback: index missing, the listing is used'); eq(cl5.calls.docsFetched, 12, 'fallback: all images fetched'); ok(L5.art.url('d11'), 'fallback: the images show');
	var cl5b = fakeCloud(imgs5, null); L5.art.forget(); await L5.art.check('u2', cl5b); await settle(); eq(cl5b.calls.docsFetched, 0, 'fallback: nothing changed, nothing fetched');
	// 6. Not trusted: no index, no listing, no image request.
	var L6 = load(), cl6 = fakeCloud(imgs, toIndex(imgs)); cl6.trusted = false;
	await L6.art.check('u3', cl6); await settle();
	eq([cl6.calls.isTrusted, cl6.calls.getArtIndex, cl6.calls.listArt, cl6.calls.getArtMany, cl6.calls.getArt], [1, 0, 0, 0, 0], 'art: a player who is not trusted makes no art request'); ok(!L6.art.has(), 'art: letter tiles stay');
	// 7. The index read is refused: nothing shows (same as a refused listing).
	var L7 = load(), cl7 = fakeCloud(imgs, toIndex(imgs)); cl7.getArtIndex = function () { return Promise.reject(Object.assign(new Error('denied'), { code: 'denied' })); };
	await L7.art.check('u4', cl7); await settle(); ok(!L7.art.has(), 'art: a refused index read shows no image');
}
module.exports = { run: run };
