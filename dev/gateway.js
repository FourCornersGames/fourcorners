/* Four Corners Dev gateway (README.md "Dev panels").
 *
 * Each game has its own Firebase project, so its own accounts. One sign-in here
 * tries the email and password on every game's project at once (Firebase Auth
 * REST, no SDK), asks each game's own rules whether that account is a dev, and
 * keeps each game's session in sessionStorage under the keys that game's panel
 * already reads, so opening a panel needs no second sign-in. A game where the
 * account has no login, or isn't a dev, says so on its card.
 *
 * To add a game: a GAMES entry (its public API key, project, panel path, the
 * sessionStorage keys its panel reads, and how it decides who is a dev).
 */
"use strict";

const GAMES = [
	{
		id: "idleadventure", name: "Pocket Quest", icon: "/idleadventure/img/icon.webp", path: "/dev/idleadventure/",
		apiKey: "AIzaSyD6o36y0eVCQcWBCx7eCfons5QoqIfEmf8", project: "idleadventure-fcg",
		refreshKey: "ia-dev-refresh", emailKey: "ia-dev-email",
		need: "admins/{uid} in Firestore and admins/{uid} = true in the Realtime Database",
		async isDev(uid, tok) {
			const rtdb = await getJson(`https://idleadventure-fcg-default-rtdb.firebaseio.com/admins/${uid}.json?auth=${tok}`);
			const doc = await fsDoc(this.project, `admins/${uid}`, tok);
			return rtdb === true && doc !== null;
		},
	},
	{
		id: "yarntoss", name: "YarnToss", icon: "/yarntoss/img/icon.webp", path: "/dev/yarntoss/",
		apiKey: "AIzaSyB_jg9qNOJSX16NBcIVnrDk5Aiz6YlHGOM", project: "yarntoss-login",
		refreshKey: "yt-dev-refresh", emailKey: "",
		need: "is_dev: true on its scores/{uid} profile",
		async isDev(uid, tok) {
			const doc = await fsDoc(this.project, `scores/${uid}`, tok);
			return doc?.fields?.is_dev?.booleanValue === true;
		},
	},
	{
		id: "bakery", name: "Whiskers Cafe", icon: "/catcafe/img/icon.webp", path: "/dev/bakery/",
		apiKey: "AIzaSyATfD6ZCIdhCGsVxlsPG0RUvplwkBONjhk", project: "catcafe-97a16",
		refreshKey: "bk-dev-refresh", emailKey: "bk-dev-email",
		need: "a devs/{uid} document with enabled: true",
		async isDev(uid, tok) {
			const doc = await fsDoc(this.project, `devs/${uid}`, tok);
			return doc?.fields?.enabled?.booleanValue === true;
		},
	},
];
const EMAIL_KEY = "dev-email";
// Each game's last result this tab ({id: {ok, text}}), so the picker shows it after a reload.
const STATUS_KEY = "dev-status";

const $ = (sel) => document.querySelector(sel);

function esc(v) {
	return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function store(key, value) {
	try {
		if (value === undefined) return sessionStorage.getItem(key);
		if (value === null) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, value);
	} catch (_) { /* Storage blocked: sessions won't survive a reload. */ }
	return null;
}

async function getJson(url, opts) {
	const res = await fetch(url, opts);
	const data = await res.json().catch(() => null);
	if (!res.ok) {
		const err = new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
		err.status = res.status;
		throw err;
	}
	return data;
}

// A Firestore document, or null when it doesn't exist or the rules hide it.
async function fsDoc(project, path, tok) {
	try {
		return await getJson(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`,
			{ headers: { Authorization: `Bearer ${tok}` } });
	} catch (e) {
		if (e.status === 404 || e.status === 403) return null;
		throw e;
	}
}

function authError(msg) {
	if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(msg)) return "No account with this email and password in this game.";
	if (/TOO_MANY_ATTEMPTS/.test(msg)) return "Too many tries — wait a bit and try again.";
	if (/USER_DISABLED/.test(msg)) return "This account is disabled in this game.";
	if (/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(msg)) return "Email / password sign-in isn't switched on in this game's Firebase project.";
	return msg;
}

// Sign in to one game and check it. Returns {ok, text}; on success its session is stored for its panel.
async function tryGame(g, email, password) {
	let auth;
	try {
		auth = await getJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${g.apiKey}`, {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password, returnSecureToken: true }),
		});
	} catch (e) {
		return { ok: false, text: authError(e.message) };
	}
	try {
		if (!(await g.isDev(auth.localId, auth.idToken))) {
			return { ok: false, text: `Signed in, but not a dev here yet: needs ${g.need} (uid ${auth.localId}).` };
		}
	} catch (e) {
		return { ok: false, text: `Couldn't check dev access: ${e.message}` };
	}
	store(g.refreshKey, auth.refreshToken);
	if (g.emailKey) store(g.emailKey, auth.email || email);
	return { ok: true, text: "Signed in as a dev." };
}

function statuses() {
	try { return JSON.parse(store(STATUS_KEY) || "{}"); } catch (_) { return {}; }
}

function signedInAnywhere() {
	return GAMES.some((g) => store(g.refreshKey));
}

function render() {
	const email = store(EMAIL_KEY) || "";
	const st = statuses();
	$("#signin").hidden = signedInAnywhere();
	$("#games").hidden = !signedInAnywhere();
	$("#who").hidden = !signedInAnywhere();
	$("#who-name").textContent = email;
	if (!signedInAnywhere()) return;
	const open = GAMES.filter((g) => store(g.refreshKey)).length;
	$("#games-note").textContent = `${open} of ${GAMES.length} games open for ${email}. Each game keeps its own accounts: a game that says "no account" needs a dev login with this same email and password in its Firebase project.`;
	$("#game-list").innerHTML = GAMES.map((g) => {
		const on = !!store(g.refreshKey);
		const s = st[g.id] || { ok: on, text: on ? "Signed in as a dev." : "Not signed in." };
		return `<div class="game${on ? "" : " off"}">
			<div class="game-head"><img src="${esc(g.icon)}" alt="" width="56" height="56"><h2>${esc(g.name)}</h2></div>
			<p class="status small ${on ? "ok" : "bad"}">${esc(s.text)}</p>
			${on ? `<a class="btn" href="${esc(g.path)}">Open ${esc(g.name)}</a>` : ""}
		</div>`;
	}).join("");
	// Coming from a panel that sent us here (/dev/#yarntoss) with that game open: go straight back.
	const want = location.hash.slice(1);
	const g = GAMES.find((x) => x.id === want);
	if (g && store(g.refreshKey) && sessionStorage.getItem("dev-just-signed-in") === "1") {
		sessionStorage.removeItem("dev-just-signed-in");
		location.replace(g.path);
	}
}

$("#signin-form").addEventListener("submit", async (e) => {
	e.preventDefault();
	const form = e.target;
	const email = form.email.value.trim();
	const password = form.password.value;
	$("#signin-error").textContent = "";
	form.querySelector("button").disabled = true;
	form.querySelector("button").textContent = "Signing in…";
	const results = await Promise.all(GAMES.map((g) => tryGame(g, email, password)));
	form.querySelector("button").disabled = false;
	form.querySelector("button").textContent = "Sign In";
	const st = {};
	GAMES.forEach((g, i) => (st[g.id] = results[i]));
	store(STATUS_KEY, JSON.stringify(st));
	if (!results.some((r) => r.ok)) {
		$("#signin-error").textContent = results.map((r, i) => `${GAMES[i].name}: ${r.text}`).join(" ");
		return;
	}
	form.password.value = "";
	store(EMAIL_KEY, email);
	try { sessionStorage.setItem("dev-just-signed-in", "1"); } catch (_) { /* fine */ }
	render();
});

$("#sign-out").addEventListener("click", () => {
	for (const g of GAMES) {
		store(g.refreshKey, null);
		if (g.emailKey) store(g.emailKey, null);
	}
	store(EMAIL_KEY, null);
	store(STATUS_KEY, null);
	render();
});

render();
