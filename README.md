# 🏒 Table Hockey

A full hockey game that plays out as a floating rink: on your real table, in mid-air, in VR, or on a plain screen.
No 3D room, no table, no light fixture. Just the rink, the jumbotron and the players.

- **No build step.** Plain ES modules plus a vendored copy of three.js r160 (`lib/`).
- **Everything is procedural** (ice, boards, players, sounds). No asset files.

## Open it (needs the HTTPS link)

Camera and motion sensors only work on an `https://` page. Pages deploys automatically on every push once enabled (Settings → Pages → Source: GitHub Actions)
(GitHub → Actions → *TableHockey Pages* → Run workflow; first time only: Settings → Pages → Source: *GitHub Actions*).
Your link is then `https://<owner>.github.io/<repo>/`.

Locally: `cd TableHockey && python3 -m http.server 8000` → `http://localhost:8000` (on-screen mode only).

## Ways to view it

| Device | Mode | What you get |
|---|---|---|
| **iPhone / iPad (Safari)** | **Camera AR** | Live camera behind the rink, driven by the gyro. Turning the phone looks around the rink. |
| Android Chrome, Quest Browser | **Enter AR** | True surface tracking (WebXR hit-test): the rink snaps to your table and stays put as you walk around. |
| Quest | Enter VR | Rink floating in front of you in a dark void. |
| Anything | Watch on screen | Orbit the rink with a mouse/finger. |

**iPhone / iPad: walking around the rink.** Safari does not give web pages access to ARKit (what Pokémon Go uses), so the phone alone only knows which way it is *pointing*, not where you *stand*. To get real walk-around tracking in Safari the game tracks a **printed marker**:
1. Open **🖨 Print the marker** from the menu (or `marker.html`) and print it at 100% scale (10 cm default).
2. Lay it flat in the middle of your table.
3. Tap **Camera AR** and point the camera at the marker. The badge turns green (**🎯 marker locked**) and the rink is pinned to it. Walk anywhere; if the marker leaves the frame the rink holds its place using the gyro (turning only) until you show it to the camera again.
4. Set **⋯ More → Marker −/+** to the real size you printed (cm) if it isn't 10.

Without the marker it falls back to turning-only (Aim → **Lock in place**). True marker-less world tracking on iPhone needs a native ARKit app.

### Placing and sizing (all AR modes)
1. Aim the phone/headset where the rink should be: on the table, or in the air. It follows the centre of the view (in WebXR it sticks to real surfaces).
2. **📌 Lock in place** pins it. Tap again to unlock and re-aim.
3. **Size − / +** (or two-finger pinch in Camera AR), **Height ↓ / ↑** (move it up and down through the air), **Rotate**. These still work while locked.
4. Camera AR also has **Closer / Farther** under ⋯ More.

Quest controllers: left stick = size, right stick up/down = height, sticks left/right = rotate, A or trigger = lock, B = helmet cam.

## Helmet cam
Tap any player (or press **🪖 Helmet cam**) for a first-person view from that player's helmet: the head turns toward the puck, bobs as he skates, and drops to the ice if he's hit. **◀ ▶** switch player; **Puck carrier** follows whoever has the puck.
In WebXR AR/VR the first-person view plays on the jumbotron instead.

## The game
**Rules.** 3 periods → 5-minute sudden-death overtime → **shootout** (3 rounds each, then sudden death, live physics). Faceoffs on the right dots, icing, offside, minor penalties (tripping, hooking, boarding…) with **power plays**, 5-minute fighting majors, empty-net goalie pull, goalie freezes, pucks over the glass.

**Officials.** Two referees and two linesmen skate the ice. The nearest ref blows the whistle (arm up, whistle in mouth); linesmen signal offside (arm out) and icing (arms crossed); refs point at the net on goals. On a penalty the ref raises an arm and the **offender skates to the penalty box** under his own power before play resumes. Fighters do the same.

**Physics.** 3D puck with gravity, bounce, boards and glass, posts and crossbar. The net is real: the puck hits a slanted back and roof, drags in the netting, and the net **ripples** where it hit. Slap shots wind up and leave a plasma trail.

**Jumbotron.** A four-sided floating board with a live auto-directed camera, goal/fight replays in slow motion from several angles (broadcast, overhead, goal cam, ice-level, puck-chase), shootout tallies and power-play clocks. `Board ↑/↓` moves it, `Jumbotron off` hides it.

## Controls (on screen)
tap a player = helmet cam · `H` helmet · `N`/`B` next/prev player · `P` replay · `V` screen cam · `L` labels · `C` broadcast cam · `K` lock · `+`/`-` size · `[` `]` board height · `Space` pause · `1`/`2`/`3` speed · `S` sound · `R` new game

URL options: `?period=90` (real seconds per period) · `?seed=7` · `?preview=1` (skip menu) · `?mirror=1&shadows=1` (reflections/shadows in headset).

## Layout
```
src/sim.js        game engine (pure logic): rules, physics, AI, officials, shootout
src/rink.js       ice, boards, glass, rippling nets, penalty boxes
src/actors.js     skater / goalie / official rigs, puck, labels
src/jumbotron.js  floating video board, camera director, replay recorder + player, helmet-cam pose
src/fx.js         particles + puck trail
src/audio.js      synthesised sound
src/main.js       scene, placement, WebXR, camera AR, UI
test/sim-test.mjs      `node test/sim-test.mjs 8 150`  plays full games headless
test/track-test.mjs  renders synthetic marker views and checks the tracker's pose
test/shootout-test.mjs forces tied OT, runs the shootout and a penalty walk
```

## Status
The engine, rink, replays, helmet cam and on-screen mode were run and checked in a desktop browser.
**Camera AR, WebXR AR and VR have not been run on a real phone or headset** (there is no device in the build environment). Camera
field of view is assumed to be about 62°, so the rink's apparent scale may be slightly off on some phones: use Size to correct it.
