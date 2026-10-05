# Chain Riders

Retro pseudo-3D combat motorcycle racer. Plain HTML5 canvas + JavaScript with no dependencies:
every sprite is drawn in code, and the whole game is `index.html` + `game.js` (~27 KB zipped).

## Develop

```
npm run dev      # http://localhost:8123
npm run build    # dist/chain-riders-itch.zip and dist/chain-riders-crazygames.zip
```

- `?debug` exposes `window.__brawl` (race state) in the console.
- `?covers` renders the store covers. On the dev server they are saved to `store-assets/`.

## Controls

| Keyboard | Touch | Action |
|---|---|---|
| ↑ / W | automatic | Gas |
| ↓ / S | BRAKE | Brake |
| ← → / A D | ◀ ▶ | Steer |
| SPACE (or X / K) | KICK | Kick (auto-aims; knocks rivals sideways into traffic) |
| Z / J | 👊 LEFT | Punch left |
| C / L | 👊 RIGHT | Punch right |
| P | ⏸ | Pause |
| M |  | Sound on/off |

## Features

- Start-of-race intro: the bike rolls onto the grid, and bouncing control cards light up with confetti as you try each key. New players go from the title straight into their first race (1 click), and the first two races show the controls longer (↑ / a tap skips ahead).
- Countdown with a perfect-start boost (press ↑ in the last 0.7 s)
- Rival AI paces itself to the player: riders far ahead ease off, riders behind catch up, and nearby riders match your speed so there is always a fight. Difficulty eases after crashes and tightens when you dominate.
- Kicks stun and slow rivals; punch combos pay cash; KO an armed rival to steal the weapon
- Traffic in both directions, rider and bike damage, garage upgrades, and a top 3 to advance
- Touch controls, a rotate-your-phone prompt, and pausing when the tab loses focus
- CrazyGames SDK v3 (CrazyGames build only): loading/gameplay events, a midgame ad between races with audio muted, and saves through the data module

## Platform notes

The `<!-- PLATFORM_SDK -->` placeholder in `index.html` is replaced by `tools/build.js`:
it is empty for itch.io and becomes the CrazyGames SDK script tag for CrazyGames. Off CrazyGames the
game uses localStorage for saves.
