/* YarnToss dev panel.
 *
 * Talks to Firebase Auth and Firestore over their REST APIs, the same way
 * the game does (no SDK, nothing loaded from a third party). Every read and
 * write is checked by the Firestore rules' isDev() - see the YarnToss repo's
 * firebase/firestore.rules and docs/firebase.md ("Web dev panel").
 */
"use strict";

const API_KEY = "AIzaSyB_jg9qNOJSX16NBcIVnrDk5Aiz6YlHGOM"; // Public, same as firebase_auth.gd.
const PROJECT_ID = "yarntoss-login";
const DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const GAME = window.GAME_DATA || { achievements: [], catalogue: [], skins: [], cosmetics: [], workshop: [], rooms: [], products: [] };
const ROOMS_PER_DAY = GAME.rooms.length || 8;

// Profile fields the panel can edit. MUST match CloudSave._adopt_field() in
// the game: these are the paths the game adopts outright after a dev edit.
const EDITABLE = [
	"high_score", "high_kill_count", "high_level_index", "buttons",
	"meta.savings", "meta.levels", "meta.kit",
	"tutorial", "achievements.unlocked", "achievements.stats",
	"unlocked_skin_ids", "equipped_skin_id",
	"unlocked_cosmetic_ids", "owned_products", "equipped_cosmetics",
];
const TUTORIAL_FLAGS = ["tutorial_completed", "shoot_check", "catnip_check", "boss_check", "block_check", "loot_check"];
const CATALOGUE_FOUND = "catalogue_";
const CATALOGUE_VIEWED = "catalogue_viewed_";

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

function store(kind, key, value) {
	try {
		if (value === undefined) return sessionStorage.getItem(key);
		if (value === null) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, value);
	} catch (_) { /* Storage blocked: the session just won't survive a reload. */ }
	return null;
}

function roomLabel(index) {
	index = Number(index);
	if (!(index >= 0)) return "Nothing cleared";
	const room = GAME.rooms[index % ROOMS_PER_DAY] || "";
	return `Day ${Math.floor(index / ROOMS_PER_DAY) + 1} · Room ${index % ROOMS_PER_DAY + 1}${room ? ` (${room})` : ""}`;
}

function fmt(n) { return Number(n || 0).toLocaleString("en-CA"); }

function when(iso) {
	if (!iso) return "";
	const d = new Date(iso);
	const mins = Math.round((Date.now() - d) / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
	return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function stable(v) {
	if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
	if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
	return JSON.stringify(v ?? null);
}

function getPath(obj, path) {
	return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
	const keys = path.split(".");
	let o = obj;
	for (const k of keys.slice(0, -1)) {
		if (o[k] == null || typeof o[k] !== "object") o[k] = {};
		o = o[k];
	}
	o[keys[keys.length - 1]] = value;
}

// --- Firestore value codec -------------------------------------------------

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

function encode(v) {
	if (v === null || v === undefined) return { nullValue: null };
	if (typeof v === "boolean") return { booleanValue: v };
	if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
	if (typeof v === "string") return { stringValue: v };
	if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
	const fields = {};
	for (const [k, x] of Object.entries(v)) fields[k] = encode(x);
	return { mapValue: { fields } };
}

// --- Auth ----------------------------------------------------------------

const auth = { uid: "", idToken: "", refreshToken: "", expiresAt: 0, name: "" };

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
	if (/TOO_MANY_ATTEMPTS/.test(code)) return "Too many tries - wait a bit and try again.";
	if (/USER_DISABLED/.test(code)) return "This account is disabled.";
	return code;
}

function setSession(uid, idToken, refreshToken, expiresIn) {
	Object.assign(auth, { uid, idToken, refreshToken, expiresAt: Date.now() + (Number(expiresIn) - 60) * 1000 });
	store("session", "yt-dev-refresh", refreshToken);
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

function signOut() {
	Object.assign(auth, { uid: "", idToken: "", refreshToken: "", expiresAt: 0, name: "" });
	signOutEverywhere();
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
		if (res.status === 403) msg = "Permission denied by the Firestore rules. Are the dev rules published, and is this account is_dev?";
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

async function commit(writes) {
	return fs("POST", `${FS}:commit`, { writes });
}

const docId = (doc) => doc.name.split("/").pop();
const docName = (path) => `${DOCS}/${path}`;

// --- Boot and routing ----------------------------------------------------

let leaveGuard = null; // Returns true when the current view has unsaved changes.

async function boot() {
	$("#nav").hidden = $("#who").hidden = true;
	$("#signin").hidden = true;
	view.innerHTML = "";
	auth.refreshToken = auth.refreshToken || store("session", "yt-dev-refresh") || "";
	if (!auth.refreshToken) {
		// One sign-in for every game: the gateway (/dev/) signs in and comes back here.
		location.replace("/dev/#yarntoss");
		return;
	}
	view.innerHTML = `<p class="loading">Signing in…</p>`;
	try {
		await token();
		const me = await getDoc(`scores/${auth.uid}`);
		const fields = decodeFields(me?.fields);
		if (fields.is_dev !== true) {
			auth.refreshToken = "";
			store("session", "yt-dev-refresh", null);
			$("#signin").hidden = false;
			$("#signin-error").textContent = "Signed in, but this account isn't a dev (is_dev isn't set on its profile).";
			view.innerHTML = "";
			return;
		}
		auth.name = fields.username || "dev";
	} catch (e) {
		auth.refreshToken = "";
		store("session", "yt-dev-refresh", null);
		$("#signin").hidden = false;
		$("#signin-error").textContent = e.message;
		view.innerHTML = "";
		return;
	}
	$("#who-name").textContent = auth.name;
	$("#nav").hidden = $("#who").hidden = false;
	route();
}

function route() {
	if (!auth.uid || !auth.name) return;
	const [, name = "leaderboard", arg = ""] = location.hash.split("/");
	document.querySelectorAll("#nav a").forEach((a) => {
		const on = a.dataset.view === (name === "player" ? "players" : name);
		if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
	});
	leaveGuard = null;
	window.scrollTo(0, 0);
	const views = { leaderboard: showLeaderboard, players: showPlayers, player: showPlayer, messages: showMessages, config: showConfig };
	(views[name] || showLeaderboard)(decodeURIComponent(arg));
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

$("#sign-out").addEventListener("click", signOut);

function failed(e) {
	view.innerHTML = `<div class="card"><h2>Couldn't load that</h2><p class="error">${esc(e.message)}</p></div>`;
}

const skinName = (id) => GAME.skins.find((s) => s.id === id)?.name || id || "";

// --- Leaderboard ---------------------------------------------------------

let boardTab = "depth";

async function showLeaderboard() {
	view.innerHTML = `
		<div class="toolbar">
			<h1>Leaderboard</h1>
			<span class="spacer"></span>
			<div class="tabs">
				<button type="button" data-tab="depth" aria-pressed="${boardTab === "depth"}">Depth</button>
				<button type="button" data-tab="achievements" aria-pressed="${boardTab === "achievements"}">Achievements</button>
			</div>
			<button class="btn ghost small" type="button" id="refresh">Refresh</button>
		</div>
		<div class="card"><div id="board" class="table-wrap"><p class="loading">Loading…</p></div></div>
		<p class="muted small">The same queries the game runs, top 100, with hidden players shown greyed out. Click a name to open their save.</p>`;
	view.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { boardTab = b.dataset.tab; showLeaderboard(); }));
	$("#refresh").addEventListener("click", showLeaderboard);
	try {
		const depth = boardTab === "depth";
		const docs = await runQuery(depth ? {
			from: [{ collectionId: "leaderboard" }],
			where: { fieldFilter: { field: { fieldPath: "high_level_index" }, op: "GREATER_THAN", value: { integerValue: "-1" } } },
			orderBy: [
				{ field: { fieldPath: "high_level_index" }, direction: "DESCENDING" },
				{ field: { fieldPath: "high_kill_count" }, direction: "DESCENDING" },
				{ field: { fieldPath: "username" }, direction: "ASCENDING" },
			],
			limit: 100,
		} : {
			from: [{ collectionId: "leaderboard" }],
			where: { fieldFilter: { field: { fieldPath: "achievement_count" }, op: "GREATER_THAN", value: { integerValue: "0" } } },
			orderBy: [{ field: { fieldPath: "achievement_count" }, direction: "DESCENDING" }],
			limit: 100,
		});
		let rank = 0;
		const rows = docs.map((doc) => {
			const f = decodeFields(doc.fields);
			if (!f.hidden) rank++;
			return `<tr class="${f.hidden ? "is-hidden" : ""}">
				<td class="num">${f.hidden ? "–" : rank}</td>
				<td><a class="name-link" href="#/player/${encodeURIComponent(docId(doc))}">${esc(f.username || "???")}</a>
					${f.hidden ? ` <span class="badge accent">Hidden</span>` : ""}</td>
				<td>${esc(roomLabel(f.high_level_index))}</td>
				<td class="num">${fmt(f.high_kill_count)}</td>
				<td class="num">${fmt(f.achievement_count)}</td>
				<td class="muted">${esc(skinName(f.skin))}</td>
			</tr>`;
		});
		$("#board").innerHTML = rows.length ? `<table>
			<thead><tr><th class="num">#</th><th>Player</th><th>Best</th><th class="num">Kills</th><th class="num">Achievements</th><th>Skin</th></tr></thead>
			<tbody>${rows.join("")}</tbody></table>` : `<p class="muted">Nobody on this board yet.</p>`;
	} catch (e) {
		$("#board").innerHTML = `<p class="error">${esc(e.message)}</p>`;
	}
}

// --- Players -------------------------------------------------------------

let playerCache = null;

async function showPlayers() {
	view.innerHTML = `
		<div class="toolbar">
			<h1>Players</h1>
			<span class="spacer"></span>
			<input type="search" id="filter" placeholder="Filter by name or uid" aria-label="Filter players">
			<button class="btn ghost small" type="button" id="refresh">Refresh</button>
		</div>
		<div class="card"><div id="players" class="table-wrap"><p class="loading">Loading every account…</p></div></div>
		<p class="muted small">Every account with a cloud profile (signed-up players, not guests), most recently synced first.</p>`;
	$("#refresh").addEventListener("click", () => { playerCache = null; showPlayers(); });
	const filter = $("#filter");
	try {
		if (!playerCache) {
			const mask = ["username", "high_level_index", "high_kill_count", "buttons", "meta.savings", "is_dev", "dev_edit_seq", "dev_seen_seq"]
				.map((f) => `&mask.fieldPaths=${f}`).join("");
			const docs = await listDocs("scores", mask);
			playerCache = docs.map((d) => ({ uid: docId(d), updated: d.updateTime, ...decodeFields(d.fields) }))
				.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
		}
		const draw = () => {
			const q = filter.value.trim().toLowerCase();
			const list = playerCache.filter((p) => !q || (p.username || "").toLowerCase().includes(q) || p.uid.toLowerCase().includes(q));
			$("#players").innerHTML = `<table>
				<thead><tr><th>Player</th><th>Best</th><th class="num">Kills</th><th class="num">Buttons</th><th class="num">Savings</th><th>Last sync</th></tr></thead>
				<tbody>${list.map((p) => `<tr>
					<td><a class="name-link" href="#/player/${encodeURIComponent(p.uid)}">${esc(p.username || "(no name)")}</a>
						${p.is_dev ? ` <span class="badge ok">Dev</span>` : ""}
						${(p.dev_edit_seq || 0) > (p.dev_seen_seq || 0) ? ` <span class="badge warn">Edit pending</span>` : ""}</td>
					<td>${esc(roomLabel(p.high_level_index ?? -1))}</td>
					<td class="num">${fmt(p.high_kill_count)}</td>
					<td class="num">${fmt(p.buttons)}</td>
					<td class="num">${fmt(p.meta?.savings)}</td>
					<td class="muted">${esc(when(p.updated))}</td>
				</tr>`).join("")}</tbody></table>
				<p class="muted small">${list.length} of ${playerCache.length} accounts</p>`;
		};
		filter.addEventListener("input", draw);
		draw();
		filter.focus();
	} catch (e) {
		$("#players").innerHTML = `<p class="error">${esc(e.message)}</p>`;
	}
}

// --- One player ----------------------------------------------------------

let P = null; // {uid, orig, draft, updateTime, lb, renames}

async function showPlayer(uid) {
	if (!uid) return showPlayers();
	view.innerHTML = `<p class="loading">Loading player…</p>`;
	try {
		const [doc, lbDoc, renames] = await Promise.all([
			getDoc(`scores/${encodeURIComponent(uid)}`),
			getDoc(`leaderboard/${encodeURIComponent(uid)}`),
			runQuery({
				from: [{ collectionId: "username_changes" }],
				where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } },
			}).catch(() => []),
		]);
		if (!doc) {
			view.innerHTML = `<div class="card"><h2>No profile</h2><p>There's no <code>scores/${esc(uid)}</code> document. It may be a guest, or a deleted account.</p></div>`;
			return;
		}
		const orig = decodeFields(doc.fields);
		P = {
			uid, orig, draft: clone(orig), updateTime: doc.updateTime,
			lb: lbDoc ? decodeFields(lbDoc.fields) : null,
			renames: renames.map((d) => decodeFields(d.fields)).sort((a, b) => (a.changed_at || "").localeCompare(b.changed_at || "")),
		};
		leaveGuard = () => P && P.uid === uid && changedPaths().length > 0;
		renderPlayer();
	} catch (e) {
		failed(e);
	}
}

function changedPaths() {
	return EDITABLE.filter((p) => stable(getPath(P.orig, p)) !== stable(getPath(P.draft, p)));
}

// The tutorial map always carries every flag, so adopting it never wipes one
// (older profiles kept the flags at the top level).
function tutorial(d = P.draft) {
	if (!d.tutorial || typeof d.tutorial !== "object") d.tutorial = {};
	for (const f of TUTORIAL_FLAGS) if (typeof d.tutorial[f] !== "boolean") d.tutorial[f] = d[f] === true;
	if (!Array.isArray(d.tutorial.seen)) d.tutorial.seen = [];
	return d.tutorial;
}

function list(path) {
	const v = getPath(P.draft, path);
	return Array.isArray(v) ? v : [];
}

function renderPlayer() {
	const d = P.draft;
	const o = P.orig;
	const seq = o.dev_edit_seq || 0;
	const seen = o.dev_seen_seq || 0;
	const changed = new Set(changedPaths());
	const mark = (...paths) => (paths.some((p) => changed.has(p)) ? "changed" : "");
	const scrollY = window.scrollY;

	const pending = seq > seen
		? `<div class="notice warn"><b>Edit #${seq} not taken in by their game yet</b> (${esc((o.dev_edit_fields || []).join(", "))}). It applies the next time their game saves or launches. A game build from before the dev panel never takes it in, and can't sync until updated.</div>`
		: seq > 0 ? `<div class="notice ok">Their game has taken in every dev edit (#${seq}).</div>` : "";

	const ach = d.achievements || {};
	const unlocked = new Set(ach.unlocked || []);
	const stats = ach.stats || {};
	const knownAch = new Set(GAME.achievements.map((a) => a.id));
	const statNames = [...new Set([...GAME.achievements.filter((a) => a.enabled).map((a) => a.stat), ...Object.keys(stats)])].filter(Boolean);
	const statValue = (s) => (Array.isArray(stats[s]) ? stats[s].length : Number(stats[s] || 0));

	const seenIds = (d.tutorial?.seen || []);
	const meta = d.meta || {};
	const levels = meta.levels || {};
	const ownedKits = GAME.workshop.filter((w) => w.kind === "Kit" && (levels[w.id] || 0) >= 1);
	const skins = list("unlocked_skin_ids");
	const cosmetics = list("unlocked_cosmetic_ids");
	const equippedCos = d.equipped_cosmetics || {};
	const products = list("owned_products");
	const runs = Array.isArray(o.endless_checkpoints) ? o.endless_checkpoints : [];
	const lb = P.lb;

	const check = (attrs, on, title, desc = "", right = "", off = false) => `
		<label class="check ${off ? "off" : ""}"><input type="checkbox" ${attrs} ${on ? "checked" : ""}>
			<span><span class="t">${esc(title)}</span>${desc ? `<br><span class="d">${esc(desc)}</span>` : ""}</span>
			${right ? `<span class="right">${right}</span>` : ""}</label>`;

	view.innerHTML = `
		<div class="player-head">
			<h1>${esc(o.username || "(no name)")}</h1>
			${o.is_dev ? `<span class="badge ok">Dev</span>` : ""}
			${lb?.hidden ? `<span class="badge accent">Hidden from leaderboards</span>` : ""}
			<span class="uid">${esc(P.uid)}</span>
			<button class="link small" type="button" id="copy-uid">Copy uid</button>
			<span class="spacer" style="flex:1"></span>
			${lb ? `<button class="btn ghost small" type="button" id="toggle-hidden">${lb.hidden ? "Unhide on leaderboards" : "Hide from leaderboards"}</button>` : `<span class="muted small">No leaderboard entry</span>`}
			<button class="btn ghost small" type="button" id="reload">Reload</button>
		</div>
		${pending}
		<div class="grid">
			<section class="card ${mark("high_score", "high_kill_count", "high_level_index", "buttons")}">
				<h2>Progress</h2>
				<div class="fields">
					<label for="f-hli">Best room index</label>
					<div><input id="f-hli" type="number" min="-1" max="3999" data-num="high_level_index" value="${d.high_level_index ?? -1}">
						<span class="hint" id="hli-hint">${esc(roomLabel(d.high_level_index ?? -1))}</span></div>
					<label for="f-hkc">Kills (that run)</label>
					<input id="f-hkc" type="number" min="0" max="160000" data-num="high_kill_count" value="${d.high_kill_count ?? 0}">
					<label for="f-hs">High score</label>
					<input id="f-hs" type="number" min="0" max="1000000" data-num="high_score" value="${d.high_score ?? 0}">
					<label for="f-b">Buttons</label>
					<input id="f-b" type="number" min="0" data-num="buttons" value="${d.buttons ?? 0}">
				</div>
				<p class="muted small">Room index: −1 = nothing cleared, 0 = Day 1 · Room 1, ${ROOMS_PER_DAY} rooms a day. The leaderboard entry follows these when you save.</p>
			</section>

			<section class="card ${mark("meta.savings", "meta.levels", "meta.kit")}">
				<h2>Savings &amp; Workshop</h2>
				<div class="fields">
					<label for="f-sav">Savings</label>
					<input id="f-sav" type="number" min="0" max="1000000000" data-num="meta.savings" value="${meta.savings ?? 0}">
					${GAME.workshop.map((w) => `
						<label for="w-${esc(w.id)}" title="${esc(w.description)}">${esc(w.name)}</label>
						<select id="w-${esc(w.id)}" data-level="${esc(w.id)}">
							${Array.from({ length: w.max_level + 1 }, (_, i) => `<option value="${i}" ${(levels[w.id] || 0) === i ? "selected" : ""}>${i === 0 ? "Not owned" : w.max_level === 1 ? "Owned" : `Lv ${i}/${w.max_level}`}</option>`).join("")}
						</select>`).join("")}
					<label for="f-kit">Starting kit</label>
					<select id="f-kit" data-select="meta.kit">
						<option value="">None</option>
						${ownedKits.map((w) => `<option value="${esc(w.id)}" ${meta.kit === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}
					</select>
				</div>
			</section>

			<section class="card wide ${mark("achievements.unlocked", "achievements.stats")}">
				<h2>Achievements <span class="count">${GAME.achievements.filter((a) => a.enabled && unlocked.has(a.id)).length} / ${GAME.achievements.filter((a) => a.enabled).length} unlocked</span></h2>
				<div class="grid">
					<div class="checklist">
						${GAME.achievements.map((a) => check(`data-list="achievements.unlocked" data-item="${esc(a.id)}"`, unlocked.has(a.id),
							a.name + (a.enabled ? "" : " (retired)"), a.description,
							a.stat ? `${fmt(statValue(a.stat))} / ${fmt(a.goal)}` : "", !a.enabled)).join("")}
						${[...unlocked].filter((id) => !knownAch.has(id)).map((id) => check(`data-list="achievements.unlocked" data-item="${esc(id)}"`, true, id, "Not in the game's list")).join("")}
					</div>
					<div>
						<div class="subhead">Stats</div>
						<div class="fields">
							${statNames.map((s) => Array.isArray(stats[s])
								? `<span>${esc(s)}</span><span class="hint" title="${esc(stats[s].join(", "))}">${stats[s].length} unique: ${esc(stats[s].join(", ") || "none")}</span>`
								: `<label for="s-${esc(s)}">${esc(s)}</label><input id="s-${esc(s)}" type="number" min="0" data-stat="${esc(s)}" value="${Number(stats[s] || 0)}">`).join("")}
						</div>
						<p class="muted small">Removing an achievement whose stat still meets its goal just re-unlocks it in their game. Lower the stat too.</p>
					</div>
				</div>
			</section>

			<section class="card ${mark("tutorial")}">
				<h2>Cat Catalogue <span class="count">${GAME.catalogue.filter((c) => seenIds.includes(CATALOGUE_FOUND + c.id)).length} / ${GAME.catalogue.length} found</span></h2>
				${["Cats", "Special cats", "Bosses"].map((section) => `
					<div class="subhead">${section}</div>
					<div class="checklist">${GAME.catalogue.filter((c) => c.section === section).map((c) => {
						const found = seenIds.includes(CATALOGUE_FOUND + c.id);
						const viewed = seenIds.includes(CATALOGUE_VIEWED + c.id);
						return check(`data-catalogue="${esc(c.id)}"`, found, c.name, "", found ? (viewed ? "viewed" : `<span class="badge accent">New!</span>`) : "");
					}).join("")}</div>`).join("")}
				<p class="muted small">Found cats also show if their progress proves it (the game counts depth), even when unticked here.</p>
			</section>

			<section class="card ${mark("unlocked_skin_ids", "equipped_skin_id", "unlocked_cosmetic_ids", "equipped_cosmetics")}">
				<h2>Skins &amp; cosmetics</h2>
				<div class="subhead">Skins (radio = wearing)</div>
				<div class="checklist">
					${GAME.skins.map((s) => `<label class="check"><input type="checkbox" data-list="unlocked_skin_ids" data-item="${esc(s.id)}" ${skins.includes(s.id) ? "checked" : ""} ${s.id === "granny_default" ? "disabled" : ""}>
						<span class="t">${esc(s.name)}</span>${s.product_id ? ` <span class="badge">Paid</span>` : ""}
						<span class="right"><input type="radio" name="skin" data-radio="equipped_skin_id" value="${esc(s.id)}" ${d.equipped_skin_id === s.id ? "checked" : ""} ${skins.includes(s.id) ? "" : "disabled"} aria-label="Wear ${esc(s.name)}"></span></label>`).join("")}
				</div>
				${["yarn", "hit_effect"].map((kind) => {
					const items = GAME.cosmetics.filter((c) => c.kind === kind);
					return `<div class="subhead">${kind === "yarn" ? "Yarn colours" : "Hit effects"}</div>
						<div class="checklist">${items.map((c) => check(`data-list="unlocked_cosmetic_ids" data-item="${esc(c.id)}"`, cosmetics.includes(c.id), c.name)).join("")}</div>
						<div class="fields"><label for="eq-${kind}">Using</label>
						<select id="eq-${kind}" data-cosmetic="${kind}"><option value="">Default</option>
							${items.filter((c) => cosmetics.includes(c.id) || equippedCos[kind] === c.id).map((c) => `<option value="${esc(c.id)}" ${equippedCos[kind] === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
						</select></div>`;
				}).join("")}
			</section>

			<section class="card ${mark("owned_products")}">
				<h2>Purchases</h2>
				<div class="checklist">
					${[...new Set([...GAME.products, ...products])].map((id) => check(`data-list="owned_products" data-item="${esc(id)}"`, products.includes(id), id)).join("")}
				</div>
				<p class="muted small">Only what the game has recorded as owned. Google Play is the real record of what was paid for.</p>
			</section>

			<section class="card ${mark("tutorial")}">
				<h2>Tutorial</h2>
				<div class="checklist">
					${TUTORIAL_FLAGS.map((f) => check(`data-tutorial="${f}"`, (d.tutorial && typeof d.tutorial[f] === "boolean") ? d.tutorial[f] : d[f] === true, f)).join("")}
				</div>
				<div class="subhead">Seen one-time tips</div>
				<div class="chips">
					${seenIds.filter((id) => !id.startsWith(CATALOGUE_FOUND)).map((id) => `<span class="chip">${esc(id)}<button type="button" data-seen-remove="${esc(id)}" aria-label="Remove ${esc(id)}">×</button></span>`).join("") || `<span class="muted small">None</span>`}
				</div>
				<p class="muted small">Remove one to show that tip again.</p>
			</section>

			<section class="card">
				<h2>Saved runs <span class="count">read-only</span></h2>
				${runs.length ? `<div class="table-wrap"><table><thead><tr><th>Room</th><th class="num">Score</th><th class="num">HP</th><th class="num">Gold</th><th>Run</th></tr></thead><tbody>
					${runs.map((r) => `<tr><td>${esc(roomLabel(r.level_index))}</td><td class="num">${fmt(r.score)}</td><td class="num">${fmt(r.health)}</td><td class="num">${fmt(r.gold)}</td><td class="uid">${esc((r.run_id || "").slice(0, 8))}</td></tr>`).join("")}
				</tbody></table></div>` : `<p class="muted">No runs in progress.</p>`}
				<p class="muted small">${(o.ended_run_ids || []).length} finished runs remembered. Runs can't be edited here: the game never swaps a live run under the player.</p>
			</section>

			<section class="card">
				<h2>Account</h2>
				<div class="fields">
					<span>Username</span><span>${esc(o.username || "")}</span>
					<span>Renames</span><span>${o.username_change_count || 0}${o.username_changed_at ? `, last ${esc(when(o.username_changed_at))}` : ""}</span>
					<span>Dev edits</span><span>${seq} made, ${seen} taken in</span>
					<span>Last sync</span><span>${esc(when(P.updateTime))}</span>
				</div>
				${P.renames.length ? `<div class="subhead">Rename history</div><div class="table-wrap"><table><tbody>
					${P.renames.map((r) => `<tr><td>${esc(r.old_name)} → <b>${esc(r.new_name)}</b></td><td class="muted">${esc(when(r.changed_at))}</td></tr>`).join("")}
				</tbody></table></div>` : ""}
				<p class="muted small">Usernames, <code>is_dev</code> and deleting an account stay in the Firebase console.</p>
			</section>

			<section class="card wide">
				<details><summary>Raw profile (Firestore)</summary>
					<pre class="json">${esc(JSON.stringify(o, null, 2))}</pre>
					${lb ? `<div class="subhead">leaderboard/${esc(P.uid)}</div><pre class="json">${esc(JSON.stringify(lb, null, 2))}</pre>` : ""}
				</details>
			</section>
		</div>
		<div class="savebar" id="savebar" ${changed.size ? "" : "hidden"}>
			<span class="what" id="savebar-what">${esc([...changed].join(", "))}</span>
			<button class="btn ghost small" type="button" id="discard">Discard</button>
			<button class="btn small" type="button" id="save">Save to their profile</button>
		</div>`;

	window.scrollTo(0, scrollY);
	$("#copy-uid").addEventListener("click", () => navigator.clipboard?.writeText(P.uid).then(() => toast("uid copied")));
	$("#reload").addEventListener("click", () => {
		if (changedPaths().length && !confirm("Discard your unsaved changes?")) return;
		showPlayer(P.uid);
	});
	$("#toggle-hidden")?.addEventListener("click", toggleHidden);
	$("#discard").addEventListener("click", () => { P.draft = clone(P.orig); renderPlayer(); });
	$("#save").addEventListener("click", savePlayer);
}

function updateSavebar() {
	const changed = changedPaths();
	$("#savebar").hidden = !changed.length;
	$("#savebar-what").textContent = changed.join(", ");
}

// One delegated handler for every editor control on the player page.
view.addEventListener("input", (e) => {
	const el = e.target;
	if (!P || !el.dataset) return;
	if (el.dataset.num !== undefined) {
		const n = el.value === "" ? 0 : Math.trunc(Number(el.value));
		if (Number.isFinite(n)) setPath(P.draft, el.dataset.num, n);
		if (el.dataset.num === "high_level_index") $("#hli-hint").textContent = roomLabel(n);
		updateSavebar();
	} else if (el.dataset.stat !== undefined) {
		const stats = ((P.draft.achievements ||= {}).stats ||= {});
		stats[el.dataset.stat] = Math.max(0, Math.trunc(Number(el.value) || 0));
		updateSavebar();
	}
});

view.addEventListener("change", (e) => {
	const el = e.target;
	if (!P || !el.dataset) return;
	const d = P.draft;
	const ds = el.dataset;
	if (ds.list !== undefined) {
		const arr = Array.isArray(getPath(d, ds.list)) ? [...getPath(d, ds.list)] : [];
		const i = arr.indexOf(ds.item);
		if (el.checked && i < 0) arr.push(ds.item);
		if (!el.checked && i >= 0) arr.splice(i, 1);
		setPath(d, ds.list, arr);
		if (ds.list === "unlocked_skin_ids" && !arr.includes(d.equipped_skin_id)) d.equipped_skin_id = "granny_default";
		if (ds.list === "unlocked_cosmetic_ids" && !el.checked && d.equipped_cosmetics) {
			for (const k of Object.keys(d.equipped_cosmetics)) if (d.equipped_cosmetics[k] === ds.item) delete d.equipped_cosmetics[k];
		}
	} else if (ds.radio !== undefined || ds.select !== undefined) {
		setPath(d, ds.radio ?? ds.select, el.value);
	} else if (ds.level !== undefined) {
		const levels = { ...(getPath(d, "meta.levels") || {}) };
		const n = Number(el.value);
		if (n > 0) levels[ds.level] = n; else delete levels[ds.level];
		setPath(d, "meta.levels", levels);
		if (getPath(d, "meta.kit") && !(levels[getPath(d, "meta.kit")] >= 1)) setPath(d, "meta.kit", "");
	} else if (ds.cosmetic !== undefined) {
		const eq = { ...(d.equipped_cosmetics || {}) };
		if (el.value) eq[ds.cosmetic] = el.value; else delete eq[ds.cosmetic];
		d.equipped_cosmetics = eq;
	} else if (ds.catalogue !== undefined) {
		const t = tutorial();
		t.seen = t.seen.filter((id) => id !== CATALOGUE_FOUND + ds.catalogue && id !== CATALOGUE_VIEWED + ds.catalogue);
		if (el.checked) t.seen.push(CATALOGUE_FOUND + ds.catalogue, CATALOGUE_VIEWED + ds.catalogue);
	} else if (ds.tutorial !== undefined) {
		tutorial()[ds.tutorial] = el.checked;
	} else {
		return; // Number inputs are handled on "input".
	}
	renderPlayer();
});

view.addEventListener("click", (e) => {
	const id = e.target.dataset?.seenRemove;
	if (!P || id === undefined) return;
	const t = tutorial();
	t.seen = t.seen.filter((x) => x !== id);
	renderPlayer();
});

async function toggleHidden() {
	const hidden = !P.lb.hidden;
	if (!confirm(hidden ? "Take this player off both leaderboards?" : "Put this player back on the leaderboards?")) return;
	try {
		await fs("PATCH", `leaderboard/${encodeURIComponent(P.uid)}?updateMask.fieldPaths=hidden&currentDocument.exists=true`,
			{ fields: { hidden: { booleanValue: hidden } } });
		P.lb.hidden = hidden;
		toast(hidden ? "Hidden from the leaderboards" : "Back on the leaderboards");
		renderPlayer();
	} catch (e) {
		toast(e.message, true);
	}
}

async function savePlayer() {
	const changed = changedPaths();
	if (!changed.length) return;
	const o = P.orig;
	const d = P.draft;
	const seq = (o.dev_edit_seq || 0) + 1;
	const stillPending = (o.dev_edit_seq || 0) > (o.dev_seen_seq || 0);
	const editFields = stillPending ? [...new Set([...(o.dev_edit_fields || []), ...changed])] : changed;

	const partial = {};
	for (const p of changed) setPath(partial, p, getPath(d, p) ?? null);
	partial.dev_edit_seq = seq;
	partial.dev_edit_fields = editFields;
	const writes = [{
		update: { name: docName(`scores/${P.uid}`), fields: encode(partial).mapValue.fields },
		updateMask: { fieldPaths: [...changed, "dev_edit_seq", "dev_edit_fields"] },
		currentDocument: { updateTime: P.updateTime },
	}];

	// Keep the public leaderboard entry in step with what changed.
	if (P.lb) {
		const lb = {};
		if (changed.includes("high_level_index")) lb.high_level_index = d.high_level_index ?? -1;
		if (changed.includes("high_kill_count")) lb.high_kill_count = d.high_kill_count ?? 0;
		if (changed.includes("achievements.unlocked")) {
			const enabled = new Set(GAME.achievements.filter((a) => a.enabled).map((a) => a.id));
			lb.achievement_count = (d.achievements?.unlocked || []).filter((id) => enabled.has(id)).length;
		}
		if (changed.includes("equipped_skin_id") || changed.includes("unlocked_skin_ids")) lb.skin = d.equipped_skin_id || "granny_default";
		const keys = Object.keys(lb).filter((k) => stable(lb[k]) !== stable(P.lb[k]));
		if (keys.length) {
			const fields = {};
			for (const k of keys) fields[k] = encode(lb[k]);
			writes.push({
				update: { name: docName(`leaderboard/${P.uid}`), fields },
				updateMask: { fieldPaths: keys },
				currentDocument: { exists: true },
			});
		}
	}

	const btn = $("#save");
	btn.disabled = true;
	btn.textContent = "Saving…";
	try {
		await commit(writes);
		toast(`Saved. Their game takes it in on its next save or launch.`);
		const keep = P.uid;
		P = null;
		leaveGuard = null;
		showPlayer(keep);
	} catch (e) {
		btn.disabled = false;
		btn.textContent = "Save to their profile";
		if (e.status === 409 || /precondition|base version|does not match/i.test(e.message)) {
			// Their game pushed since this page loaded: reload, keep the edits on top.
			const mine = {};
			for (const p of changed) mine[p] = clone(getPath(d, p));
			await showPlayer(P.uid);
			for (const p of changed) setPath(P.draft, p, mine[p]);
			renderPlayer();
			toast("Their profile changed since you loaded it (their game synced). Reloaded with your edits on top - check and save again.", true);
		} else {
			toast(e.message, true);
		}
	}
}

// --- Messages ------------------------------------------------------------

async function showMessages() {
	view.innerHTML = `
		<h1>Dev messages</h1>
		<p class="muted">Pops up in every game that is open right now, within about 45 seconds, then pauses it until the player taps Got It. Players who open the game later never see it. It waits out boss fights.</p>
		<div class="grid">
			<section class="card stack">
				<h2>New message</h2>
				<label>English <textarea id="m-en" maxlength="400" placeholder="Server maintenance in 10 minutes - finish your room!"></textarea></label>
				<label>French <span class="muted small">(optional, French players see English without it)</span>
					<textarea id="m-fr" maxlength="400" placeholder="Maintenance du serveur dans 10 minutes — termine ta pièce !"></textarea></label>
				<div class="toolbar"><button class="btn" type="button" id="send">Send to open games</button><span class="spacer"></span><button class="btn ghost small" type="button" id="clear">Clear current</button></div>
			</section>
			<section class="card stack">
				<h2>Preview</h2>
				<div class="tabs"><button type="button" data-lang="en" aria-pressed="true">English</button><button type="button" data-lang="fr" aria-pressed="false">French</button></div>
				<div class="preview"><div class="pop"><h3 id="p-title">Message from the Devs</h3><p id="p-text"></p><span id="p-btn">Got It</span></div></div>
			</section>
			<section class="card wide">
				<h2>Sent</h2>
				<div id="history" class="table-wrap"><p class="loading">Loading…</p></div>
			</section>
		</div>`;
	let lang = "en";
	const en = $("#m-en");
	const fr = $("#m-fr");
	const preview = () => {
		const fallback = "(empty)";
		$("#p-title").textContent = lang === "fr" ? "Message des développeurs" : "Message from the Devs";
		$("#p-btn").textContent = lang === "fr" ? "Compris" : "Got It";
		$("#p-text").textContent = (lang === "fr" ? fr.value.trim() || en.value.trim() : en.value.trim()) || fallback;
	};
	view.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
		lang = b.dataset.lang;
		view.querySelectorAll("[data-lang]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
		preview();
	}));
	en.addEventListener("input", preview);
	fr.addEventListener("input", preview);
	preview();
	leaveGuard = () => !!(en.value.trim() || fr.value.trim());

	$("#send").addEventListener("click", async () => {
		const textEn = en.value.trim();
		if (!textEn) return toast("Write the English text first.", true);
		if (!confirm("Send this to every game that's open right now?")) return;
		await sendBroadcast(textEn, fr.value.trim());
		en.value = fr.value = "";
		preview();
		loadHistory();
	});
	$("#clear").addEventListener("click", async () => {
		if (!confirm("Clear the current message? Games that haven't shown it yet won't.")) return;
		await sendBroadcast("", "");
		loadHistory();
	});
	loadHistory();
}

async function sendBroadcast(textEn, textFr) {
	const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const fields = encode({ id, text_en: textEn, text_fr: textFr, sent_by: auth.name }).mapValue.fields;
	const write = (path) => ({
		update: { name: docName(path), fields },
		updateTransforms: [{ fieldPath: "sent_at", setToServerValue: "REQUEST_TIME" }],
	});
	try {
		// broadcast/current is what games read; the copy under its id is the history.
		await commit(textEn ? [write("broadcast/current"), write(`broadcast/${id}`)] : [write("broadcast/current")]);
		toast(textEn ? "Sent. Open games show it within about 45 seconds." : "Cleared.");
	} catch (e) {
		toast(e.message, true);
	}
}

async function loadHistory() {
	const box = $("#history");
	try {
		const docs = await listDocs("broadcast");
		const items = docs.map((d) => ({ doc: docId(d), ...decodeFields(d.fields) }));
		const current = items.find((m) => m.doc === "current");
		const sent = items.filter((m) => m.doc !== "current" && m.text_en).sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""));
		box.innerHTML = sent.length ? `<table><thead><tr><th>Sent</th><th>By</th><th>Message</th><th></th></tr></thead><tbody>
			${sent.map((m) => `<tr><td class="muted">${esc(when(m.sent_at))}</td><td>${esc(m.sent_by)}</td>
				<td style="white-space:normal">${esc(m.text_en)}${m.text_fr ? `<br><span class="muted small">${esc(m.text_fr)}</span>` : ""}</td>
				<td>${current && current.id === m.id ? `<span class="badge ok">Current</span>` : ""}</td></tr>`).join("")}
		</tbody></table>` : `<p class="muted">Nothing sent yet.</p>`;
	} catch (e) {
		box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
	}
}

// --- Config --------------------------------------------------------------

const CONFIG_NOTES = {
	app: "<code>min_version</code>: Play Store builds below this version must update before they can play (UpdateGate). Raise it only once the new version is live on Play.",
	game: "<code>achievement_total</code>: how many achievements are enabled. The rules reject any profile claiming more, so update it whenever achievements.csv changes.",
};
const TYPES = { integerValue: "integer", doubleValue: "decimal", stringValue: "text", booleanValue: "yes/no" };

async function showConfig() {
	view.innerHTML = `<h1>Config</h1><p class="muted">Game-wide settings in Firestore's <code>config</code> collection.</p><div class="grid" id="configs"><p class="loading">Loading…</p></div>`;
	const box = $("#configs");
	try {
		const docs = await listDocs("config");
		for (const name of ["app", "game"]) {
			if (!docs.some((d) => docId(d) === name)) docs.push({ name: docName(`config/${name}`), fields: {}, missing: true });
		}
		box.innerHTML = "";
		const dirty = new Set();
		leaveGuard = () => dirty.size > 0;
		for (const doc of docs) box.appendChild(configCard(doc, dirty));
	} catch (e) {
		box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
	}
}

function configCard(doc, dirty) {
	const id = docId(doc);
	const card = document.createElement("section");
	card.className = "card stack";
	const rows = Object.entries(doc.fields || {}).map(([key, value]) => ({ key, value, orig: value }));
	const removed = [];

	const draw = () => {
		card.innerHTML = `
			<h2>config/${esc(id)} ${doc.missing ? `<span class="badge warn">Not created yet</span>` : ""}</h2>
			${CONFIG_NOTES[id] ? `<p class="muted small">${CONFIG_NOTES[id]}</p>` : ""}
			<div class="fields">
				${rows.map((r, i) => {
					const type = Object.keys(r.value)[0];
					const v = r.value[type];
					const input = type === "booleanValue"
						? `<select data-i="${i}"><option value="true" ${v ? "selected" : ""}>true</option><option value="false" ${v ? "" : "selected"}>false</option></select>`
						: TYPES[type] ? `<input data-i="${i}" ${type === "stringValue" ? "" : `type="number" step="${type === "integerValue" ? 1 : "any"}"`} value="${esc(v)}">`
						: `<code>${esc(JSON.stringify(v))}</code>`;
					return `<label>${esc(r.key)} <span class="muted small">${TYPES[type] || type}</span></label>
						<div>${input} <button class="link small" type="button" data-remove="${i}">remove</button></div>`;
				}).join("") || `<span class="muted">No fields.</span><span></span>`}
			</div>
			<div class="toolbar">
				<input id="nk-${esc(id)}" placeholder="new field" aria-label="New field name">
				<select id="nt-${esc(id)}" aria-label="New field type">${Object.entries(TYPES).map(([t, n]) => `<option value="${t}">${n}</option>`).join("")}</select>
				<button class="btn ghost small" type="button" data-add>Add field</button>
				<span class="spacer"></span>
				<button class="btn small" type="button" data-save>Save</button>
			</div>`;
	};
	draw();

	card.addEventListener("input", (e) => {
		const i = e.target.dataset.i;
		if (i === undefined) return;
		const type = Object.keys(rows[i].value)[0];
		const raw = e.target.value;
		rows[i].value = { [type]: type === "booleanValue" ? raw === "true" : type === "stringValue" ? raw : type === "integerValue" ? String(Math.trunc(Number(raw) || 0)) : Number(raw) || 0 };
		dirty.add(id);
	});
	card.addEventListener("click", async (e) => {
		const t = e.target;
		if (t.dataset.remove !== undefined) {
			removed.push(rows.splice(Number(t.dataset.remove), 1)[0].key);
			dirty.add(id);
			draw();
		} else if (t.dataset.add !== undefined) {
			const key = $(`#nk-${CSS.escape(id)}`, card).value.trim();
			const type = $(`#nt-${CSS.escape(id)}`, card).value;
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return toast("Field names: letters, digits and _ only.", true);
			if (rows.some((r) => r.key === key)) return toast("That field already exists.", true);
			rows.push({ key, value: { [type]: type === "booleanValue" ? false : type === "stringValue" ? "" : type === "integerValue" ? "0" : 0 } });
			dirty.add(id);
			draw();
		} else if (t.dataset.save !== undefined) {
			const changed = rows.filter((r) => stable(r.value) !== stable(r.orig)).map((r) => r.key);
			const mask = [...changed, ...removed.filter((k) => !rows.some((r) => r.key === k))];
			if (!mask.length) return toast("Nothing changed.");
			if (!confirm(`Save ${mask.join(", ")} to config/${id}? This is live for every player.`)) return;
			const fields = {};
			for (const r of rows) if (changed.includes(r.key)) fields[r.key] = r.value;
			try {
				await fs("PATCH", `config/${encodeURIComponent(id)}?${mask.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&")}`, { fields });
				for (const r of rows) r.orig = r.value;
				removed.length = 0;
				doc.missing = false;
				dirty.delete(id);
				draw();
				toast(`config/${id} saved`);
			} catch (err) {
				toast(err.message, true);
			}
		}
	});
	return card;
}

boot();
