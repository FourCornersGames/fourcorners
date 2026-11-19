/* Bolt Bucket dev panel (Firebase project shophand-fcg; the page is https://boltbucket.fourcornersgames.ca).
 *
 * The players (every users/{uid} document, newest save first), a player page (name, uid, kind,
 * a short summary, the whole save as JSON, a backup download, a rename) and the Trusted switch
 * (art_readers/{uid}: Trusted players can see the droid images).
 * Public profiles (Jay, 2026-11-19): every live profile with its owner, a Copy link and Open button, and
 * Take down. A take-down deletes profiles/{code} and profile_owners/{code} and writes profile_blocks/{uid}
 * in one commit; the block stops the player's app from publishing the page again (firestore.rules).
 * Lift removes the block.
 * Settings (Jay, 2026-11-19): the switch config/public.art_public turns the droid portraits off for everyone
 * except Trusted players.
 *
 * PRIVACY RULE (owner decision): the panel shows only the player's chosen name, the uid, the
 * account kind and the save data. It never reads Auth user records, emails, real names or photos
 * (no Identity Toolkit lookups, only the token refresh of the dev's own session).
 *
 * Talks to Firebase Auth (token refresh) and Firestore over REST (no SDK). Every request is checked
 * by the rules: isAdmin() in the app repo's firebase/firestore.rules (admins/{uid} with
 * enabled: true). Sign-in happens on the gateway (/dev/). The rules let an admin change only the
 * `name` field of a save, so a rename uses updateMask.fieldPaths=name.
 */
"use strict";

const API_KEY = "AIzaSyDyinZnuBvonwHGqq-DsD3dV9KuQ4Uyg9k"; // Public, same as web/app/firebase-config.js in the app repo.
const PROJECT_ID = "shophand-fcg";
const DB_NAME = `projects/${PROJECT_ID}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DB_NAME}`;
const PAGE_SIZE = 100;
const REFRESH_KEY = "sh-dev-refresh";
const EMAIL_KEY = "sh-dev-email"; // The dev's own login email (set by the gateway), never a player's.

const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");

// --- Small helpers -------------------------------------------------------

function esc(value) {
	return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(text, bad = false) {
	const el = $("#toast");
	el.textContent = text;
	el.classList.toggle("bad", bad);
	el.classList.add("show");
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => el.classList.remove("show"), bad ? 6000 : 2600);
}

function store(key, value) {
	try {
		if (value === undefined) return sessionStorage.getItem(key);
		if (value === null) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, value);
	} catch (_) { /* Storage blocked. */ }
	return null;
}

// A Firestore timestamp string -> milliseconds (0 when missing).
function ms(ts) {
	const t = Date.parse(ts || "");
	return Number.isFinite(t) ? t : 0;
}

// Local time, for a reader: "2026-11-16 14:05".
function localTime(t) {
	const v = typeof t === "number" ? t : ms(t);
	if (!v) return "";
	const d = new Date(v), p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function download(filename, text) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The same rule as the page and the Firestore rules: 3 to 24 characters, letters, digits, space, _ and -.
function validName(v) {
	if (typeof v !== "string") return null;
	const n = v.trim();
	return n.length >= 3 && Array.from(n).length <= 24 && /^[\p{L}\p{N} _-]+$/u.test(n) ? n : null;
}
const NAME_HINT = "Use 3 to 24 characters: letters, digits, space, _ and -.";

// --- Firestore values ----------------------------------------------------

function decode(v) {
	if (!v || typeof v !== "object") return null;
	if ("stringValue" in v) return v.stringValue;
	if ("integerValue" in v) return Number(v.integerValue);
	if ("doubleValue" in v) return Number(v.doubleValue);
	if ("booleanValue" in v) return v.booleanValue;
	if ("timestampValue" in v) return v.timestampValue;
	if ("nullValue" in v) return null;
	if ("mapValue" in v) return decodeFields(v.mapValue.fields);
	if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
	return null;
}

function decodeFields(fields) {
	const out = {};
	for (const [k, v] of Object.entries(fields || {})) out[k] = decode(v);
	return out;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// A users/{uid} document -> {uid, name, kind, updated (ms), state}. Only the fields the app writes.
function toPlayer(doc) {
	const f = decodeFields(doc.fields);
	return {
		uid: doc.name.split("/").pop(),
		name: typeof f.name === "string" ? f.name : "",
		kind: typeof f.kind === "string" ? f.kind : "",
		updated: ms(f.updated),
		updatedText: typeof f.updated === "string" ? f.updated : "",
		state: isObj(f.state) ? f.state : {},
	};
}

// What the save holds, from the state shape in web/app/state.js in the app repo (toDict).
function summarize(state) {
	const owned = isObj(state.owned) ? state.owned : {};
	let droids = 0, variants = 0;
	for (const tiers of Object.values(owned)) {
		if (Array.isArray(tiers) && tiers.length) { droids++; variants += tiers.length; }
	}
	const fusions = isObj(state.fusions) ? state.fusions : {};
	let inProgress = 0;
	for (const f of Object.values(fusions)) {
		if (isObj(f) && isObj(f.variants) && Object.values(f.variants).some((v) => isObj(v) && v.working === true)) inProgress++;
	}
	const num = (v, d) => (typeof v === "number" ? Math.trunc(v) : d);
	return {
		droids, variants, inProgress,
		rebirth: num(state.rebirth_number, 0),
		path: Math.max(num(state.rebirth_cycle, 1), 1), // The page shows the path, 1 to 6 (2026-11-19).
	};
}

// --- Auth (the gateway signs in; this keeps the session fresh) ----------

const auth = { uid: "", idToken: "", refreshToken: "", expiresAt: 0, email: "" };

async function postJson(url, body, form = false) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
		body: form ? new URLSearchParams(body) : JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
	return data;
}

function setSession(uid, idToken, refreshToken, expiresIn) {
	Object.assign(auth, { uid, idToken, refreshToken, expiresAt: Date.now() + (Number(expiresIn) - 60) * 1000 });
	store(REFRESH_KEY, refreshToken);
}

async function token() {
	if (auth.idToken && Date.now() < auth.expiresAt) return auth.idToken;
	if (!auth.refreshToken) throw new Error("Signed out.");
	const data = await postJson(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
		{ grant_type: "refresh_token", refresh_token: auth.refreshToken }, true);
	setSession(data.user_id, data.id_token, data.refresh_token, data.expires_in);
	return auth.idToken;
}

// Sign out of every game's panel (the gateway's sessions too) and go back to the gateway (/dev/).
function signOutEverywhere() {
	try {
		for (const k of Object.keys(sessionStorage)) if (/^(ia|yt|bk|sh)-dev-|^dev-/.test(k)) sessionStorage.removeItem(k);
	} catch (_) { /* Storage blocked: nothing kept anyway. */ }
	location.href = "/dev/";
}

// --- Firestore REST ------------------------------------------------------

class FsError extends Error {
	constructor(status, message) { super(message); this.status = status; }
}

// what: a short phrase for the refused message ("read the players", "rename this player").
async function fs(method, url, body, what = "do that") {
	let res;
	try {
		res = await fetch(url.startsWith("http") ? url : `${FS}/${url}`, {
			method,
			headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch (e) {
		if (e instanceof TypeError) throw new FsError(0, `Could not reach Google's servers to ${what}. Check the connection and try again.`);
		throw e;
	}
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		let msg = data?.error?.message || `HTTP ${res.status}`;
		if (res.status === 403) msg = `Refused: the Firestore rules did not allow this account to ${what}. Is the admin rules version deployed, and is admins/{uid} set with enabled: true (uid ${auth.uid})?`;
		else if (res.status === 401) msg = `Refused: the session is no longer valid, so ${what} failed. Sign out and sign in again.`;
		else if (res.status === 404) msg = `Not found: could not ${what}. The document may have been deleted.`;
		else if (res.status === 429) msg = `Google says too many requests, so ${what} failed. Wait a moment and try again.`;
		throw new FsError(res.status, msg);
	}
	return data;
}

async function getDoc(path, what) {
	try {
		return await fs("GET", path, undefined, what);
	} catch (e) {
		if (e.status === 404) return null;
		throw e;
	}
}

// One page of players, newest save first. Returns {rows, more}.
async function queryPlayers(offset) {
	const rows = await fs("POST", `${FS}:runQuery`, {
		structuredQuery: {
			from: [{ collectionId: "users" }],
			orderBy: [{ field: { fieldPath: "updated" }, direction: "DESCENDING" }],
			offset, limit: PAGE_SIZE,
		},
	}, "read the players");
	const docs = rows.filter((r) => r.document).map((r) => toPlayer(r.document));
	return { rows: docs, more: docs.length === PAGE_SIZE };
}

// Every document of a small collection: [{id, f (decoded fields)}].
async function allDocs(coll, what) {
	const rows = await fs("POST", `${FS}:runQuery`, { structuredQuery: { from: [{ collectionId: coll }], limit: 5000 } }, what);
	return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split("/").pop(), f: decodeFields(r.document.fields) }));
}

// Several documents in one request: {id: decoded fields} (a missing one is left out). mask: field names to read.
async function batchGet(coll, ids, mask, what) {
	const out = {};
	for (let i = 0; i < ids.length; i += 100) {
		const part = ids.slice(i, i + 100);
		const body = { documents: part.map((id) => `${DB_NAME}/${coll}/${id}`) };
		if (mask) body.mask = { fieldPaths: mask };
		const rows = await fs("POST", `${FS}:batchGet`, body, what);
		for (const r of rows) if (r.found) out[r.found.name.split("/").pop()] = decodeFields(r.found.fields);
	}
	return out;
}

const PROFILE_URL = "https://boltbucket.fourcornersgames.ca/p/";

// The live profiles: [{code, uid, name (the page's name, if shared), player (the save's name), updated (ms)}],
// newest first, and the blocks: {uid: {by, at, code}}. Since 2026-11-18 the owner is in profile_owners/{code};
// an older page still holds the uid itself.
async function loadProfiles() {
	const [pages, owners, blocks] = await Promise.all([
		allDocs("profiles", "read the public profiles"),
		allDocs("profile_owners", "read the profile owners"),
		allDocs("profile_blocks", "read the profile take-downs"),
	]);
	const ownerOf = {};
	for (const o of owners) ownerOf[o.id] = typeof o.f.uid === "string" ? o.f.uid : "";
	const rows = pages.map((p) => ({ code: p.id, uid: ownerOf[p.id] || (typeof p.f.uid === "string" ? p.f.uid : ""), name: typeof p.f.name === "string" ? p.f.name : "", updated: ms(p.f.updated), player: "" }));
	const blockMap = {};
	for (const b of blocks) blockMap[b.id] = b.f;
	const uids = [...new Set(rows.map((r) => r.uid).concat(Object.keys(blockMap)).filter(Boolean))];
	const names = uids.length ? await batchGet("users", uids, ["name"], "read the player names") : {};
	for (const r of rows) r.player = names[r.uid]?.name || "";
	rows.sort((x, y) => y.updated - x.updated);
	return { rows, blocks: blockMap, names };
}

// Take a profile down: the page and its owner record go, and the account is blocked from publishing again.
async function takeDownProfile(code, uid) {
	const writes = [{ delete: `${DB_NAME}/profiles/${code}` }, { delete: `${DB_NAME}/profile_owners/${code}` }];
	if (uid) writes.push({
		update: { name: `${DB_NAME}/profile_blocks/${uid}`, fields: { by: { stringValue: auth.uid }, code: { stringValue: code } } },
		updateTransforms: [{ fieldPath: "at", setToServerValue: "REQUEST_TIME" }],
	});
	await fs("POST", `${FS}:commit`, { writes }, "take this profile down");
}

// The studio switch (Jay, 2026-11-19): config/public.art_public. false = portraits only for Trusted players.
async function getArtPublic() {
	const doc = await getDoc("config/public", "read the portrait switch");
	const f = decodeFields(doc?.fields);
	return { on: f.art_public !== false, by: f.by || "", at: f.at || "" };
}
async function setArtPublic(on) {
	await fs("POST", `${FS}:commit`, { writes: [{
		update: { name: `${DB_NAME}/config/public`, fields: { art_public: { booleanValue: !!on }, by: { stringValue: auth.uid } } },
		updateTransforms: [{ fieldPath: "at", setToServerValue: "REQUEST_TIME" }],
	}] }, "change the portrait switch");
}

async function liftBlock(uid) {
	await fs("DELETE", `profile_blocks/${encodeURIComponent(uid)}`, undefined, "lift the take-down");
}

async function copyText(text) {
	try { await navigator.clipboard.writeText(text); toast("Link copied."); }
	catch (_) { prompt("Copy the link:", text); }
}

// The uids in art_readers (Trusted): {uid: {by, at}}.
async function trustedMap() {
	const rows = await fs("POST", `${FS}:runQuery`, { structuredQuery: { from: [{ collectionId: "art_readers" }], limit: 5000 } }, "read the Trusted list");
	const out = {};
	for (const r of rows) if (r.document) out[r.document.name.split("/").pop()] = decodeFields(r.document.fields);
	return out;
}

async function setTrusted(uid, on) {
	const name = `${DB_NAME}/art_readers/${uid}`;
	if (on) {
		// One commit so the server sets `at` (the rules need at == request.time) and `by` is the admin's uid.
		await fs("POST", `${FS}:commit`, { writes: [{
			update: { name, fields: { by: { stringValue: auth.uid } } },
			updateTransforms: [{ fieldPath: "at", setToServerValue: "REQUEST_TIME" }],
			currentDocument: { exists: false },
		}] }, "turn Trusted on");
	} else {
		await fs("DELETE", `art_readers/${encodeURIComponent(uid)}`, undefined, "turn Trusted off");
	}
}

// The rules allow an admin to change only `name`, plus `updated` set to the server time.
// `updated` must move, or the player's device does not see a cloud change and writes its old name back.
async function renamePlayer(uid, name) {
	await fs("POST", `${FS}:commit`, { writes: [{
		update: { name: `${DB_NAME}/users/${uid}`, fields: { name: { stringValue: name } } },
		updateMask: { fieldPaths: ["name"] },
		updateTransforms: [{ fieldPath: "updated", setToServerValue: "REQUEST_TIME" }],
		currentDocument: { exists: true },
	}] }, "rename this player");
}

// --- Boot and routing ----------------------------------------------------

async function boot() {
	$("#who").hidden = true;
	$("#signin").hidden = true;
	view.innerHTML = "";
	auth.refreshToken = auth.refreshToken || store(REFRESH_KEY) || "";
	auth.email = auth.email || store(EMAIL_KEY) || store("dev-email") || "";
	if (!auth.refreshToken) {
		// One sign-in for every game: the gateway (/dev/) signs in and comes back here.
		location.replace("/dev/#boltbucket");
		return;
	}
	view.innerHTML = `<p class="loading">Signing in…</p>`;
	try {
		await token();
		const me = await getDoc(`admins/${auth.uid}`, "check admin access");
		if (decodeFields(me?.fields).enabled !== true) {
			throw new Error(`Signed in, but this account isn't a Bolt Bucket admin: it needs an admins/{uid} document with enabled: true (uid ${auth.uid}).`);
		}
	} catch (e) {
		auth.refreshToken = "";
		store(REFRESH_KEY, null);
		$("#signin").hidden = false;
		$("#signin-error").textContent = e.message;
		view.innerHTML = "";
		return;
	}
	$("#who-name").textContent = auth.email || "dev";
	$("#who").hidden = false;
	route();
}

function route() {
	if (!auth.uid) return;
	const [, name = "players", arg = ""] = location.hash.split("/");
	window.scrollTo(0, 0);
	if (name === "player" && arg) showPlayer(decodeURIComponent(arg));
	else if (name === "profiles") showProfiles();
	else if (name === "settings") showSettings();
	else showPlayers();
	for (const n of document.querySelectorAll(".nav-tabs a")) n.classList.toggle("on", n.getAttribute("href") === `#/${name === "player" ? "players" : name}`);
}

window.addEventListener("hashchange", route);
$("#sign-out").addEventListener("click", signOutEverywhere);

function failed(e) {
	view.innerHTML = `<div class="card"><h2>Couldn't load that</h2><p class="error">${esc(e.message)}</p><p><a href="#/players">Back to the players</a></p></div>`;
}

// --- Players ---------------------------------------------------------------

const list = { rows: [], more: false, trusted: {}, query: "" };

function drawRows() {
	const q = list.query;
	const rows = list.rows.filter((p) => !q || p.name.toLowerCase().includes(q));
	$("#rows").innerHTML = rows.map((p) => `<tr>
		<td><a class="name-link" href="#/player/${encodeURIComponent(p.uid)}">${esc(p.name || "(no name)")}</a></td>
		<td>${p.kind ? `<span class="badge ${p.kind === "guest" ? "" : "accent"}">${esc(p.kind)}</span>` : `<span class="muted small">unknown</span>`}</td>
		<td>${esc(localTime(p.updated))}</td>
		<td class="num">${summarize(p.state).droids}</td>
		<td>${list.trusted[p.uid] ? `<span class="badge ok">Trusted</span>` : ""}</td>
	</tr>`).join("") || `<tr><td colspan="5" class="muted">${list.rows.length ? "No loaded player matches." : "No players yet."}</td></tr>`;
	$("#shown").textContent = `${rows.length} of ${list.rows.length} loaded`;
	$("#more").hidden = !list.more;
}

async function showPlayers(reload = false) {
	view.innerHTML = `<p class="loading">Loading players…</p>`;
	try {
		if (reload || !list.rows.length) {
			const [page, trusted] = await Promise.all([queryPlayers(0), trustedMap()]);
			Object.assign(list, { rows: page.rows, more: page.more, trusted });
		} else {
			list.trusted = await trustedMap(); // The Trusted badges may have changed on a player page.
		}
		view.innerHTML = `
			<div class="toolbar">
				<h1 style="margin:0">Players</h1>
				<span class="muted small" id="shown"></span>
				<span class="spacer"></span>
				<input id="search" type="search" placeholder="Search name" aria-label="Search players by name" value="${esc(list.query)}">
				<button class="btn ghost small" id="reload" type="button">Reload</button>
			</div>
			<div class="card table-wrap"><table>
				<thead><tr><th>Name</th><th>Kind</th><th>Last save</th><th class="num">Droids owned</th><th>Trusted</th></tr></thead>
				<tbody id="rows"></tbody>
			</table></div>
			<div class="more" id="more" hidden><button class="btn ghost" id="load-more" type="button">Load more</button></div>
			<p class="muted small">Newest save first, ${PAGE_SIZE} at a time. Search looks at the rows loaded so far. Names are the players' chosen names: no emails or real names are read.</p>`;
		drawRows();
		$("#search").addEventListener("input", (e) => { list.query = e.target.value.trim().toLowerCase(); drawRows(); });
		$("#reload").addEventListener("click", () => showPlayers(true));
		$("#load-more").addEventListener("click", async (e) => {
			e.target.disabled = true;
			try {
				const page = await queryPlayers(list.rows.length);
				list.rows.push(...page.rows);
				list.more = page.more;
				drawRows();
			} catch (err) { toast(err.message, true); }
			e.target.disabled = false;
		});
	} catch (e) { failed(e); }
}

// --- Settings ------------------------------------------------------------------

async function showSettings() {
	view.innerHTML = `<p class="loading">Loading settings…</p>`;
	try {
		let s = await getArtPublic();
		view.innerHTML = `
			<div class="toolbar"><h1 style="margin:0">Settings</h1></div>
			<div class="card">
				<h2>Droid portraits</h2>
				<div class="switch-row">
					<input type="checkbox" role="switch" id="art-public">
					<label for="art-public">Show the droid portraits to everyone</label>
				</div>
				<p class="muted small" id="art-info"></p>
				<p class="muted small">Off: only Trusted players (see each player page) see the portraits; everyone else sees letter tiles, also on public profiles. Players' pages pick up a change within 30 minutes, or when the app comes back to the front. The image files stay on the site: to remove them for real, delete them and deploy.</p>
				<p class="error" id="art-error" role="alert"></p>
			</div>`;
		const box = $("#art-public");
		const show = () => {
			box.checked = s.on;
			$("#art-info").textContent = (s.on ? "On: everyone sees the portraits." : "Off: only Trusted players see the portraits.") + (s.at ? ` Last changed ${localTime(s.at)}.` : " Never changed (on by default).");
		};
		show();
		box.addEventListener("change", async () => {
			const on = box.checked;
			if (!on && !confirm("Turn the droid portraits off for everyone except Trusted players?")) { box.checked = true; return; }
			box.disabled = true; $("#art-error").textContent = "";
			try { await setArtPublic(on); s = await getArtPublic(); toast(on ? "Portraits on for everyone." : "Portraits off, except Trusted players."); }
			catch (e) { $("#art-error").textContent = e.message; }
			box.disabled = false; show();
		});
	} catch (e) { failed(e); }
}

// --- Public profiles ---------------------------------------------------------

const TAKE_DOWN_ASK = "Take this profile down?\n\nThe page is deleted at once, and this account cannot publish a new profile until you lift the block here. The player sees a message that the studio took it down.";

async function showProfiles() {
	view.innerHTML = `<p class="loading">Loading public profiles…</p>`;
	try {
		const { rows, blocks, names } = await loadProfiles();
		const blockedUids = Object.keys(blocks);
		view.innerHTML = `<div id="pf-wrap">
			<div class="toolbar">
				<h1 style="margin:0">Public profiles</h1>
				<span class="muted small">${rows.length} live${blockedUids.length ? `, ${blockedUids.length} blocked` : ""}</span>
				<span class="spacer"></span>
				<button class="btn ghost small" id="reload" type="button">Reload</button>
			</div>
			<div class="card table-wrap"><table>
				<thead><tr><th>Profile name</th><th>Player</th><th>Updated</th><th>Link</th><th></th></tr></thead>
				<tbody>${rows.map((r) => `<tr data-code="${esc(r.code)}" data-uid="${esc(r.uid)}">
					<td>${r.name ? esc(r.name) : `<span class="muted small">(name hidden)</span>`}</td>
					<td>${r.uid ? `<a class="name-link" href="#/player/${encodeURIComponent(r.uid)}">${esc(r.player || "(no save)")}</a>` : `<span class="muted small">no owner</span>`}</td>
					<td>${esc(localTime(r.updated))}</td>
					<td class="link-cell"><code>${esc(r.code)}</code>
						<button class="btn ghost small" data-act="copy" type="button">Copy link</button>
						<a class="btn ghost small" href="${PROFILE_URL}${encodeURIComponent(r.code)}" target="_blank" rel="noopener">Open</a></td>
					<td><button class="btn small danger" data-act="down" type="button">Take down</button></td>
				</tr>`).join("") || `<tr><td colspan="5" class="muted">No public profiles.</td></tr>`}</tbody>
			</table></div>
			${blockedUids.length ? `<h2 style="margin-top:24px">Blocked from publishing</h2>
			<div class="card table-wrap"><table>
				<thead><tr><th>Player</th><th>Taken down</th><th>Old link code</th><th></th></tr></thead>
				<tbody>${blockedUids.map((u) => `<tr data-uid="${esc(u)}">
					<td><a class="name-link" href="#/player/${encodeURIComponent(u)}">${esc(names[u]?.name || "(no save)")}</a></td>
					<td>${esc(localTime(blocks[u].at))}</td>
					<td><code>${esc(blocks[u].code || "")}</code></td>
					<td><button class="btn ghost small" data-act="lift" type="button">Lift block</button></td>
				</tr>`).join("")}</tbody>
			</table></div>` : ""}
			<p class="muted small">"Profile name" is what the page shows (the player may hide it). "Player" is the name in the save. Take down deletes the page and stops this account from publishing again until you lift the block.</p></div>`;
		$("#reload").addEventListener("click", () => showProfiles());
		$("#pf-wrap").addEventListener("click", async (e) => {
			const b = e.target.closest("button[data-act]");
			if (!b) return;
			const tr = b.closest("tr"), code = tr.dataset.code, uid = tr.dataset.uid;
			if (b.dataset.act === "copy") { copyText(PROFILE_URL + code); return; }
			if (b.dataset.act === "down" && !confirm(TAKE_DOWN_ASK)) return;
			if (b.dataset.act === "lift" && !confirm("Lift the block? This player can then publish a public profile again.")) return;
			b.disabled = true;
			try {
				if (b.dataset.act === "down") { await takeDownProfile(code, uid); toast("Profile taken down."); }
				else { await liftBlock(uid); toast("Block lifted."); }
				showProfiles();
			} catch (err) { toast(err.message, true); b.disabled = false; }
		});
	} catch (e) { failed(e); }
}

// --- One player ---------------------------------------------------------------

// The same JSON the Bolt Bucket page imports (its export format: state.js toDict).
function backupText(p) { return JSON.stringify(p.state, null, 2); }

async function showPlayer(uid) {
	view.innerHTML = `<p class="loading">Loading player…</p>`;
	try {
		const [doc, trustedDoc] = await Promise.all([getDoc(`users/${encodeURIComponent(uid)}`, "read this player"), getDoc(`art_readers/${encodeURIComponent(uid)}`, "read the Trusted state")]);
		if (!doc) {
			view.innerHTML = `<div class="card"><h2>No save for this uid</h2><p class="muted"><code>${esc(uid)}</code> has no users document (the player may have deleted the account).</p><p><a href="#/players">Back to the players</a></p></div>`;
			return;
		}
		const p = toPlayer(doc);
		const s = summarize(p.state);
		let trusted = trustedDoc ? decodeFields(trustedDoc.fields) : null;
		view.innerHTML = `
			<p class="small"><a href="#/players">&larr; Players</a></p>
			<div class="player-head">
				<h1 id="p-name">${esc(p.name || "(no name)")}</h1>
				${p.kind ? `<span class="badge ${p.kind === "guest" ? "" : "accent"}">${esc(p.kind)}</span>` : ""}
				<span class="badge ok" id="p-badge" ${trusted ? "" : "hidden"}>Trusted</span>
				<span class="uid">${esc(uid)}</span>
			</div>
			<div class="grid">
				<div class="card">
					<h2>Player</h2>
					<dl class="kv">
						<dt>Name</dt><dd id="p-name2">${esc(p.name)}</dd>
						<dt>Uid</dt><dd><code>${esc(uid)}</code></dd>
						<dt>Kind</dt><dd>${esc(p.kind || "unknown (saved before the kind field)")}</dd>
						<dt>Last save</dt><dd>${esc(localTime(p.updated))} <span class="muted small">${esc(p.updatedText)}</span></dd>
					</dl>
					<form class="rename-row" id="rename-form">
						<input id="rename-input" type="text" maxlength="24" value="${esc(p.name)}" aria-label="New name" autocomplete="off">
						<button class="btn small" id="rename-btn" type="submit">Rename</button>
					</form>
					<p class="muted small">Fixes a bad name. ${esc(NAME_HINT)}</p>
					<p class="error" id="rename-error" role="alert"></p>
				</div>
				<div class="card">
					<h2>Save summary</h2>
					<dl class="kv">
						<dt>Droids owned</dt><dd>${s.droids}</dd>
						<dt>Variants owned</dt><dd>${s.variants}</dd>
						<dt>Rebirth</dt><dd>${s.rebirth}</dd>
							<dt>Path</dt><dd>${s.path}</dd>
						<dt>Fusions in progress</dt><dd>${s.inProgress}</dd>
					</dl>
					<div class="toolbar" style="margin-top:12px"><button class="btn small" id="backup" type="button">Download backup</button></div>
					<p class="muted small">The backup is the same file the Bolt Bucket page imports.</p>
				</div>
				<div class="card">
					<h2>Trusted</h2>
					<div class="switch-row">
						<input type="checkbox" role="switch" id="trusted" ${trusted ? "checked" : ""}>
						<label for="trusted">Can see the droid images</label>
					</div>
					<p class="muted small" id="trusted-info"></p>
					<p class="error" id="trusted-error" role="alert"></p>
				</div>
					<div class="card">
						<h2>Public profile</h2>
						<div id="pp-box"><p class="muted small">Loading…</p></div>
					</div>
					<div class="card wide">
						<h2>Save data</h2>
					<details><summary>Show the whole save (JSON)</summary><pre class="json small">${esc(JSON.stringify(p.state, null, 2))}</pre></details>
				</div>
			</div>`;

		const showTrusted = () => {
			$("#trusted").checked = !!trusted;
			$("#p-badge").hidden = !trusted;
			$("#trusted-info").textContent = trusted
				? `Trusted since ${localTime(trusted.at)} by admin ${trusted.by || "unknown"}.`
				: "Not trusted. Turn on to let this player see the droid images.";
		};
		showTrusted();

			// Public profile: the owner records with this uid (and an older page that holds the uid), and a block.
			const drawProfile = async () => {
				const box = $("#pp-box");
				try {
					const { rows, blocks } = await loadProfiles();
					const mine = rows.filter((r) => r.uid === uid), block = blocks[uid];
					box.innerHTML = (mine.length ? mine.map((r) => `<p><span class="badge ok">On</span> <code>${esc(r.code)}</code> <span class="muted small">updated ${esc(localTime(r.updated))}</span></p>
						<div class="toolbar" data-code="${esc(r.code)}"><button class="btn ghost small" data-act="copy" type="button">Copy link</button>
						<a class="btn ghost small" href="${PROFILE_URL}${encodeURIComponent(r.code)}" target="_blank" rel="noopener">Open</a>
						<button class="btn small danger" data-act="down" type="button">Take down</button></div>`).join("")
						: `<p class="muted">No public profile.</p>`)
						+ (block ? `<p><span class="badge">Blocked</span> <span class="muted small">taken down ${esc(localTime(block.at))} (old code ${esc(block.code || "")})</span></p>
						<div class="toolbar"><button class="btn ghost small" data-act="lift" type="button">Lift block</button></div>` : "");
				} catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
			};
			drawProfile();
			$("#pp-box").addEventListener("click", async (e) => {
				const b = e.target.closest("button[data-act]");
				if (!b) return;
				const code = b.closest("[data-code]")?.dataset.code;
				if (b.dataset.act === "copy") { copyText(PROFILE_URL + code); return; }
				if (b.dataset.act === "down" && !confirm(TAKE_DOWN_ASK)) return;
				if (b.dataset.act === "lift" && !confirm("Lift the block? This player can then publish a public profile again.")) return;
				b.disabled = true;
				try {
					if (b.dataset.act === "down") { await takeDownProfile(code, uid); toast("Profile taken down."); }
					else { await liftBlock(uid); toast("Block lifted."); }
					drawProfile();
				} catch (err) { toast(err.message, true); b.disabled = false; }
			});

			$("#backup").addEventListener("click", () => download(`bolt-bucket-backup-${uid}-${new Date().toISOString().slice(0, 10)}.json`, backupText(p)));

		$("#rename-form").addEventListener("submit", async (e) => {
			e.preventDefault();
			const err = $("#rename-error");
			err.textContent = "";
			const n = validName($("#rename-input").value);
			if (!n) { err.textContent = NAME_HINT; return; }
			if (n === p.name) { err.textContent = "That is already the name."; return; }
			$("#rename-btn").disabled = true;
			try {
				await renamePlayer(uid, n);
				p.name = n;
				$("#p-name").textContent = $("#p-name2").textContent = n;
				$("#rename-input").value = n;
				const row = list.rows.find((r) => r.uid === uid);
				if (row) row.name = n;
				toast("Name changed.");
			} catch (ex) { err.textContent = ex.message; }
			$("#rename-btn").disabled = false;
		});

		$("#trusted").addEventListener("change", async (e) => {
			const box = e.target, on = box.checked, err = $("#trusted-error");
			err.textContent = "";
			if (on && !confirm("Trusted players see the droid portraits even when they are turned off for everyone (Settings). Only trust people you know.")) { box.checked = false; return; }
			box.disabled = true;
			try {
				await setTrusted(uid, on);
				trusted = on ? decodeFields((await getDoc(`art_readers/${encodeURIComponent(uid)}`, "read the Trusted state"))?.fields) : null;
				if (on && !trusted) trusted = { by: auth.uid, at: new Date().toISOString() };
				list.trusted = { ...list.trusted };
				if (on) list.trusted[uid] = trusted; else delete list.trusted[uid];
				toast(on ? "Trusted turned on." : "Trusted turned off.");
			} catch (ex) {
				err.textContent = ex.message;
				if (ex.status === 409 || ex.status === 400) { // Already on (or already off) somewhere else: show the truth.
					try { const d = await getDoc(`art_readers/${encodeURIComponent(uid)}`, "read the Trusted state"); trusted = d ? decodeFields(d.fields) : null; } catch (_) { /* keep what we had */ }
				}
			}
			box.disabled = false;
			showTrusted();
		});
	} catch (e) { failed(e); }
}

boot();
