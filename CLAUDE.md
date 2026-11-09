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
| Studio website + shared tooling | `fourcorners` | - |

All repos are on github.com/jaylapse. Google Play Console tooling for all three
apps is `node tools/play.mjs` in the `fourcorners` repo; each person keeps the
service account key outside the repos (`PLAY_SA_KEY`), and it is never
committed. When a studio-wide fact here changes (a new or renamed game, repo or
package), update this section in all four repos.

