# fourcorners

The Four Corners Games studio site, served at https://fourcornersgames.ca
(GitHub Pages, see `CNAME`). Plain static HTML and one stylesheet, no build
step. Every page exists in English and French (Quebec's language rules), and
each links to its other-language twin.

## Layout

```
/                      studio home (games, about, contact)
/fr/                   French home
/cookies.html          website privacy and cookies (the site itself, not the games)
/fr/temoins.html       its French twin
/refunds.html          refund policy for purchases in all three games
/fr/remboursements.html  its French twin
/yarntoss/             YarnToss game page
/yarntoss/privacy.html, terms.html, delete-account.html
/fr/yarntoss/          French game page
/fr/yarntoss/confidentialite.html, conditions.html, supprimer-compte.html
/yarntoss/img/         game art (webp) for the game page and home card
/catcafe/              Whiskers Cafe game page (the game's repo is jaylapse/Bakery)
/catcafe/privacy.html, terms.html, delete-account.html
/fr/catcafe/           French game page
/fr/catcafe/confidentialite.html, conditions.html, supprimer-compte.html
/catcafe/img/          Whiskers Cafe art (webp), made from the game's own PNGs
/idleadventure/        Pocket Quest game page
/idleadventure/privacy.html, terms.html, delete-account.html
/fr/idleadventure/     French game page
/fr/idleadventure/confidentialite.html, conditions.html, supprimer-compte.html
/idleadventure/img/    Pocket Quest art (webp), made from the game's own original art
/assets/fonts/         self-hosted Lato (studio) and Baloo 2 (YarnToss), with their OFL licences
/brand/                logo files and the logo animation script
/404.html
/robots.txt            allows everything, points to the sitemap
/sitemap.xml           every public page with its other-language twin; made by tools/sitemap.py
/favicon.svg           the icon (follows light/dark), plus favicon.ico (16/32/48, for older
/apple-touch-icon.png  browsers) and the 180 px iPhone home-screen icon, both made from brand/
```

**After adding, removing or renaming a page, run `python3 tools/sitemap.py`**
and commit the new `sitemap.xml`. It skips `/dev/`, the 404 page and any page
marked `noindex` (the redirect stubs). New pages need a `<title>`, a
`<meta name="description">`, the three icon `<link>`s and the hreflang pair.

Fonts and images are all self-hosted, so visiting the site never contacts a
third party (the privacy policies rely on that).

## Studio-wide legal pages

`/cookies.html` (and `/fr/temoins.html`) says the site sets **no cookies**, has
no analytics, ads, pixels or embeds, and has no forms, which is why there is no
cookie banner. Keep it true: before adding analytics, a cookie, an embedded
video/map/widget, a third-party font or script, or a form, update that page
(both languages) and, where the law requires it (Quebec's Law 25, the EU/UK),
add a consent prompt that is off by default. `/refunds.html` (and
`/fr/remboursements.html`) summarizes the purchase rules in each game's terms;
change both if the terms change. Both are linked from every page's footer
(Policies column) and from each game page's Help & legal section.

The footer has four columns: the brand, Games (the three game pages),
Policies and Studio. Each game's own privacy policy, terms and deletion page
are linked from that game's page (top bar and Help & legal), not from the
footer.

Every footer names the registered partnership, Four Corners G.P. on English
pages and Quatre Coins S.E.N.C. on French ones (its declared English and
French names), and so does each game's privacy policy, terms and deletion
page. The "Who we are" sections and the home page give both names. The studio
name itself is Four Corners Games on English pages and Jeux Quatre Coins on
French ones (header, footer, titles and text); "le Four Corners", the place the
studio is named after, stays as is.

Colour contrast: text colours were checked against WCAG AA (4.5:1) in light
and dark (see the comment at the top of `style.css`); check new colours the
same way.

## Old URLs are redirect stubs - keep them

`/privacy.html`, `/terms.html`, `/delete-account.html` and
`/fr/confidentialite.html`, `/fr/conditions.html`, `/fr/supprimer-compte.html`
were the YarnToss legal pages before they moved under `/yarntoss/`. Shipped
game builds (`scripts/legal_links.gd` in YarnToss) and the Play Console
listing may still point at them, so they stay as small redirect pages
(meta refresh + JS that keeps any `#fragment`). Never delete them.

## Each game has its own legal pages

A privacy policy has to describe what that specific game collects, so each
game gets its own set under `/<game>/` (and `/fr/<game>/`), with its own
account-deletion page if it has accounts. To add a game:

1. Copy `yarntoss/` and `fr/yarntoss/` to the new game's folder.
2. Rewrite the privacy policy for what the new game actually does (data,
   services, ages, purchases, ads). Keep the shared parts (who we are, your
   rights, the CAI, security, contact).
3. Add a `.theme-<game>` block in `style.css` (colours and display font, plus
   the game-page tokens `--pop`, `--ink`, `--go`, `--go-shade`) and put it on
   each page's `<body>`.
4. Add the game to the Games section of both home pages and to the Games
   column of every page's footer, and add it to the refund policy and the website privacy page's list
   of games (both languages).

## Whiskers Cafe

Whiskers Cafe (named 2026-11-07; it was CatCafe, then briefly Whisker's Cafe) is the cat bakery game (`ca.fourcornersgames.catcafe`,
Firebase project `catcafe-97a16`). If the name changes, change the page text,
not the `/catcafe/` URLs: the Play Console and the game's Google sign-in screen
link to them. Its legal pages already describe rewarded ads (AdMob) and Google
Play purchases (Sprinkles, No Ads, Bakery Club), which the game adds in its M4
milestone; update them if what ships differs. There is no store listing art
yet: `catcafe/img/` is the app icon, characters and the village picture from
`assets/art/` in the game's repo, and `feature.webp` / `og.jpg` are made from
them. Swap in real screenshots and the feature graphic once they exist.

## Pocket Quest

Pocket Quest (named 2026-11-07; it was IdleAdventure) is the fantasy idle RPG (`ca.fourcornersgames.idleadventure`,
Firebase project `idleadventure-fcg`, repo `../IdleAdventure`). Its privacy
policy describes what the game does as of November 2026: anonymous Firebase
accounts, one cloud save per server with five older copies (Firestore, US),
random hero names, World / System chat and private messages with block and
report (Realtime Database, US), Google Play Games linking, and server time.
Purchases (Google Play) and rewarded ads (AdMob with Google's consent form)
are described as coming; update the pages when they ship, and when rankings,
Families or the Arena make more of a player visible to others. The
delete-account page describes Settings -> Account -> Delete Account; the game
must have that button before the page is used in Play Console's Data safety
form. There is no store art yet: `idleadventure/img/` holds the hero rigs,
creatures, a familiar and a hunting ground from the game's own original art
(never third-party sprites), and `feature.webp` / `og.jpg` are made from them.
Swap in the real feature graphic and screenshots once they exist.

## Game art

`yarntoss/img/` holds web copies of the YarnToss Play Store listing art
(`assets/store_listing/` in the YarnToss repo: feature graphic, screenshots,
icon) and a few character sprites, resized and converted to webp. Only
listing/marketing art belongs here - don't publish game builds or asset
dumps (see the web-build retirement note in YarnToss's `CLAUDE.md`).

## Discord notices

Two things post to the team Discord channel, through the same webhook
YarnToss uses:
- **Commits:** a repo webhook (Settings -> Webhooks) pointed at the Discord
  webhook URL with `/github` on the end, content type `application/json`.
  Posts every push, on any branch.
- **"Site updated"**: `.github/workflows/site-live-discord.yml`, on every push
  to `main`. It waits for GitHub Pages to finish building that commit, then
  posts that it's live (or that the build failed, or never finished within
  10 minutes). Needs the plain webhook URL (no `/github`) as the
  `DISCORD_WEBHOOK_URL` repo secret; without it the workflow does nothing.

## Dev panels: the gateway (`/dev/`)

`/dev/` is the way into every game's dev panel (James, 2026-11-06). **One
sign-in**: the email and password are tried on each game's own Firebase project
at once (each game has its own accounts), each game's own rules decide whether
that account is a dev there, and a card per game says **Open** or why not ("no
account with this email and password", "not a dev here yet: needs ..."). Each
game's session is kept in `sessionStorage` under the keys its panel already
reads (`ia-dev-*`, `yt-dev-*`, `bk-dev-*`), so a panel opens signed in. A panel
with no session sends you to `/dev/#<game>` and comes back after sign-in;
**Sign out** in any panel signs out of all of them; every panel has an
**All Games** link. For one sign-in to open every game, give your dev account
the **same email and password** in each game's Firebase project. To add a game:
a `GAMES` entry in `dev/gateway.js` (public API key, project, panel path,
sessionStorage keys, how it decides who is a dev). The gateway borrows the
Pocket Quest panel's stylesheet.

## Dev panel (`/dev/bakery/`, Whiskers Cafe)

Read-only for now: the players (each one's `players/{uid}` summary, newest
first, with a search), a player page (the summary, the cloud save's stars,
coins, device and version, the whole save as JSON, a backup download) and
`config/app`. Editing waits for the game to adopt dev edits (its CloudSave
keeps the phone's copy over a web edit, Bakery `docs/CLOUD_SAVE.md`). The
Bakery repo's rules give `isDev()` accounts (`devs/{uid}` with `enabled: true`)
read access to `players/`, `saves/`, `names/` and `devs/` (branch
`JL-dev-panel-rules`). Whiskers Cafe needs **Email/Password sign-in switched on**
(Authentication → Sign-in method) and a dev login with a `devs/{uid}` document.

## Dev panel (`/dev/yarntoss/`)

A hidden page for the YarnToss devs: both leaderboards, every player's full
cloud save (click a name) with editing, rename history, `config/*` docs, and
dev messages that pop up in every open game. Not linked from anywhere and
marked `noindex`, but the URL is not the protection: everything goes through
Firestore with the dev's own login, and the rules only allow it for accounts
whose `scores/{uid}` has `is_dev: true` (see YarnToss's `docs/firebase.md`,
"Web dev panel"). It's the one page that talks to a third party (Google's
Firebase APIs), and only once a dev signs in.

- Sign in with the **email and password** of a dev account (Play Games-only
  accounts can't sign in on the web; YarnToss's doc says how to add one).
- `dev/yarntoss/game-data.js` holds the names of achievements, catalogue
  entries, skins, cosmetics, Workshop upgrades and rooms, copied from the game.
  After changing any of those in YarnToss, regenerate it:
  `python tools/yarntoss_dev_data.py ../YarnToss`
- What the panel can edit (`EDITABLE` in `app.js`) must match what the game
  adopts after a dev edit (`CloudSave._adopt_field()` in YarnToss).

## Dev panel (`/dev/idleadventure/`)

A hidden page for the Pocket Quest devs: the servers, each server's players
(characters, chat names, names held, dev / ban flags), and a player page that
releases or changes a name, sets Dev / Banned, edits the cloud save (a few
quick fields or the raw JSON, with a backup download) and restores a cloud
history copy. Not linked from anywhere and marked `noindex`, but the URL is not
the protection: everything goes through Firestore and the Realtime Database with
the dev's own login, and the game's rules only allow it for accounts with
`admins/{uid}` in both (the Pocket Quest repo's `firebase/` rules and
`docs/multiplayer.md`, "Dev panel", which also has the one-time setup). Like
the YarnToss panel, it only talks to Google's Firebase APIs once a dev signs in.

- Sign in with the **email and password** of an admin account (guest and Play
  Games accounts can't sign in on the web).
- A save edit raises `save_counter` by 1000 so the player's game takes it at
  its next launch; edit while that player's game is closed, or the running game
  overwrites it. Change `COUNTER_BUMP` / `encodeSave()` in `app.js` together
  with the game's `OnlineRules` if the save document's shape changes.
