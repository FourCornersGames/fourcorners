/* CatCafe dev panel (the Bakery repo's game; Firebase project catcafe-97a16).
 *
 * Read-only for now: the players (each one's players/{uid} summary, which the
 * game's PlayerStats writes), a player's page with the summary and the whole
 * cloud save (saves/{uid}) with a backup download, and config/app. Editing a
 * save from here would need the game to adopt dev edits first: its CloudSave
 * keeps the phone's copy when the cloud is what the phone last synced (Bakery
 * docs/CLOUD_SAVE.md), so a web edit would just be overwritten.
 *
 * Talks to Firebase Auth and Firestore over REST (no SDK). Every read is checked
 * by the game's rules: isDev() in the Bakery repo's firebase/firestore.rules
 * (devs/{uid} with enabled: true). Sign-in happens on the gateway (/dev/).
 */
"use strict";

const API_KEY = "AIzaSyATfD6ZCIdhCGsVxlsPG0RUvplwkBONjhk"; // Public, same as the game's firebase_auth.gd.
const PROJECT_ID = "catcafe-97a16";
const DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const LIST_MAX = 500;

// The players/{uid} summary fields the table shows: [field, heading, kind].
const COLUMNS = [
	["stars", "Stars", "num"],
	["coins", "Coins", "num"],
	["lifetime_coins", "Lifetime coins", "num"],
	["sprinkles", "Sprinkles", "num"],
	["play_hours", "Hours", "hours"],
	["days_played", "Days", "num"],
	["sessions", "Sessions", "num"],
	["bakeries", "Bakeries", "num"],
	["purchases", "Buys", "num"],
	["ads_watched", "Ads", "num"],
	["version", "Version", "text"],
	["last_seen", "Last seen", "when"],
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
	} catch (_) { /* Storage blocked. */ }
	return null;
}

function fmt(n) { return Number(n || 0).toLocaleString("en-CA", { maximumFractionDigits: 0 }); }

// A Date / ISO string / unix seconds -> "5 min ago" or a date.
function when(v) {
	const ms = typeof v === "number" ? v * 1000 : Date.parse(v);
	if (!ms) return "";
	const mins = Math.round((Date.now() - ms) / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
	return new Date(ms).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function cell(kind, v) {
	if (kind === "num") return fmt(v);
	if (kind === "hours") return Number(v || 0).toFixed(1);
	if (kind === "when") return esc(when(v));
	return esc(v);
}

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
	store("bk-dev-refresh", refreshToken);
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
		for (const k of Object.keys(sessionStorage)) if (/^(ia|yt|bk)-dev-|^dev-/.test(k)) sessionStorage.removeItem(k);
	} catch (_) { /* Storage blocked: nothing kept anyway. */ }
	location.href = "/dev/";
}

// --- Firestore REST ------------------------------------------------------

class FsError extends Error {
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
		if (res.status === 403) msg = "Permission denied by the Firestore rules. Are the dev rules published, and does this account have devs/{uid} with enabled: true?";
		throw new FsError(res.status, msg);
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

// The newest players first (last_seen), up to LIST_MAX.
async function listPlayers() {
	const rows = await fs("POST", `${FS}:runQuery`, {
		structuredQuery: {
			from: [{ collectionId: "players" }],
			orderBy: [{ field: { fieldPath: "last_seen" }, direction: "DESCENDING" }],
			limit: LIST_MAX,
		},
	});
	return rows.filter((r) => r.document).map((r) => ({ uid: r.document.name.split("/").pop(), ...decodeFields(r.document.fields) }));
}

let playersCache = null;
let devsCache = null;

async function devUids() {
	if (devsCache) return devsCache;
	const rows = await fs("POST", `${FS}:runQuery`, { structuredQuery: { from: [{ collectionId: "devs" }], limit: 100 } }).catch(() => []);
	devsCache = new Set(rows.filter((r) => r.document && decodeFields(r.document.fields).enabled === true).map((r) => r.document.name.split("/").pop()));
	return devsCache;
}

// --- Boot and routing ----------------------------------------------------

async function boot() {
	$("#nav").hidden = $("#who").hidden = true;
	$("#signin").hidden = true;
	view.innerHTML = "";
	auth.refreshToken = auth.refreshToken || store("bk-dev-refresh") || "";
	auth.email = auth.email || store("bk-dev-email") || store("dev-email") || "";
	if (!auth.refreshToken) {
		// One sign-in for every game: the gateway (/dev/) signs in and comes back here.
		location.replace("/dev/#bakery");
		return;
	}
	view.innerHTML = `<p class="loading">Signing in…</p>`;
	try {
		await token();
		const me = await getDoc(`devs/${auth.uid}`);
		if (decodeFields(me?.fields).enabled !== true) {
			throw new Error(`Signed in, but this account isn't a CatCafe dev: it needs a devs/{uid} document with enabled: true (uid ${auth.uid}).`);
		}
	} catch (e) {
		auth.refreshToken = "";
		store("bk-dev-refresh", null);
		$("#signin").hidden = false;
		$("#signin-error").textContent = e.message;
		view.innerHTML = "";
		return;
	}
	$("#who-name").textContent = auth.email || "dev";
	$("#nav").hidden = $("#who").hidden = false;
	route();
}

function route() {
	if (!auth.uid) return;
	const [, name = "players", arg = ""] = location.hash.split("/");
	document.querySelectorAll("#nav a").forEach((el) => {
		if (el.dataset.view === (name === "player" ? "players" : name)) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
	});
	window.scrollTo(0, 0);
	if (name === "player" && arg) showPlayer(decodeURIComponent(arg));
	else if (name === "config") showConfig();
	else showPlayers();
}

window.addEventListener("hashchange", route);
$("#sign-out").addEventListener("click", signOutEverywhere);

function failed(e) {
	view.innerHTML = `<div class="card"><h2>Couldn't load that</h2><p class="error">${esc(e.message)}</p></div>`;
}

// --- Players ---------------------------------------------------------------

async function showPlayers() {
	view.innerHTML = `<p class="loading">Loading players…</p>`;
	try {
		if (!playersCache) playersCache = await listPlayers();
		const devs = await devUids();
		const draw = (q) => {
			const list = playersCache.filter((p) => !q || String(p.name || "").toLowerCase().includes(q) || p.uid.toLowerCase().includes(q));
			$("#rows").innerHTML = list.map((p) => `<tr>
				<td><a class="name-link" href="#/player/${encodeURIComponent(p.uid)}">${esc(p.name || "(no name)")}</a>
					${devs.has(p.uid) ? ` <span class="badge accent">dev</span>` : ""}
					${p.account === "play_games" ? ` <span class="badge ok">Play Games</span>` : ` <span class="badge">guest</span>`}</td>
				${COLUMNS.map(([k, , kind]) => `<td class="${kind === "text" || kind === "when" ? "" : "num"}">${cell(kind, p[k])}</td>`).join("")}
			</tr>`).join("");
			$("#shown").textContent = `${list.length} of ${playersCache.length}`;
		};
		view.innerHTML = `
			<div class="toolbar">
				<h1 style="margin:0">Players</h1>
				<span class="muted small" id="shown"></span>
				<span class="spacer"></span>
				<input id="search" type="search" placeholder="Search name or uid" aria-label="Search players">
				<button class="btn ghost small" id="reload" type="button">Reload</button>
			</div>
			<div class="card table-wrap"><table>
				<thead><tr><th>Name</th>${COLUMNS.map(([, h, kind]) => `<th class="${kind === "text" || kind === "when" ? "" : "num"}">${esc(h)}</th>`).join("")}</tr></thead>
				<tbody id="rows"></tbody>
			</table></div>
			<p class="muted small">Newest first (last seen), up to ${LIST_MAX}. From each player's players/{uid} summary, written by the game.</p>`;
		draw("");
		$("#search").addEventListener("input", (e) => draw(e.target.value.trim().toLowerCase()));
		$("#reload").addEventListener("click", () => { playersCache = null; devsCache = null; showPlayers(); });
	} catch (e) { failed(e); }
}

// --- One player ---------------------------------------------------------------

async function showPlayer(uid) {
	view.innerHTML = `<p class="loading">Loading player…</p>`;
	try {
		const [pDoc, sDoc, devs] = await Promise.all([getDoc(`players/${uid}`), getDoc(`saves/${uid}`), devUids()]);
		const p = decodeFields(pDoc?.fields);
		const s = decodeFields(sDoc?.fields);
		let save = null;
		try { save = s.save ? JSON.parse(s.save) : null; } catch (_) { save = null; }
		const summary = Object.keys(p).sort().map((k) => {
			const v = p[k];
			const shown = v && typeof v === "object" ? `<code>${esc(JSON.stringify(v))}</code>` : k === "last_seen" ? `${esc(when(v))} <span class="muted small">${esc(v)}</span>` : esc(typeof v === "number" ? fmt(v) : v);
			return `<tr><th>${esc(k)}</th><td>${shown}</td></tr>`;
		}).join("");
		view.innerHTML = `
			<div class="player-head">
				<h1>${esc(p.name || "(no name)")}</h1>
				${devs.has(uid) ? `<span class="badge accent">dev</span>` : ""}
				${p.account ? `<span class="badge ${p.account === "play_games" ? "ok" : ""}">${esc(p.account)}</span>` : ""}
				${p.club ? `<span class="badge warn">Club</span>` : ""}${p.no_ads ? `<span class="badge">No Ads</span>` : ""}
				<span class="uid">${esc(uid)}</span>
			</div>
			<div class="grid">
				<div class="card">
					<h2>Summary</h2>
					${pDoc ? `<div class="table-wrap"><table><tbody>${summary}</tbody></table></div>` : `<p class="muted">No players/{uid} summary yet.</p>`}
				</div>
				<div class="card">
					<h2>Cloud save</h2>
					${sDoc ? `
						<table><tbody>
							<tr><th>Stars</th><td>${fmt(s.stars)}</td></tr>
							<tr><th>Coins</th><td>${fmt(s.coins)}</td></tr>
							<tr><th>Saved</th><td>${esc(when(sDoc.updateTime))} <span class="muted small">${esc(sDoc.updateTime)}</span></td></tr>
							<tr><th>Version</th><td>${esc(s.version)}</td></tr>
							<tr><th>Device</th><td><code>${esc(s.device_id)}</code></td></tr>
							<tr><th>Size</th><td>${fmt((s.save || "").length)} characters</td></tr>
						</tbody></table>
						<div class="toolbar" style="margin-top:12px"><button class="btn small" id="backup" type="button">Download Backup</button></div>
						<p class="muted small">Read-only: the game keeps the phone's copy over a web edit (Bakery docs/CLOUD_SAVE.md).</p>` : `<p class="muted">No cloud save.</p>`}
				</div>
				${save ? `<div class="card wide"><h2>Save data</h2><details><summary>Show the whole save (JSON)</summary><pre class="small" style="white-space:pre-wrap;word-break:break-word">${esc(JSON.stringify(save, null, 2))}</pre></details></div>` : ""}
			</div>`;
		$("#backup")?.addEventListener("click", () => download(`catcafe-${uid}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ uid, doc: s }, null, 2)));
	} catch (e) { failed(e); }
}

// --- Config ---------------------------------------------------------------

async function showConfig() {
	view.innerHTML = `<p class="loading">Loading config…</p>`;
	try {
		const doc = await getDoc("config/app");
		const c = decodeFields(doc?.fields);
		view.innerHTML = `
			<h1>Config</h1>
			<div class="grid"><div class="card">
				<h2>config/app</h2>
				${doc ? `<table><tbody>${Object.keys(c).sort().map((k) => `<tr><th>${esc(k)}</th><td>${esc(JSON.stringify(c[k]))}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No config/app document.</p>`}
				<p class="muted small"><code>min_version</code> is the oldest Play build allowed to play (the game's UpdateGate). Change it in the Firebase console for now.</p>
			</div></div>`;
	} catch (e) { failed(e); }
}

boot();
