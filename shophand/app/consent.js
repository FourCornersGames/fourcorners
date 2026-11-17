/* Shop Hand consent (milestone W5). Online saving is off until the player turns it on.
   The choice is kept on this device only, in localStorage key "shophand.consent": {v, at, age14}.
   v = the version of the privacy policy that was shown (a date). at = when the player agreed (ISO date).
   age14 = true: the player ticked "I am 14 or older, or a parent or guardian agrees for me."
   No DOM and no network here, so Node tests can drive it. The storage is given in. */
(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.SH = root.SH || {}; root.SH.consent = api; }
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var KEY = 'shophand.consent';
	var POLICY_VERSION = '2026-11-16';

	function create(storage, now) {
		var clock = now || function () { return new Date(); };
		var self = {};
		// The stored record when it is valid, else null. Nothing else counts as consent.
		self.get = function () {
			var text = null, r = null;
			try { text = storage.getItem(KEY); } catch (e) { return null; }
			if (!text || text.length > 200) return null;
			try { r = JSON.parse(text); } catch (e) { return null; }
			if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
			if (typeof r.v !== 'string' || !r.v || r.age14 !== true) return null;
			if (typeof r.at !== 'string' || isNaN(Date.parse(r.at))) return null;
			return { v: r.v, at: r.at, age14: true };
		};
		self.has = function () { return !!self.get(); };
		// Store the consent. Returns false when the box was not ticked or the storage is blocked.
		self.grant = function (age14) {
			if (age14 !== true) return false;
			var rec = { v: POLICY_VERSION, at: clock().toISOString(), age14: true };
			try { storage.setItem(KEY, JSON.stringify(rec)); } catch (e) { return false; }
			return self.has();
		};
		// Put back a record that get() returned earlier (used when a turn-off or delete fails).
		self.restore = function (rec) { if (rec) { try { storage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* storage blocked */ } } };
		self.revoke = function () { try { storage.removeItem(KEY); } catch (e) { /* nothing to remove */ } };
		return self;
	}

	return { create: create, KEY: KEY, POLICY_VERSION: POLICY_VERSION };
});
