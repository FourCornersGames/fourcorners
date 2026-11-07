# Four Corners Games website

The studio website and the tooling shared by all our games (`tools/`).
This file exists so every session (Jay's or Will's) has the same context.

## Four Corners Games

Four Corners Games (Jay and Will) has these projects:

| Project | Repo | Package |
|---|---|---|
| YarnToss | `YarnToss` | `ca.fourcornersgames.yarntoss` |
| Whisker's Cafe | `Bakery` | `ca.fourcornersgames.catcafe` |
| Pocket Quest | `IdleAdventure` | `ca.fourcornersgames.idleadventure` |
| Studio website + shared tooling | `fourcorners` | - |

All repos are on github.com/jaylapse. Google Play Console tooling for all three
apps is `node tools/play.mjs` in the `fourcorners` repo; each person keeps the
service account key outside the repos (`PLAY_SA_KEY`), and it is never
committed. When a studio-wide fact here changes (a new or renamed game, repo or
package), update this section in all four repos.

