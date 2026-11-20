/* Card Game dev panel (Firebase project cardgame-fcg).
 *
 * Who asked for access to the web Card Editor (access_requests), who has it (editors), and what
 * they saved (drafts, draft_art; read-only). One click gives or removes access.
 *
 * A dev is an account with an admins/{uid} document with enabled: true; the Firestore rules
 * (CardGame repo) decide everything. Sign-in happens on the gateway (/dev/). Talks to Firebase
 * Auth (token refresh) and Firestore over REST (no SDK), with the dev's own token.
 * Never lists draft_art with its b64 field (large): a field mask leaves it out.
 */
"use strict";

const API_KEY = "AIzaSyALd0GN2PZFLV-FYYML2Snk5PMGN1yk1zk"; // Public web API key.
const PROJECT_ID = "cardgame-fcg";
const DB_NAME = `projects/${PROJECT_ID}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DB_NAME}`;
const REFRESH_KEY = "cg-dev-refresh";
const EMAIL_KEY = "cg-dev-email";
const DRAFT_SHOWN = 50;
const LIST_LIMIT = 5000;

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

function ms(ts) {
	const t = Date.parse(ts || "");
	return Number.isFinite(t) ? t : 0;
}

function localTime(t) {
	const v = typeof t === "number" ? t : ms(t);
	if (!v) return "";
	const d = new Date(v), p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const shortUid = (uid) => (uid.length > 10 ? `${uid.slice(0, 8)}…` : uid);
const docPath = (coll, id) => `${coll}/${encodeURIComponent(id)}`;
const fullName = (coll, id) => `${DB_NAME}/${coll}/${encodeURIComponent(id)}`;

function uidCell(uid) {
	return `<span class="uid"><code data-copy="${esc(uid)}" title="Copy the full uid: ${esc(uid)}">${esc(shortUid(uid))}</code></span>`;
}

async function copyText(text) {
	try { await navigator.clipboard.writeText(text); toast("Copied."); }
	catch (_) { toast("Could not copy. Select the text by hand.", true); }
}

function fmtBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
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

async function postForm(url, body) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
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
	const data = await postForm(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
		{ grant_type: "refresh_token", refresh_token: auth.refreshToken });
	setSession(data.user_id, data.id_token, data.refresh_token, data.expires_in);
	return auth.idToken;
}

// Sign out of every game's panel (the gateway's sessions too) and go back to the gateway (/dev/).
function signOutEverywhere() {
	try {
		for (const k of Object.keys(sessionStorage)) if (/^(ia|yt|bk|sh|cg)-dev-|^dev-/.test(k)) sessionStorage.removeItem(k);
	} catch (_) { /* Storage blocked: nothing kept anyway. */ }
	location.href = "/dev/";
}

// --- Firestore REST ------------------------------------------------------

class FsError extends Error {
	constructor(status, message) { super(message); this.status = status; }
}

// what: a short phrase for the error message ("read the requests", "give access").
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
		if (res.status === 403) msg = `This account is not a Card Game dev (needs admins/{uid}), or the rules do not allow it to ${what}. uid ${auth.uid}.`;
		else if (res.status === 401) msg = `The session is no longer valid, so ${what} failed. Sign out and sign in again.`;
		else if (res.status === 404) msg = `Not found: could not ${what}. The document may be gone. Press Refresh.`;
		else if (res.status === 409) msg = `Conflict: could not ${what}. Someone may have changed it already. Press Refresh.`;
		else if (res.status === 429) msg = `Google says too many requests, so ${what} failed. Wait a moment and try again.`;
		throw new FsError(res.status, msg);
	}
	return data;
}

// Documents of a collection: [{id, f (decoded fields)}]. mask: field names to read (leaves big fields out).
async function listDocs(coll, mask, what) {
	const q = { from: [{ collectionId: coll }], limit: LIST_LIMIT };
	if (mask) q.select = { fields: mask.map((fieldPath) => ({ fieldPath })) };
	const rows = await fs("POST", `${FS}:runQuery`, { structuredQuery: q }, what);
	return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split("/").pop(), f: decodeFields(r.document.fields) }));
}

const str = (v) => ({ stringValue: v });

// Give access: create editors/{uid} and delete access_requests/{uid} in one commit.
async function giveAccess(uid, name) {
	await fs("POST", `${FS}:commit`, { writes: [
		{
			update: { name: fullName("editors", uid), fields: { enabled: { booleanValue: true }, name: str(name) } },
			updateTransforms: [{ fieldPath: "added", setToServerValue: "REQUEST_TIME" }],
			currentDocument: { exists: false },
		},
		{ delete: fullName("access_requests", uid) },
	] }, "give access");
}

async function deleteDoc(coll, id, what) {
	await fs("DELETE", docPath(coll, id), undefined, what);
}

async function patchEditor(uid, field, value, what) {
	await fs("POST", `${FS}:commit`, { writes: [{
		update: { name: fullName("editors", uid), fields: { [field]: value } },
		updateMask: { fieldPaths: [field] },
		currentDocument: { exists: true },
	}] }, what);
}

const cleanName = (v) => Array.from(String(v ?? "").trim()).slice(0, 40).join("").trim() || "Unnamed";
const validName = (v) => { const n = Array.from(String(v ?? "").trim()); return n.length >= 1 && n.length <= 40 ? n.join("") : null; };

// --- The page ------------------------------------------------------------

let data = null; // {requests, editors, drafts, art}
let artBytes = null; // Estimated draft art size, once measured.

async function load() {
	const [requests, editors, drafts, art] = await Promise.all([
		listDocs("access_requests", null, "read the access requests"),
		listDocs("editors", null, "read the editors"),
		listDocs("drafts", ["kind", "item_id", "action", "author", "updated"], "read the drafts"),
		listDocs("draft_art", ["name", "mime", "author", "updated"], "read the draft art"),
	]);
	requests.sort((a, b) => ms(b.f.requested) - ms(a.f.requested));
	editors.sort((a, b) => ms(b.f.added) - ms(a.f.added));
	drafts.sort((a, b) => ms(b.f.updated) - ms(a.f.updated));
	data = { requests, editors, drafts, art };
}

async function refresh() {
	view.innerHTML = `<p class="loading">Loading…</p>`;
	artBytes = null;
	try {
		await load();
		draw();
	} catch (e) {
		view.innerHTML = `<div class="card"><h2>Couldn't load that</h2><p class="error">${esc(e.message)}</p><p><button class="btn" id="retry" type="button">Refresh</button></p></div>`;
		$("#retry").addEventListener("click", refresh);
	}
}

function draw() {
	const { requests, editors, drafts, art } = data;
	const names = {};
	for (const e of editors) names[e.id] = e.f.name || "";
	const author = (uid) => (names[uid] ? `${esc(names[uid])} ` : "") + uidCell(uid || "?");
	const kinds = {};
	for (const d of drafts) kinds[d.f.kind || "?"] = (kinds[d.f.kind || "?"] || 0) + 1;

	const reqRows = requests.map((r) => `<tr data-uid="${esc(r.id)}" data-name="${esc(r.f.name || "")}">
		<td><b>${esc(r.f.name || "(no name)")}</b></td>
		<td class="note-cell">${esc(r.f.note || "")}</td>
		<td>${uidCell(r.id)}</td>
		<td>${esc(localTime(r.f.requested))}</td>
		<td><div class="actions"><button class="btn small" data-act="give" type="button">Give access</button><button class="btn ghost small" data-act="dismiss" type="button">Dismiss</button></div></td>
	</tr>`).join("");

	const edRows = editors.map((e) => `<tr data-uid="${esc(e.id)}">
		<td><form class="rename-row" data-act="rename"><input type="text" value="${esc(e.f.name || "")}" maxlength="40" aria-label="Name" required><button class="btn ghost small" type="submit">Rename</button></form></td>
		<td>${uidCell(e.id)}</td>
		<td>${esc(localTime(e.f.added))}</td>
		<td>${e.f.enabled === true ? `<span class="badge ok">On</span>` : `<span class="badge warn">Off</span>`}</td>
		<td><div class="actions"><button class="btn ghost small" data-act="toggle" data-on="${e.f.enabled === true ? "1" : "0"}" type="button">${e.f.enabled === true ? "Disable" : "Enable"}</button><button class="btn danger small" data-act="remove" type="button">Remove</button></div></td>
	</tr>`).join("");

	const draftRows = drafts.slice(0, DRAFT_SHOWN).map((d) => `<tr>
		<td>${esc(d.f.kind || "")}</td><td>${esc(d.f.item_id || d.id)}</td><td>${esc(d.f.action || "")}</td>
		<td>${author(d.f.author)}</td><td>${esc(localTime(d.f.updated))}</td>
	</tr>`).join("");

	view.innerHTML = `<div class="stack">
		<div class="toolbar"><button class="btn" id="refresh" type="button">Refresh</button></div>

		<section class="card"><h2>Access requests <span class="count">${requests.length}</span></h2>
			${requests.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Note</th><th>Uid</th><th>Asked</th><th></th></tr></thead><tbody>${reqRows}</tbody></table></div>`
				: `<p class="muted">No one is waiting.</p>`}
		</section>

		<section class="card"><h2>Editors <span class="count">${editors.length}</span></h2>
			${editors.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Uid</th><th>Added</th><th>Status</th><th></th></tr></thead><tbody>${edRows}</tbody></table></div>`
				: `<p class="muted">No editors yet.</p>`}
		</section>

		<section class="card"><h2>Drafts inbox <span class="count">${drafts.length}</span></h2>
			<p class="muted">Import them into the game with <code>node tools/pull_drafts.mjs</code> in the CardGame repo. This page only reads them.</p>
			<div class="counts">${Object.entries(kinds).map(([k, n]) => `<span class="badge accent">${esc(k)} ${n}</span>`).join("") || `<span class="muted">No drafts.</span>`}</div>
			${drafts.length ? `<div class="table-wrap"><table><thead><tr><th>Kind</th><th>Item</th><th>Action</th><th>Author</th><th>Updated</th></tr></thead><tbody>${draftRows}</tbody></table></div>` : ""}
			${drafts.length > DRAFT_SHOWN ? `<p class="muted small">Showing the newest ${DRAFT_SHOWN} of ${drafts.length}.</p>` : ""}
			<h3>Art</h3>
			<p>${art.length} image${art.length === 1 ? "" : "s"}${artBytes === null ? "" : `, about ${esc(fmtBytes(artBytes))}`}.
			${art.length && artBytes === null ? `<button class="btn ghost small" id="art-size" type="button">Estimate size</button>` : ""}</p>
		</section>
	</div>`;

	$("#refresh").addEventListener("click", refresh);
	$("#art-size")?.addEventListener("click", measureArt);
}

// Measure the art one image at a time (b64 is large and never listed): about 3/4 of the base64 length.
async function measureArt(e) {
	const btn = e.currentTarget;
	btn.disabled = true;
	let total = 0;
	try {
		for (let i = 0; i < data.art.length; i++) {
			btn.textContent = `Measuring ${i + 1} of ${data.art.length}…`;
			const doc = await fs("GET", `${docPath("draft_art", data.art[i].id)}?mask.fieldPaths=b64`, undefined, "measure the art");
			total += Math.floor((doc.fields?.b64?.stringValue || "").length * 3 / 4);
		}
		artBytes = total;
		draw();
	} catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = "Estimate size"; }
}

// One delegated listener pair on the view; the page content changes but the view stays.
view.addEventListener("click", async (e) => {
	const copy = e.target.closest("[data-copy]");
	if (copy) { copyText(copy.dataset.copy); return; }
	const b = e.target.closest("button[data-act]");
	const tr = b?.closest("tr[data-uid]");
	if (!b || !tr) return;
	const uid = tr.dataset.uid;
	const act = b.dataset.act;
	if (act === "dismiss" && !confirm("Dismiss this request? The person can ask again.")) return;
	if (act === "remove" && !confirm("Remove this editor? Their access ends. Their drafts stay.")) return;
	b.disabled = true;
	try {
		if (act === "give") { await giveAccess(uid, cleanName(tr.dataset.name)); toast("Access given."); }
		else if (act === "dismiss") { await deleteDoc("access_requests", uid, "dismiss the request"); toast("Request dismissed."); }
		else if (act === "toggle") {
			const on = b.dataset.on !== "1";
			await patchEditor(uid, "enabled", { booleanValue: on }, on ? "enable this editor" : "disable this editor");
			toast(on ? "Editor enabled." : "Editor disabled.");
		} else if (act === "remove") { await deleteDoc("editors", uid, "remove this editor"); toast("Editor removed."); }
		else { b.disabled = false; return; }
		await refresh();
	} catch (err) { toast(err.message, true); b.disabled = false; }
});

view.addEventListener("submit", async (e) => {
	const form = e.target.closest("form[data-act='rename']");
	if (!form) return;
	e.preventDefault();
	const uid = form.closest("tr").dataset.uid;
	const n = validName(form.querySelector("input").value);
	if (!n) { toast("Use 1 to 40 characters.", true); return; }
	const btn = form.querySelector("button");
	btn.disabled = true;
	try {
		await patchEditor(uid, "name", str(n), "rename this editor");
		const ed = data.editors.find((x) => x.id === uid);
		if (ed) ed.f.name = n;
		toast("Name changed.");
	} catch (err) { toast(err.message, true); }
	btn.disabled = false;
});

// --- Boot ----------------------------------------------------------------

async function boot() {
	$("#who").hidden = true;
	$("#signin").hidden = true;
	view.innerHTML = "";
	auth.refreshToken = auth.refreshToken || store(REFRESH_KEY) || "";
	auth.email = auth.email || store(EMAIL_KEY) || store("dev-email") || "";
	if (!auth.refreshToken) {
		location.replace("/dev/#cardgame"); // One sign-in for every game: the gateway signs in and comes back here.
		return;
	}
	view.innerHTML = `<p class="loading">Signing in…</p>`;
	try {
		await token();
		let me = null;
		try { me = await fs("GET", docPath("admins", auth.uid), undefined, "check admin access"); }
		catch (e) { if (e.status !== 404) throw e; }
		if (decodeFields(me?.fields).enabled !== true) {
			throw new Error(`Signed in, but this account is not a Card Game dev: it needs an admins/{uid} document with enabled: true (uid ${auth.uid}).`);
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
	await refresh();
}

$("#sign-out").addEventListener("click", signOutEverywhere);
boot();
