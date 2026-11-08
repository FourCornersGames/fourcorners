#!/usr/bin/env node
// Google Play Developer API helper (no dependencies).
//
//   node tools/play.mjs check                 every app: can we open an edit, and what is on each track
//   node tools/play.mjs tracks <app>          releases on every track
//   node tools/play.mjs listing <app> [lang]  store listing text (default en-US)
//   node tools/play.mjs info [app]            app details + title/short description in every listing language
//   node tools/play.mjs reviews <app>        recent reviews (last 7 days, API limit)
//   node tools/play.mjs get <path>            raw GET under /androidpublisher/v3/applications/
//
// <app> is a short name below or a full package name.
// The service account key is read from PLAY_SA_KEY, or the default path below.
// It lives outside the repo; never copy it in.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_PATH = process.env.PLAY_SA_KEY
	|| 'C:/Users/James/Documents/Personal/FourCorners/Secrets/catcafe-97a16-421e12cbf7a9.json';

export const APPS = {
	pocketquest: 'ca.fourcornersgames.idleadventure', // Pocket Quest (was IdleAdventure)
	whiskers: 'ca.fourcornersgames.catcafe',          // Whiskers Cafe (was Bakery / CatCafe)
	yarntoss: 'ca.fourcornersgames.yarntoss',
};

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const b64url = (s) => Buffer.from(s).toString('base64url');

let token;
export async function getToken() {
	if (token) return token;
	const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
	const now = Math.floor(Date.now() / 1000);
	const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify({
		iss: key.client_email,
		scope: 'https://www.googleapis.com/auth/androidpublisher',
		aud: key.token_uri,
		iat: now,
		exp: now + 3600,
	}));
	const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
	const res = await fetch(key.token_uri, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${unsigned}.${sig}`,
		}),
	});
	const body = await res.json();
	if (!res.ok) throw new Error(`token: ${res.status} ${JSON.stringify(body)}`);
	return (token = body.access_token);
}

export async function api(method, path, body) {
	const res = await fetch(`${API}/${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${await getToken()}`,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	const data = text ? JSON.parse(text) : {};
	if (!res.ok) {
		const err = new Error(`${method} ${path}: ${res.status} ${data.error?.message || text}`);
		err.status = res.status;
		throw err;
	}
	return data;
}

const pkg = (a) => APPS[a?.toLowerCase()] || a;

// Opens a throwaway edit, runs fn, then deletes the edit (nothing is committed).
async function withEdit(p, fn) {
	const edit = await api('POST', `${p}/edits`);
	try { return await fn(edit.id); }
	finally { await api('DELETE', `${p}/edits/${edit.id}`).catch(() => {}); }
}

async function tracks(p) {
	return withEdit(p, async (id) => (await api('GET', `${p}/edits/${id}/tracks`)).tracks || []);
}

function printTracks(list) {
	if (!list.length) return console.log('    (no tracks)');
	for (const t of list) {
		const rel = (t.releases || []).map((r) =>
			`${r.status}${r.name ? ` "${r.name}"` : ''} [${(r.versionCodes || []).join(',') || '-'}]` +
			(r.userFraction ? ` ${Math.round(r.userFraction * 100)}%` : '')).join('; ');
		console.log(`    ${t.track.padEnd(12)} ${rel || '(empty)'}`);
	}
}

const [cmd, arg, arg2] = process.argv.slice(2);
try {
	switch (cmd) {
		case 'check':
			for (const [name, p] of Object.entries(APPS)) {
				try {
					const list = await tracks(p);
					console.log(`OK   ${name} (${p})`);
					printTracks(list);
				} catch (e) {
					console.log(`FAIL ${name} (${p}): ${e.message}`);
				}
			}
			break;
		case 'info':
			for (const [name, p] of Object.entries(APPS)) {
				if (arg && pkg(arg) !== p) continue;
				await withEdit(p, async (id) => {
					const d = await api('GET', `${p}/edits/${id}/details`);
					const ls = (await api('GET', `${p}/edits/${id}/listings`)).listings || [];
					console.log(`== ${name} (${p})`);
					console.log(`   default ${d.defaultLanguage}  email ${d.contactEmail || '-'}  web ${d.contactWebsite || '-'}  phone ${d.contactPhone || '-'}`);
					for (const l of ls) console.log(`   ${l.language.padEnd(6)} "${l.title}" | ${l.shortDescription}`);
				});
			}
			break;
		case 'tracks':
			printTracks(await tracks(pkg(arg)));
			break;
		case 'listing': {
			const p = pkg(arg);
			const l = await withEdit(p, (id) => api('GET', `${p}/edits/${id}/listings/${arg2 || 'en-US'}`));
			console.log(JSON.stringify(l, null, 2));
			break;
		}
		case 'reviews': {
			const r = await api('GET', `${pkg(arg)}/reviews?maxResults=50`);
			for (const rv of r.reviews || []) {
				const c = rv.comments?.[0]?.userComment;
				console.log(`${c?.starRating}★ ${rv.authorName || '?'} (${c?.reviewerLanguage}): ${c?.text?.trim()}`);
			}
			if (!r.reviews?.length) console.log('(no reviews in the last 7 days)');
			break;
		}
		case 'get':
			console.log(JSON.stringify(await api('GET', arg), null, 2));
			break;
		default:
			console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n'));
	}
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
