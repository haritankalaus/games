# Rocket Skyway

A SkyRoads-style space-lane racer against bot pilots. Plain HTML5 canvas + JavaScript with no dependencies:
every ship, tile and star is drawn in code, and the whole game is `index.html` + `game.js` (~30 KB zipped).

## Develop

```
npm run dev      # http://localhost:8124
npm run build    # dist/rocket-skyway-itch.zip and dist/rocket-skyway-crazygames.zip
```

- `?debug` exposes `window.__sprint`: `start(n)`, `endless()`, `autopilot()` (the AI drives you), `touch()`,
  `sim(sec)` and `audit()`, which races 5 bots through every level and reports how often each one crashed.
  Run `audit()` after editing track pieces.
- `?covers` renders the store covers. On the dev server they are saved to `store-assets/`.

## Controls

| Keyboard | Touch | Action |
|---|---|---|
| ↑ / W (hold) | automatic | Gas: let go to slow down |
| ← → / A D | ◀ ▶ (or left third of the screen) | Steer (works in the air too) |
| SPACE | JUMP (or right third) | Jump (low gravity, so jumps are floaty) |
| ↓ / S | BRAKE | Brake |
| P | ⏸ | Pause |
| M | | Sound on/off |

## How it works

- **Look**: a race in the sky: space sky with a galaxy and moons, mountain peaks and a sunlit sea of clouds far
  below (cloud puffs also stream past under the road). The road is a glossy steel deck with a glowing grid, side
  rails with running lights, red X hazard pads and striped steel barriers. Rockets use the SKYHAWK livery. The chase
  camera is centred behind the player; the field of view widens with speed (plus streaks and an edge vignette).
  With `?debug`, `window.__prof` collects render timings and `window.__off.{clouds,vig,plume,sky}` turns layers off.
- **TRAINING**: new players start with a short guided course (`buildTutorialTrack`): gas, steering/coins, a gap
  jump and a barrier jump (both with slow motion and a PRESS SPACE NOW! prompt), boost pads, red pads and fuel.
  It's replayable from HOW TO PLAY on the title screen (or T).
- **Feedback**: soft glow particles and streaking sparks, a fireball + smoke on crashes, a glowing exhaust plume; jump stretch + puff ring, landing squash + shockwave + camera dip, rising-pitch coin streaks with
  floating +1s, BIG AIR / MEGA AIR coin bonuses for long jumps, boost/fuel/crash screen glows, slow-motion crashes,
  finish fireworks, button hover/click sounds and screen fades. All sound and music is synthesized (Web Audio).

- **Track**: 7 lanes of tiles built from the pieces in `CHUNKS` (`game.js`). Each piece is a list of 7-character rows,
  the first row being the one you reach first: `.` gap, `=` floor, `o` coin, `B` boost, `S` sticky goo, `X` burning,
  `F` fuel, `J` jump pad, `#` raised block. Levels are seeded, so level 5 is always the same track.
- **Bots**: each level gets racing lines worked out backwards from the finish, one per jump length (speed), so a
  slowed-down bot still jumps right. A level is regenerated if bots can't get from the grid to the finish.
  One bot is your **buddy**: it matches your speed, keeps swapping the lead with you, cheers you on, slows
  down to wait after you crash, and only races for real in the last 12% of the track.
  The other bots make occasional early-jump mistakes (fewer on later levels), shove you when side by side, and pace themselves
  to you: far ahead they ease off, far behind they catch up, and near the end the pacing mostly switches off.
- **Respawn**: after a fall or crash you reappear at the nearest spot before where you died (where you left the
  ground, for falls) that has 5 clear rows ahead, ghosted for 1.6 s. Endless mode is one life.
- **Progress**: top 3 unlocks the next level; 1st/2nd/3rd = 3/2/1 stars; coins buy ships in the Hangar.
- **CrazyGames SDK v3** (CrazyGames build only): loading/gameplay events, happytime on wins and endless records,
  a midgame ad between races (from the 3rd race), a rewarded ad for +60 coins in the Hangar, saves through the data module.
