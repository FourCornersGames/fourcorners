/* IdleAdventure dev panel.
 *
 * Talks to Firebase Auth, Firestore and the Realtime Database over their REST
 * APIs, the same way the game does (no SDK, nothing loaded from a third party).
 * Every read and write is checked by the game's Firebase rules: isAdmin() in
 * the IdleAdventure repo's firebase/firestore.rules (an admins/{uid} document)
 * and admins/{uid} = true in firebase/database.rules.json. See that repo's
 * docs/multiplayer.md ("Dev panel") and this repo's README.md.
 *
 * Where things live (all per server):
 *   Firestore  players/{uid}/characters/{server}            the save: {save (JSON string), save_counter, device_id, saved_at, version, level}
 *   Firestore  players/{uid}/characters/{server}/versions/v0..v4   cloud history copies, same shape
 *   RTDB       names/{server}/{lowercase name} = uid         who holds a name
 *   RTDB       profiles/{server}/{uid} = {name, level}       what chat shows
 *   RTDB       devs/{uid}, bans/{uid}                        flags (true or absent)
 */
"use strict";

const API_KEY = "AIzaSyD6o36y0eVCQcWBCx7eCfons5QoqIfEmf8"; // Public, same as the game's data/online_config.tres.
const PROJECT_ID = "idleadventure-fcg";
const RTDB = "https://idleadventure-fcg-default-rtdb.firebaseio.com";
const DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const FALLBACK_SERVERS = [{ id: "s1", name: "Server 1", status: "new", opened_at: 1793750400, order: 0 }]; // As in online_config.tres.
// A dev edit raises save_counter by this much, so the player's device takes the edited save at its next launch
// (OnlineRules.resolve(): same device, cloud counter higher -> download). It must stay above any counter the device
// can reach while the edit waits.
const COUNTER_BUMP = 1000;
const SAVE_MAX = 900000; // isSave() in firestore.rules.
// The hero fields the Quick Edit card shows (paths inside the save's data).
const QUICK = [
	["game_state.hero.level", "Hero level"],
	["game_state.currencies.gold", "Gold"],
	["game_state.currencies.gems", "Gems"],
	["game_state.currencies.spell_scrolls", "Spell Scrolls"],
	["game_state.currencies.ore", "Ore"],
];

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
	} catch (_) { /* Storage blocked: the session just won't survive a reload. */ }
	return null;
}

function fmt(n) { return Number(n || 0).toLocaleString("en-CA"); }

// Unix seconds -> "5 min ago" / a date.
function when(sec) {
	sec = Number(sec);
	if (!sec) return "";
	const mins = Math.round((Date.now() / 1000 - sec) / 60);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
	return new Date(sec * 1000).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function getPath(obj, path) {
	return path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

function setPath(obj, path, value) {
	const keys = path.split(".");
	let o = obj;
	for (const k of keys.slice(0, -1)) {
		if (!o[k] || typeof o[k] !== "object") o[k] = {};
		o = o[k];
	}
	o[keys[keys.length - 1]] = value;
}

// The game's name rules (ChatRules.name_error), without the word filter: a dev may pick any name.
function nameError(name) {
	if (name.length < 3 || name.length > 16) return "Names are 3 to 16 characters.";
	if (!/^[A-Za-z]/.test(name)) return "Names start with a letter.";
	if (!/^[A-Za-z0-9_]+$/.test(name)) return "Names use only letters, digits and _.";
	return "";
}

const nameKey = (name) => name.toLowerCase();

function download(filename, text) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- Firestore values ----------------------------------------------------

function decode(v) {
	if (!v || typeof v !== "object") return null;
	if ("integerValue" in v) return Number(v.integerValue);
	if ("doubleValue" in v) return Number(v.doubleValue);
	if ("stringValue" in v) return v.stringValue;
	if ("booleanValue" in v) return v.booleanValue;
	if ("nullValue" in v) return null;
	if ("timestampValue" in v) return v.timestampValue;
	if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
	if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
	return JSON.stringify(v);
}

function decodeFields(fields) {
	const out = {};
	for (const [k, v] of Object.entries(fields || {})) out[k] = decode(v);
	return out;
}

// A character document -> {data (the parsed save, or null), save_counter, device_id, saved_at, version, level}.
function decodeSave(doc) {
	const f = decodeFields(doc?.fields);
	let data = null;
	try { data = typeof f.save === "string" ? JSON.parse(f.save) : null; } catch (_) { data = null; }
	return { data, raw: f.save, save_counter: f.save_counter || 0, device_id: f.device_id || "", saved_at: f.saved_at || 0, version: f.version || 0, level: f.level || 0 };
}

// The same document shape the game writes (OnlineRules.encode()).
function encodeSave(s) {
	return { fields: {
		save: { stringValue: JSON.stringify(s.data) },
		save_counter: { integerValue: String(Math.trunc(s.save_counter)) },
		device_id: { stringValue: String(s.device_id || "") },
		saved_at: { integerValue: String(Math.trunc(s.saved_at)) },
		version: { integerValue: String(Math.trunc(s.version)) },
		level: { integerValue: String(Math.trunc(Number(getPath(s.data, "game_state.hero.level")) || 0)) },
	} };
}

// --- Auth ----------------------------------------------------------------

const auth = { uid: "", idToken: "", refreshToken: "", expiresAt: 0, email: "" };

async function postJson(url, body, form = false) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
		body: form ? new URLSearchParams(body) : JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(friendlyAuthError(data?.error?.message || `HTTP ${res.status}`));
	return data;
}

function friendlyAuthError(code) {
	if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(code)) return "Wrong email or password.";
	if (/TOO_MANY_ATTEMPTS/.test(code)) return "Too many tries — wait a bit and try again.";
	if (/USER_DISABLED/.test(code)) return "This account is disabled.";
	if (/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(code)) return "Email / password sign-in isn't switched on in Firebase (Authentication → Sign-in method).";
	return code;
}

async function signIn(email, password) {
	const data = await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
		{ email, password, returnSecureToken: true });
	auth.email = data.email || email;
	store("ia-dev-email", auth.email);
	setSession(data.localId, data.idToken, data.refreshToken, data.expiresIn);
}

function setSession(uid, idToken, refreshToken, expiresIn) {
	Object.assign(auth, { uid, idToken, refreshToken, expiresAt: Date.now() + (Number(expiresIn) - 60) * 1000 });
	store("ia-dev-refresh", refreshToken);
}

async function token() {
	if (auth.idToken && Date.now() < auth.expiresAt) return auth.idToken;
	if (!auth.refreshToken) throw new Error("Signed out.");
	const data = await postJson(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
		{ grant_type: "refresh_token", refresh_token: auth.refreshToken }, true);
	setSession(data.user_id, data.id_token, data.refresh_token, data.expires_in);
	return auth.idToken;
}

function signOut() {
	Object.assign(auth, { uid: "", idToken: "", refreshToken: "", expiresAt: 0, email: "" });
	store("ia-dev-refresh", null);
	store("ia-dev-email", null);
	location.hash = "";
	boot();
}

// --- Firestore and Realtime Database REST --------------------------------

class ApiError extends Error {
	constructor(status, message) { super(message); this.status = status; }
}

async function fs(method, path, body) {
	const res = await fetch(path.startsWith("http") ? path : `${FS}/${path}`, {
		method,
		headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		let msg = data?.error?.message || `HTTP ${res.status}`;
		if (res.status === 403) msg = "Permission denied by the Firestore rules. Are the admin rules deployed, and does this account have an admins/{uid} document?";
		throw new ApiError(res.status, msg);
	}
	return data;
}

async function getDoc(path) {
	try {
		return await fs("GET", path);
	} catch (e) {
		if (e.status === 404) return null;
		throw e;
	}
}

async function runQuery(structuredQuery) {
	const rows = await fs("POST", `${FS}:runQuery`, { structuredQuery });
	return rows.filter((r) => r.document).map((r) => r.document);
}

async function listDocs(collection, params = "") {
	const docs = [];
	let pageToken = "";
	do {
		const page = await fs("GET", `${collection}?pageSize=300${params}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
		docs.push(...(page.documents || []));
		pageToken = page.nextPageToken || "";
	} while (pageToken && docs.length < 3000);
	return docs;
}

// Realtime Database: GET / PUT / PATCH / DELETE a path ("" = the root, for multi-path updates).
async function db(method, path, body) {
	const res = await fetch(`${RTDB}/${path}.json?auth=${encodeURIComponent(await token())}`, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) {
		let msg = data?.error || `HTTP ${res.status}`;
		if (res.status === 401 || res.status === 403) msg = "Permission denied by the Realtime Database rules. Are the admin rules deployed, and is admins/{uid} = true for this account?";
		throw new ApiError(res.status, msg);
	}
	return data;
}

const docId = (doc) => doc.name.split("/").pop();

// --- Boot and routing ----------------------------------------------------

let leaveGuard = null; // Returns true when the current view has unsaved changes.

async function boot() {
	$("#nav").hidden = $("#who").hidden = true;
	$("#signin").hidden = true;
	view.innerHTML = "";
	auth.refreshToken = auth.refreshToken || store("ia-dev-refresh") || "";
	auth.email = auth.email || store("ia-dev-email") || "";
	if (!auth.refreshToken) {
		$("#signin").hidden = false;
		return;
	}
	view.innerHTML = `<p class="loading">Signing in…</p>`;
	try {
		await token();
		const [inDb, inFs] = await Promise.all([
			db("GET", `admins/${auth.uid}`).catch(() => null),
			getDoc(`admins/${auth.uid}`).catch(() => null),
		]);
		if (inDb !== true || !inFs) {
			const missing = [inDb !== true ? "admins/{uid} = true in the Realtime Database" : "", !inFs ? "an admins/{uid} document in Firestore" : ""].filter(Boolean).join(" and ");
			throw new Error(`Signed in, but this account isn't an admin yet: it needs ${missing} (uid ${auth.uid}).`);
		}
	} catch (e) {
		auth.refreshToken = "";
		store("ia-dev-refresh", null);
		$("#signin").hidden = false;
		$("#signin-error").textContent = e.message;
		view.innerHTML = "";
		return;
	}
	$("#who-name").textContent = auth.email || "admin";
	$("#nav").hidden = $("#who").hidden = false;
	route();
}

function route() {
	if (!auth.uid) return;
	const [, name = "servers", a = "", b = ""] = location.hash.split("/");
	document.querySelectorAll("#nav a").forEach((el) => {
		if (el.dataset.view === "servers") el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
	});
	leaveGuard = null;
	window.scrollTo(0, 0);
	if (name === "server" && a) showServer(decodeURIComponent(a));
	else if (name === "player" && a && b) showPlayer(decodeURIComponent(a), decodeURIComponent(b));
	else showServers();
}

let lastHash = location.hash;
window.addEventListener("hashchange", () => {
	if (leaveGuard && leaveGuard() && !confirm("Discard your unsaved changes?")) {
		history.replaceState(null, "", lastHash);
		return;
	}
	lastHash = location.hash;
	route();
});
window.addEventListener("beforeunload", (e) => {
	if (leaveGuard && leaveGuard()) e.preventDefault();
});

$("#signin-form").addEventListener("submit", async (e) => {
	e.preventDefault();
	const form = e.target;
	$("#signin-error").textContent = "";
	form.querySelector("button").disabled = true;
	try {
		await signIn(form.email.value.trim(), form.password.value);
		form.password.value = "";
		boot();
	} catch (err) {
		$("#signin-error").textContent = err.message;
	} finally {
		form.querySelector("button").disabled = false;
	}
});
$("#sign-out").addEventListener("click", signOut);

function failed(e) {
	view.innerHTML = `<div class="card"><h2>Couldn't load that</h2><p class="error">${esc(e.message)}</p></div>`;
}

// --- Data shared by the views ---------------------------------------------

let serverCache = null;
let charCache = null; // server id -> [{uid, level, saved_at, save_counter, device_id}]

async function loadServers() {
	if (serverCache) return serverCache;
	const docs = await listDocs("servers");
	const list = docs.map((d) => ({ id: docId(d), ...decodeFields(d.fields) }));
	list.sort((x, y) => (Number(x.order) || 0) - (Number(y.order) || 0) || String(x.id).localeCompare(String(y.id)));
	serverCache = list.length ? list : FALLBACK_SERVERS;
	return serverCache;
}

// Every character on every server, without the saves (a collection group query on "characters").
async function loadCharacters() {
	if (charCache) return charCache;
	const docs = await runQuery({
		from: [{ collectionId: "characters", allDescendants: true }],
		select: { fields: ["level", "saved_at", "save_counter", "device_id"].map((fieldPath) => ({ fieldPath })) },
	});
	const out = {};
	for (const d of docs) {
		const parts = d.name.split("/"); // .../documents/players/{uid}/characters/{server}
		const i = parts.lastIndexOf("characters");
		if (i < 2 || parts[i - 2] !== "players") continue;
		const f = decodeFields(d.fields);
		(out[parts[i + 1]] ||= []).push({ uid: parts[i - 1], level: f.level || 0, saved_at: f.saved_at || 0, save_counter: f.save_counter || 0, device_id: f.device_id || "" });
	}
	charCache = out;
	return out;
}

function clearCaches() { serverCache = null; charCache = null; }

// --- Servers --------------------------------------------------------------

async function showServers() {
	view.innerHTML = `<p class="loading">Loading servers…</p>`;
	try {
		const [servers, chars] = await Promise.all([loadServers(), loadCharacters()]);
		view.innerHTML = `
			<div class="toolbar"><h1>Servers</h1><span class="spacer"></span><button class="btn ghost small" id="refresh" type="button">Refresh</button></div>
			<div class="server-list">${servers.map((s) => `
				<a href="#/server/${encodeURIComponent(s.id)}"><div class="card">
					<h2>${esc(s.name || s.id)} <span class="count">${fmt((chars[s.id] || []).length)} heroes</span></h2>
					<p class="muted small">id <code>${esc(s.id)}</code>${s.status ? ` · <span class="badge">${esc(s.status)}</span>` : ""}${s.opened_at ? ` · opened ${esc(when(s.opened_at))}` : ""}</p>
				</div></a>`).join("")}
			</div>
			${serverCache === FALLBACK_SERVERS ? `<p class="muted small">No <code>servers</code> documents in Firestore yet, so this is the game's built-in Server 1 (online_config.tres).</p>` : ""}`;
		$("#refresh").addEventListener("click", () => { clearCaches(); showServers(); });
	} catch (e) { failed(e); }
}

// --- One server's players ---------------------------------------------------

async function showServer(server) {
	view.innerHTML = `<p class="loading">Loading players…</p>`;
	try {
		const [servers, chars, profiles, names, devs, bans] = await Promise.all([
			loadServers(), loadCharacters(),
			db("GET", `profiles/${server}`), db("GET", `names/${server}`), db("GET", "devs"), db("GET", "bans"),
		]);
		const s = servers.find((x) => x.id === server) || { id: server };
		const rows = new Map();
		const row = (uid) => {
			if (!rows.has(uid)) rows.set(uid, { uid, name: "", level: 0, saved_at: 0, held: [], save: false });
			return rows.get(uid);
		};
		for (const c of chars[server] || []) Object.assign(row(c.uid), { level: c.level, saved_at: c.saved_at, save: true });
		for (const [uid, p] of Object.entries(profiles || {})) {
			const r = row(uid);
			r.name = p?.name || "";
			if (!r.level) r.level = Number(p?.level) || 0;
		}
		for (const [key, uid] of Object.entries(names || {})) row(uid).held.push(key);
		const list = [...rows.values()].sort((x, y) => (y.saved_at || 0) - (x.saved_at || 0) || x.uid.localeCompare(y.uid));

		view.innerHTML = `
			<div class="crumbs"><a href="#/servers">Servers</a> › ${esc(s.name || server)}</div>
			<div class="toolbar">
				<h1>${esc(s.name || server)}</h1>
				<input type="search" id="filter" placeholder="Filter by name or uid" autocomplete="off">
				<span class="spacer"></span>
				<button class="btn ghost small" id="refresh" type="button">Refresh</button>
			</div>
			<div class="card"><div class="table-wrap"><table>
				<thead><tr><th>Name</th><th>Names held</th><th>Player ID</th><th class="num">Level</th><th>Last save</th><th></th></tr></thead>
				<tbody id="rows"></tbody>
			</table></div></div>
			<p class="muted small">Names held: the <code>names/${esc(server)}</code> entries pointing at that player. A name held by a player with no profile, or a second name, is left over from an old rename or a lost guest — open the player to release it.</p>`;
		const draw = () => {
			const q = $("#filter").value.trim().toLowerCase();
			const shown = list.filter((r) => !q || r.uid.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.held.some((k) => k.includes(q)));
			$("#rows").innerHTML = shown.map((r) => {
				const odd = r.held.length > 1 || (r.held.length === 1 && nameKey(r.name) !== r.held[0]);
				const flags = [devs?.[r.uid] ? `<span class="badge ok">dev</span>` : "", bans?.[r.uid] ? `<span class="badge bad">banned</span>` : "",
					!r.save ? `<span class="badge">no save</span>` : ""].join(" ");
				return `<tr>
					<td><a class="name-link" href="#/player/${encodeURIComponent(server)}/${encodeURIComponent(r.uid)}">${esc(r.name || "(no profile)")}</a></td>
					<td>${r.held.map((k) => `<code>${esc(k)}</code>`).join(" ")}${odd ? ` <span class="badge warn">check</span>` : ""}</td>
					<td class="uid">${esc(r.uid)}</td>
					<td class="num">${r.level ? fmt(r.level) : ""}</td>
					<td>${esc(when(r.saved_at))}</td>
					<td>${flags}</td>
				</tr>`;
			}).join("") || `<tr><td colspan="6" class="muted">No players${q ? " match" : " on this server yet"}.</td></tr>`;
		};
		draw();
		$("#filter").addEventListener("input", draw);
		$("#filter").focus();
		$("#refresh").addEventListener("click", () => { clearCaches(); showServer(server); });
	} catch (e) { failed(e); }
}

// --- One player -------------------------------------------------------------

let P = null; // {server, uid, doc (decoded save or null), profile, held, dev, ban, versions, draft}

async function showPlayer(server, uid) {
	view.innerHTML = `<p class="loading">Loading player…</p>`;
	try {
		const base = `players/${uid}/characters/${server}`;
		const [doc, profile, names, dev, ban, versions] = await Promise.all([
			getDoc(base), db("GET", `profiles/${server}/${uid}`), db("GET", `names/${server}`),
			db("GET", `devs/${uid}`), db("GET", `bans/${uid}`),
			listDocs(`${base}/versions`, "&mask.fieldPaths=level&mask.fieldPaths=saved_at").catch(() => []),
		]);
		P = {
			server, uid, base,
			doc: doc ? decodeSave(doc) : null,
			profile: profile || null,
			held: Object.entries(names || {}).filter(([, v]) => v === uid).map(([k]) => k).sort(),
			dev: !!dev, ban: !!ban,
			versions: versions.map((v) => ({ slot: docId(v), ...decodeFields(v.fields) })).sort((x, y) => (y.saved_at || 0) - (x.saved_at || 0)),
		};
		P.draft = P.doc?.data ? clone(P.doc.data) : null;
		renderPlayer();
	} catch (e) { failed(e); }
}

function dirty() { return !!(P && P.doc?.data && JSON.stringify(P.draft) !== JSON.stringify(P.doc.data)); }

function renderPlayer() {
	leaveGuard = dirty;
	const d = P.doc;
	const saveName = d?.data ? getPath(d.data, "game_state.profile.name") : "";
	const shownName = P.profile?.name || saveName || "(no name)";
	const mismatch = d?.data && P.profile?.name && saveName && saveName !== P.profile.name;
	view.innerHTML = `
		<div class="crumbs"><a href="#/servers">Servers</a> › <a href="#/server/${encodeURIComponent(P.server)}">${esc(P.server)}</a> › ${esc(shownName)}</div>
		<div class="player-head">
			<h1>${esc(shownName)}</h1>
			${P.dev ? `<span class="badge ok">dev</span>` : ""}${P.ban ? `<span class="badge bad">banned</span>` : ""}
			<span class="uid">${esc(P.uid)}</span><button class="btn ghost small" id="copy-uid" type="button">Copy ID</button>
			<span class="spacer"></span><button class="btn ghost small" id="reload" type="button">Reload</button>
		</div>
		<div class="notice warn">Edits reach the player at their game's next launch. Make them while the game is closed on that player's device: a running game uploads its own copy every minute and would overwrite a save edit (and take its old name back).</div>
		${mismatch ? `<div class="notice warn">The save says <b>${esc(saveName)}</b> but chat shows <b>${esc(P.profile.name)}</b>.</div>` : ""}
		<div class="grid">
			<div class="card">
				<h2>Name</h2>
				<div class="fields">
					<span>In chat</span><span>${P.profile ? esc(P.profile.name) + ` <span class="muted small">Lv ${esc(P.profile.level)}</span>` : `<span class="muted">no profile</span>`}</span>
					<span>In the save</span><span>${d?.data ? esc(saveName || "(empty)") : `<span class="muted">no save</span>`}</span>
					<span>Names held</span><span>${P.held.length ? P.held.map((k) => `<span class="chip"><code>${esc(k)}</code><button type="button" data-release="${esc(k)}" title="Release this name">×</button></span>`).join(" ") : `<span class="muted">none</span>`}</span>
				</div>
				<div class="subhead">Rename</div>
				<div class="row">
					<input id="new-name" maxlength="16" placeholder="New name" autocomplete="off">
					<button class="btn small" id="rename" type="button">Rename</button>
				</div>
				<label class="small muted" style="margin-top:6px"><input type="checkbox" id="rename-save" ${d?.data ? "checked" : "disabled"}> Also put it in the save (otherwise the game claims its old name back)</label>
				<p class="muted small">Takes the new name, releases every other name this player holds, and updates the chat profile. The rename is free and doesn't count as one of the player's renames. Releasing (×) only frees a name: if the player comes back, the game asks them to pick another.</p>
			</div>
			<div class="card">
				<h2>Flags</h2>
				<label class="check"><input type="checkbox" id="flag-dev" ${P.dev ? "checked" : ""}><span><span class="t">Dev</span><br><span class="d">Dev Tools in Settings on a release build (devs/{uid}).</span></span></label>
				<label class="check"><input type="checkbox" id="flag-ban" ${P.ban ? "checked" : ""}><span><span class="t">Banned from chat</span><br><span class="d">Can't post World messages or private messages (bans/{uid}).</span></span></label>
			</div>
			${d ? saveCards(d) : `<div class="card wide"><h2>Save</h2><p class="muted">No cloud save for this player on ${esc(P.server)}.</p></div>`}
		</div>
		<div class="savebar" id="savebar" hidden><span class="what">Unsaved save changes</span><button class="btn ghost small" id="discard" type="button">Discard</button><button class="btn small" id="save" type="button">Save</button></div>`;

	$("#copy-uid").addEventListener("click", () => navigator.clipboard?.writeText(P.uid).then(() => toast("Player ID copied")));
	$("#reload").addEventListener("click", () => { if (!dirty() || confirm("Discard your unsaved changes?")) showPlayer(P.server, P.uid); });
	$("#rename").addEventListener("click", rename);
	$("#new-name").addEventListener("keydown", (e) => { if (e.key === "Enter") rename(); });
	view.querySelectorAll("[data-release]").forEach((b) => b.addEventListener("click", () => release(b.dataset.release)));
	$("#flag-dev").addEventListener("change", (e) => setFlag("devs", e.target.checked));
	$("#flag-ban").addEventListener("change", (e) => setFlag("bans", e.target.checked));
	if (d) wireSave();
	updateSavebar();
}

function saveCards(d) {
	if (!d.data) return `<div class="card wide"><h2>Save</h2><p class="error">The save field isn't valid JSON, so it can't be edited here.</p></div>`;
	return `
		<div class="card">
			<h2>Cloud Save</h2>
			<div class="fields">
				<span>Saved</span><span>${esc(when(d.saved_at))} <span class="muted small">${d.saved_at ? new Date(d.saved_at * 1000).toLocaleString("en-CA") : ""}</span></span>
				<span>Save version</span><span>${esc(d.version)}</span>
				<span>Save counter</span><span>${fmt(d.save_counter)}</span>
				<span>Device</span><span class="uid">${esc(d.device_id)}</span>
				<span>Size</span><span>${fmt((d.raw || "").length)} characters</span>
			</div>
			<div class="subhead">Quick Edit</div>
			<div class="fields">${QUICK.map(([path, label]) => `
				<label for="q-${path}">${esc(label)}</label><input type="number" id="q-${path}" data-quick="${esc(path)}" value="${esc(getPath(P.draft, path) ?? "")}">`).join("")}
			</div>
			<div class="row" style="margin-top:12px"><button class="btn ghost small" id="backup" type="button">Download Backup</button></div>
		</div>
		<div class="card">
			<h2>Cloud History <span class="count">${P.versions.length} of 5</span></h2>
			${P.versions.length ? `<table><tbody>${P.versions.map((v) => `
				<tr><td><code>${esc(v.slot)}</code></td><td class="num">Lv ${esc(v.level)}</td><td>${esc(when(v.saved_at))}</td>
				<td><button class="btn ghost small" type="button" data-restore="${esc(v.slot)}">Restore</button></td></tr>`).join("")}</tbody></table>`
				: `<p class="muted">No history copies yet (the game makes one at most once an hour).</p>`}
		</div>
		<details class="card wide"${P.rawOpen ? " open" : ""} id="raw">
			<summary>Raw Save (JSON)</summary>
			<p class="muted small">The whole save's <code>data</code>. Edit carefully: a wrong shape can break the hero. Download a backup first.</p>
			<textarea class="code" id="raw-json" spellcheck="false">${esc(JSON.stringify(P.draft, null, 1))}</textarea>
			<p class="error" id="raw-error"></p>
		</details>`;
}

function wireSave() {
	$("#backup").addEventListener("click", () => download(`idleadventure-${P.server}-${P.uid}-${P.doc.saved_at}.json`,
		JSON.stringify({ uid: P.uid, server: P.server, save_counter: P.doc.save_counter, device_id: P.doc.device_id, saved_at: P.doc.saved_at, version: P.doc.version, data: P.doc.data }, null, 1)));
	view.querySelectorAll("[data-quick]").forEach((el) => el.addEventListener("input", () => {
		if (el.value === "") return;
		setPath(P.draft, el.dataset.quick, Math.trunc(Number(el.value)));
		$("#raw-json").value = JSON.stringify(P.draft, null, 1);
		updateSavebar();
	}));
	$("#raw-json").addEventListener("input", (e) => {
		try {
			const v = JSON.parse(e.target.value);
			if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("The save must be a JSON object.");
			P.draft = v;
			$("#raw-error").textContent = "";
			QUICK.forEach(([path]) => { const el = view.querySelector(`[data-quick="${path}"]`); if (el && document.activeElement !== el) el.value = getPath(v, path) ?? ""; });
		} catch (err) {
			$("#raw-error").textContent = err.message;
		}
		updateSavebar();
	});
	$("#raw").addEventListener("toggle", (e) => { P.rawOpen = e.target.open; });
	view.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => restore(b.dataset.restore)));
	$("#discard").addEventListener("click", () => { P.draft = clone(P.doc.data); renderPlayer(); });
	$("#save").addEventListener("click", () => writeSave(P.draft, "Saved — the player gets it at their next launch."));
}

function updateSavebar() {
	const bar = $("#savebar");
	if (bar) bar.hidden = !dirty() || !!$("#raw-error")?.textContent;
}

// Write `data` as the character's save. Refuses if the cloud copy changed since this page loaded.
async function writeSave(data, okText) {
	const json = JSON.stringify(data);
	if (json.length > SAVE_MAX) { toast("That save is too big for the rules (900,000 characters).", true); return false; }
	try {
		const now = decodeSave(await getDoc(P.base));
		if (now.save_counter !== P.doc.save_counter || now.saved_at !== P.doc.saved_at) {
			toast("The save changed since this page loaded (is the game running?). Reload and try again.", true);
			return false;
		}
		const next = { data, save_counter: P.doc.save_counter + COUNTER_BUMP, device_id: P.doc.device_id, saved_at: Math.floor(Date.now() / 1000), version: P.doc.version };
		await fs("PATCH", P.base, encodeSave(next));
		toast(okText);
		clearCaches();
		await showPlayer(P.server, P.uid);
		return true;
	} catch (e) {
		toast(e.message, true);
		return false;
	}
}

async function restore(slot) {
	if (dirty() && !confirm("Discard your unsaved changes?")) return;
	try {
		const v = decodeSave(await getDoc(`${P.base}/versions/${slot}`));
		if (!v.data) throw new Error("That history copy isn't valid JSON.");
		if (!confirm(`Replace the current save (Lv ${P.doc.level}, ${when(P.doc.saved_at)}) with ${slot} (Lv ${v.level}, ${when(v.saved_at)})? Download a backup first if you might want it back.`)) return;
		await writeSave(v.data, `Restored ${slot} — the player gets it at their next launch.`);
	} catch (e) { toast(e.message, true); }
}

async function release(key) {
	if (!confirm(`Release the name "${key}"? Anyone on ${P.server} can then take it.`)) return;
	const up = { [`names/${P.server}/${key}`]: null };
	if (P.profile && nameKey(P.profile.name || "") === key) up[`profiles/${P.server}/${P.uid}`] = null;
	try {
		await db("PATCH", "", up);
		toast(`Released "${key}".`);
		clearCaches();
		showPlayer(P.server, P.uid);
	} catch (e) { toast(e.message, true); }
}

async function rename() {
	const name = $("#new-name").value.trim();
	const err = nameError(name);
	if (err) { toast(err, true); return; }
	const key = nameKey(name);
	const inSave = $("#rename-save").checked && P.doc?.data;
	if (inSave && dirty()) { toast("Save or discard your save changes first.", true); return; }
	try {
		const holder = await db("GET", `names/${P.server}/${key}`);
		if (holder && holder !== P.uid) {
			toast(`"${name}" is held by ${holder}. Open that player and release it first.`, true);
			return;
		}
		const level = Number(getPath(P.doc?.data, "game_state.hero.level")) || Number(P.profile?.level) || 1;
		const up = { [`names/${P.server}/${key}`]: P.uid, [`profiles/${P.server}/${P.uid}`]: { name, level } };
		for (const k of P.held) if (k !== key) up[`names/${P.server}/${k}`] = null;
		await db("PATCH", "", up);
		if (inSave) {
			const data = clone(P.doc.data);
			setPath(data, "game_state.profile.name", name);
			await writeSave(data, `Renamed to ${name}.`);
		} else {
			toast(`Renamed to ${name} in chat.`);
			clearCaches();
			showPlayer(P.server, P.uid);
		}
	} catch (e) { toast(e.message, true); }
}

async function setFlag(node, on) {
	try {
		if (on) await db("PUT", `${node}/${P.uid}`, true);
		else await db("DELETE", `${node}/${P.uid}`);
		if (node === "devs") P.dev = on; else P.ban = on;
		toast(on ? `Set ${node}/${P.uid}` : `Cleared ${node}/${P.uid}`);
	} catch (e) {
		toast(e.message, true);
		showPlayer(P.server, P.uid);
	}
}

boot();
