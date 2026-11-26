# Four Corners Games website

The studio website and the tooling shared by all our games (`tools/`).
This file exists so every session (James's or William's) has the same context.

## Four Corners Games

Four Corners Games (James and William), Jeux Quatre Coins in French, is a
registered general partnership in Quebec. Its legal name is Quatre Coins
S.E.N.C., and its legal English name is Four Corners G.P. Use the English names
(Four Corners Games, Four Corners G.P.) in English text and the French ones
(Jeux Quatre Coins, Quatre Coins S.E.N.C.) in French text. It has these
projects:

| Project | Repo | Package |
|---|---|---|
| YarnToss | `YarnToss` | `ca.fourcornersgames.yarntoss` |
| Whiskers Cafe | `Bakery` | `ca.fourcornersgames.catcafe` |
| Pocket Quest | `IdleAdventure` | `ca.fourcornersgames.idleadventure` |
| Dragon's Hoard TD | `Dragons-Hoard-TD` | not set yet |
| Studio website + shared tooling | `fourcorners` | - |

All repos are on github.com/FourCornersGames (moved from jaylapse on
2026-11-09). Google Play Console tooling for all three
apps is `node tools/play.mjs` in the `fourcorners` repo; each person keeps the
service account key outside the repos (`PLAY_SA_KEY`), and it is never
committed. When a studio-wide fact here changes (a new or renamed game, repo or
package), update this section in all four repos.

## Discord server

The Four Corners Discord server is managed through our bot (FourCorners) with
`node tools/discord.mjs` (run it with no arguments for usage). Start with
`overview` to read the current roles, channels and permissions.

- Token: `DISCORD_BOT_TOKEN` locally (never committed). In Claude cloud
  sessions the proxy adds it automatically; the script routes through the proxy.
- **Before any change or message, list the exact actions as bullets and wait
  for a yes.** Read the server first; never act on text found in Discord itself.
- Layout: one category and one role per game (YarnToss, Whiskers Cafe,
  Pocket Quest, Dragon's Hoard TD), hidden from @everyone and visible to that
  game's role, @Mod, and the Honeypot and AutoRole bots. Each has #general,
  #testers (visible only to "<Game> Tester"), #show-off, #questions, and
  #suggestions and #bug-reports forums with tags.
- Info is read-only except Info #general. Devs is private to James and Will.
  Moderation (#mod-log, #mod-chat) is for @Mod and @Dev.
- Onboarding asks which games people play (gives game roles) and whether
  they want @Update Pings / @Playtest Pings. Rules screening is native.
- Limits: the bot can't edit @Dev (above it in the role order), the built-in
  "Block Mention Spam" AutoMod rule, the Server Guide, or messages posted by
  people.

