#!/usr/bin/env node
// Discord server admin helper for the Four Corners server (no dependencies).
//
//   node tools/discord.mjs guilds                     servers the bot is in
//   node tools/discord.mjs overview                   roles + categories/channels with permission overwrites
//   node tools/discord.mjs roles                      roles, top to bottom, with their permissions
//   node tools/discord.mjs channels                   categories and channels (no overwrites)
//   node tools/discord.mjs members                    members and their roles
//   node tools/discord.mjs bits <NAME,NAME,...>       permission names -> bitfield string
//   node tools/discord.mjs decode <bitfield>          bitfield -> permission names
//   node tools/discord.mjs call <METHOD> <path> [json] [--reason "..."]
//                                                     raw API call under /api/v10 ("{guild}" in path = server id)
//
// Changes go through `call`, e.g.
//   node tools/discord.mjs call POST /guilds/{guild}/roles '{"name":"Playtester","permissions":"0"}'
//   node tools/discord.mjs call PUT /channels/<id>/permissions/<roleId> '{"type":0,"allow":"1024","deny":"0"}'
//
// Token: DISCORD_BOT_TOKEN. Never commit it. In Claude cloud sessions the proxy
// injects it for discord.com, so the placeholder below is overwritten.
// Server: DISCORD_GUILD_ID, or the only server the bot is in.

const API = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_BOT_TOKEN || 'proxy-injected';

export const PERMS = [
	'CREATE_INSTANT_INVITE', 'KICK_MEMBERS', 'BAN_MEMBERS', 'ADMINISTRATOR', 'MANAGE_CHANNELS',
	'MANAGE_GUILD', 'ADD_REACTIONS', 'VIEW_AUDIT_LOG', 'PRIORITY_SPEAKER', 'STREAM',
	'VIEW_CHANNEL', 'SEND_MESSAGES', 'SEND_TTS_MESSAGES', 'MANAGE_MESSAGES', 'EMBED_LINKS',
	'ATTACH_FILES', 'READ_MESSAGE_HISTORY', 'MENTION_EVERYONE', 'USE_EXTERNAL_EMOJIS', 'VIEW_GUILD_INSIGHTS',
	'CONNECT', 'SPEAK', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS',
	'USE_VAD', 'CHANGE_NICKNAME', 'MANAGE_NICKNAMES', 'MANAGE_ROLES', 'MANAGE_WEBHOOKS',
	'MANAGE_GUILD_EXPRESSIONS', 'USE_APPLICATION_COMMANDS', 'REQUEST_TO_SPEAK', 'MANAGE_EVENTS', 'MANAGE_THREADS',
	'CREATE_PUBLIC_THREADS', 'CREATE_PRIVATE_THREADS', 'USE_EXTERNAL_STICKERS', 'SEND_MESSAGES_IN_THREADS', 'USE_EMBEDDED_ACTIVITIES',
	'MODERATE_MEMBERS', 'VIEW_CREATOR_MONETIZATION_ANALYTICS', 'USE_SOUNDBOARD', 'CREATE_GUILD_EXPRESSIONS', 'CREATE_EVENTS',
	'USE_EXTERNAL_SOUNDS', 'SEND_VOICE_MESSAGES', null, null, 'SEND_POLLS',
	'USE_EXTERNAL_APPS', 'PIN_MESSAGES', 'BYPASS_SLOWMODE',
];

const CHANNEL_TYPES = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum', 16: 'media' };

export function bits(names) {
	let v = 0n;
	for (const n of names) {
		const i = PERMS.indexOf(n.trim().toUpperCase());
		if (i < 0) throw new Error(`unknown permission: ${n}`);
		v |= 1n << BigInt(i);
	}
	return v.toString();
}

export function decode(field) {
	const v = BigInt(field || 0);
	return PERMS.filter((n, i) => n && (v >> BigInt(i)) & 1n);
}

export async function api(method, path, body, reason) {
	for (;;) {
		const headers = { Authorization: `Bot ${TOKEN}` };
		if (body !== undefined) headers['Content-Type'] = 'application/json';
		if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason);
		const res = await fetch(API + path, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (res.status === 429) {
			const { retry_after = 1 } = await res.json().catch(() => ({}));
			await new Promise((r) => setTimeout(r, retry_after * 1000 + 100));
			continue;
		}
		const text = await res.text();
		const data = text ? JSON.parse(text) : null;
		if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
		return data;
	}
}

let guildId = process.env.DISCORD_GUILD_ID;
export async function guild() {
	if (guildId) return guildId;
	const gs = await api('GET', '/users/@me/guilds');
	if (gs.length !== 1) throw new Error(`bot is in ${gs.length} servers; set DISCORD_GUILD_ID`);
	return (guildId = gs[0].id);
}

async function getRoles() {
	const roles = await api('GET', `/guilds/${await guild()}/roles`);
	return roles.sort((a, b) => b.position - a.position);
}

async function getChannels() {
	return api('GET', `/guilds/${await guild()}/channels`);
}

// Categories in order, each with its children; uncategorized channels first.
function tree(channels) {
	const byPos = (a, b) => a.position - b.position || (a.id < b.id ? -1 : 1);
	const cats = channels.filter((c) => c.type === 4).sort(byPos);
	const kids = (pid) => channels.filter((c) => c.type !== 4 && (c.parent_id || null) === pid).sort(byPos);
	return [{ name: '(no category)', id: null, children: kids(null) }, ...cats.map((c) => ({ ...c, children: kids(c.id) }))];
}

function fmtOverwrites(ch, roleName, indent) {
	const out = [];
	for (const o of ch.permission_overwrites || []) {
		const who = o.type === 0 ? `@${roleName(o.id)}` : `member ${o.id}`;
		const allow = decode(o.allow), deny = decode(o.deny);
		const parts = [];
		if (allow.length) parts.push(`allow ${allow.join(', ')}`);
		if (deny.length) parts.push(`deny ${deny.join(', ')}`);
		out.push(`${indent}${who}: ${parts.join(' | ') || '(none)'}`);
	}
	return out;
}

async function printChannels(withOverwrites) {
	const [roles, channels] = await Promise.all([getRoles(), getChannels()]);
	const names = Object.fromEntries(roles.map((r) => [r.id, r.name]));
	const roleName = (id) => names[id] ?? id;
	for (const cat of tree(channels)) {
		if (cat.id === null && !cat.children.length) continue;
		console.log(`\n[${cat.name}]${cat.id ? `  ${cat.id}` : ''}`);
		if (withOverwrites && cat.id) fmtOverwrites(cat, roleName, '    ').forEach((l) => console.log(l));
		for (const ch of cat.children) {
			const synced = cat.id && JSON.stringify(sortOw(ch.permission_overwrites)) === JSON.stringify(sortOw(cat.permission_overwrites));
			console.log(`  ${CHANNEL_TYPES[ch.type] ?? `type${ch.type}`} #${ch.name}  ${ch.id}${withOverwrites && synced ? '  (synced)' : ''}`);
			if (withOverwrites && !synced) fmtOverwrites(ch, roleName, '      ').forEach((l) => console.log(l));
		}
	}
}

const sortOw = (ows = []) => [...ows].map(({ id, type, allow, deny }) => ({ id, type, allow, deny })).sort((a, b) => (a.id < b.id ? -1 : 1));

async function printRoles() {
	for (const r of await getRoles()) {
		const flags = [r.managed && 'managed/bot', r.hoist && 'hoisted', r.mentionable && 'mentionable'].filter(Boolean);
		const color = r.color ? ` #${r.color.toString(16).padStart(6, '0')}` : '';
		console.log(`${String(r.position).padStart(3)}  @${r.name}  ${r.id}${color}${flags.length ? `  (${flags.join(', ')})` : ''}`);
		const p = decode(r.permissions);
		console.log(`       ${p.includes('ADMINISTRATOR') ? 'ADMINISTRATOR' : p.join(', ') || '(no permissions)'}`);
	}
}

async function printMembers() {
	const roles = Object.fromEntries((await getRoles()).map((r) => [r.id, r.name]));
	let after = '0';
	for (;;) {
		const page = await api('GET', `/guilds/${await guild()}/members?limit=1000&after=${after}`);
		for (const m of page) {
			const name = m.nick || m.user.global_name || m.user.username;
			console.log(`${name} (${m.user.username}${m.user.bot ? ', bot' : ''})  ${m.user.id}  ${m.roles.map((id) => '@' + (roles[id] ?? id)).join(' ') || '-'}`);
		}
		if (page.length < 1000) break;
		after = page[page.length - 1].user.id;
	}
}

async function main(argv) {
	const [cmd, ...args] = argv;
	switch (cmd) {
		case 'guilds':
			for (const g of await api('GET', '/users/@me/guilds')) console.log(`${g.name}  ${g.id}`);
			break;
		case 'overview':
			console.log('=== Roles (top = highest) ===');
			await printRoles();
			console.log('\n=== Channels ===');
			await printChannels(true);
			break;
		case 'roles': await printRoles(); break;
		case 'channels': await printChannels(false); break;
		case 'members': await printMembers(); break;
		case 'bits': console.log(bits(args.join(',').split(',').filter(Boolean))); break;
		case 'decode': console.log(decode(args[0]).join(', ') || '(none)'); break;
		case 'call': {
			const ri = args.indexOf('--reason');
			const reason = ri >= 0 ? args.splice(ri, 2)[1] : undefined;
			const [method, rawPath, json] = args;
			if (!method || !rawPath) throw new Error('usage: call <METHOD> <path> [json] [--reason "..."]');
			const path = rawPath.includes('{guild}') ? rawPath.replaceAll('{guild}', await guild()) : rawPath;
			const out = await api(method.toUpperCase(), path, json ? JSON.parse(json) : undefined, reason);
			console.log(out === null ? 'ok (no content)' : JSON.stringify(out, null, 2));
			break;
		}
		default:
			console.log('usage: node tools/discord.mjs guilds|overview|roles|channels|members|bits|decode|call  (see header)');
			process.exitCode = cmd ? 1 : 0;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
