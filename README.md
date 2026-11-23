# Apex Pursuit

Open-world arcade street racer, built in stages from the Phantom X1 concept sketch. **This is
Phase 4F, smarter police:** squads that box you in, roadblocks with a gap to aim for, a pursuit
bounty, and a search you can hide from; plus searchlight shadows and floodlights that light the
cars. Before that, **Phase 4E, Air One:** a live police helicopter that chases you from Heat 3 with a real
searchlight, rotor wash and sound, and drops smoke, spike strips and shock charges; plus gravel
traps that drive like gravel and floodlights that light the track. Before that, **Phase 4D / 4D.1:**
background detail round the circuit, venues, and built-in music. Before that, **Phase 4C, the big visual upgrade:** GPU-painted road, kerb, grass, concrete and rock materials, real hills and mountain ranges around the circuit, three kinds of swaying trees, hillside forests, grass along the track edges, cooler aerial haze, a Natural (AgX) tone-mapping option, SMAA on Medium and a slight lens fringe. Before that, **Phase 4B.2:** rain that changes from showers to downpours, realistic lens drops, and a smoother frame rate (F3 timing breakdown, F4 benchmark, far fewer draw calls, dynamic resolution). Before that, **Phase 4B:** realistic police cars (patrol sedan, unmarked car, heavy pickup, light patterns, sirens, damage) and realistic rain (lit streaks, spray, no lens bubbles). Before that, **Phase 4A:** HUD layout fixes, rain on the lens redone, and a full camera set with a modelled cockpit (wheel, hands, live dash, mirrors, wipers). Before that, Phase 3B added the in-race HUD from the reference image: an analog rev dial with boost and nitrous
gauges, a tilted minimap that turns with the car, an event panel with a live leaderboard, gaps to
the cars around you, start lights with a random hold and jump starts, and named events. Earlier
phases added the menus and garage (3A), handling, weather and police (3C) and the graphics (3D). Racing seven AI rivals, online play with up to 4 friends, keyboard and
DualShock 4 with rumble all carry over.

Browser game: TypeScript + Three.js (WebGL 2). All textures, trees and sounds are generated at start-up;
the only image files are the four key-art pictures in `art/`.

## How to play (for friends: no install needed)

1. On this page click **Code → Download ZIP**, then unzip it anywhere (right-click → Extract All).
2. Open the `play` folder and double-click **`ApexPursuit.html`**. It opens in your browser
   (Chrome or Edge work best). That's it: you're racing. Everything is inside that one file,
   so it even works offline.

**Race online with friends, each at your own home:**
1. **One person hosts.** Install [Node.js](https://nodejs.org) (the LTS version), then in the game
   folder double-click **`Host online race.bat`** (Mac / Linux: `./host-online.sh`) and choose
   **1 Internet**. The first time it sets itself up and asks to download Cloudflare's free
   `cloudflared` tool (about 40 MB, once). It then shows a link like
   `https://some-random-words.trycloudflare.com/?room=friends`, copies it for you, and opens the
   race. Keep that window open while you play.
2. **Send the link** to your friends (WhatsApp, Discord…).
3. **Friends** either open the link in Chrome or Edge, or open their own `play/ApexPursuit.html`
   and go to **Online with friends → Join a friend** and paste it. Nothing to install.
   **Want your own music in online races?** Use your own `play/ApexPursuit.html` and paste the
   link. Music you add (Music → Add music) is kept per page address, and the host's link is new
   every time, so music added on the link page would be gone next time. The host can do the same:
   close the page the host window opened and paste the link into their own copy.
4. Everyone lands in the **lobby**: names, ping and who's ready. Press **Enter / ✕** when ready.
   The host sets the race in **Esc → Online: race / weather / time of day / laps** (e.g. Pursuit,
   rain, dusk, 3 laps) and presses **Enter / ✕** to start; it also starts by itself 3 seconds after
   everyone is ready.

Up to 4 friends race together; AI rivals fill the rest of the grid of 8 (and the police chase
everyone in a Pursuit race). Someone who joins mid-race waits for the next start. Someone who
drops out mid-race is replaced by an AI driver in their car. The link changes each time the host
starts hosting. Optional room password: everyone types the same one in the Online panel.

On the same Wi-Fi you can choose **2 Same Wi-Fi** instead: friends open the `http://192.168…`
address it shows. Other ways for friends at home (if `cloudflared` is blocked): Tailscale or
ZeroTier (a private network between your PCs), forwarding port 8080 on the host's router, or
running `server/relay.mjs` on a free Node host (Render, Fly.io) so nobody has to host.

**Controls:** W A S D or the arrow keys, Space handbrake, Shift nitrous, C camera, Esc pause.
A DualShock 4 or Xbox controller works too (full table below).

**If it's slow:**
- Laptops with two graphics chips often run browsers on the weaker built-in one. Windows
  Settings → System → Display → Graphics → add your browser (`chrome.exe` or `msedge.exe`) →
  **High performance**, then fully close and reopen the browser. In Chrome you can also turn on
  `chrome://flags` → **Force high performance GPU**. On ASUS laptops, check Armoury Crate's
  GPU Mode isn't **Eco**.
- Pause → Settings → **Graphics**: **High** is the best balance on a gaming laptop. On **Ultra**, leave **Ambient occlusion** off unless you have frame rate to spare (it draws the whole scene twice). Medium or Low for built-in graphics chips. **Graphics chip** in the same menu shows
  which chip the game is drawing on.
- Press **F3** for the frame-rate overlay, **F4** for a 30-second benchmark.

---

## Run it

```bash
npm install
npm run dev          # dev server with rebuild-on-save → http://localhost:5173
npm run build        # dist/index.html: one self-contained file, works offline (just open it)
npm run build:play   # same, and copies it to play/ApexPursuit.html (the file friends double-click: commit it)
npm run build:cdn    # dist/cdn/index.html: small file, loads Three.js from jsDelivr
npm run typecheck
npm run test:physics # headless checks: handling, jumps, walls, car contact, and a full 8-car, 3-lap race
```

Needs Node 18 or newer.

## Controls

| Action | Keyboard | DualShock 4 | Xbox pad |
| --- | --- | --- | --- |
| Accelerate | W / ↑ | R2 | RT |
| Brake / reverse | S / ↓ | L2 | LT |
| Steer | A D / ← → | Left stick | Left stick |
| Handbrake | Space | ✕ | A |
| Nitrous | Shift (or N) | □ | X |
| Change camera (chase near / far, hood, bumper, cockpit, cinematic) | C | △ | Y |
| Look back / horn | B / H | ○ | B |
| Look left / right | Z / X | Right stick ◂ ▸ | Right stick ◂ ▸ |
| Look around (springs back) | Right-button drag | Right stick | Right stick |
| Shift up / down (manual gearbox) | E / Q | R1 / L1 | RB / LB |
| Change paint | V | D-pad ◂ ▸ | D-pad ◂ ▸ |
| Rejoin the circuit | R | Share | View |
| Pause / settings | Esc (or P) | Options | Menu |
| Fullscreen | F | Pause menu | Pause menu |
| Performance overlay | ` (backquote) | Pause → Settings | Pause → Settings |

On-screen prompts switch between keyboard, PlayStation and Xbox glyphs based on the device you
last touched. Menus work with D-pad or stick, ✕ to select, ○ to go back.

## Controller compatibility

- The pad appears to the page only after you press a button on it (a browser privacy rule).
- **Rumble** uses `gamepad.vibrationActuator.playEffect('dual-rumble')`. It works for a DualShock 4
  over USB or Bluetooth in Chrome and Edge. Firefox and Safari support is partial; where the
  browser exposes no actuator the game simply runs without rumble.
- What you feel: heavy motor = engine load, collisions, landings, gear changes; light motor =
  tyre slip, grass and kerbs, nitrous, high-speed buzz. Pause → Settings has an on/off switch,
  a strength slider and a test button. Xbox pads also get trigger rumble.
- Browsers that do not remap the DualShock 4 (`mapping` is empty) fall back to a raw DS4 layout.
- The light bar and touchpad are not reachable through the Gamepad API; they are planned for the
  polish stage through WebHID, as an optional extra.
- If the game is embedded in another page and the pad is ignored, open it in its own tab: some
  hosts block Gamepad access inside frames.
- A native PS4/PS5 release is a different project (a Unity or Unreal port). This build is for a
  DualShock 4 on PC, Mac, Steam Deck or any browser with the Gamepad API.

## New in Phase 4G.3: thunder that matches the lightning

The lightning itself is unchanged. The thunder is rebuilt around it:
- **On time.** It starts with the flash: a sharp crack on every flash of the bolt (a strike
  flickers two to four times), the deep boom a breath after the first, then the rumble. It used
  to come 1.5 to 6 s late, so it never matched what you saw.
- **One thunder per strike.** It used to be several separate swells, which sounded like a new
  thunder every second or two. Now it's one boom settling into one long rolling rumble that
  fades out in 5 to 7 seconds, with a new one only when lightning strikes again.
- **Real bass.** Made from proper sound samples (three rumbles, three cracks, built once when
  it starts to rain): a falling 65→36 Hz thump you feel, brown-noise rumble with a bass lift,
  and enough 100–400 Hz to come through laptop speakers too. Close strikes crack hard; far
  ones are quieter and duller.
- **The controller shakes with it.** A hard kick on every flash, then both motors follow the
  thunder's own loudness, boom and rumble, at the same moments as the sound. The strength
  goes with how close the strike is (and your Vibration strength setting).
- **Not in the menus.** Thunder and its rumble only play during a race; the lightning still
  shows behind the menus.

## New in Phase 4G.2: friends hear the host's music, thunder you can hear, sharper edges

**Online: everyone hears the host's music.** When you host, the track you're playing is shared
with your friends (just its name and where it is: about 40 bytes per update, no audio is sent).
A friend who has the same song in their music plays it in time with you, from their own copy
(matched by title and artist, so their file can have a different name). A friend who doesn't
have it hears no music and sees what you're playing ("not in your music"), so they can add it.
While you host, their skip and play buttons wait (the host picks the music). Settings → Online
music: *Everyone hears the host's* (default) or *Everyone plays their own*. If the host has no
music, or picks *Everyone plays their own*, each friend plays their own as before. Tested with
three players (`tools/musictest.py`): a friend with the song stays within 0.1 s of the host.

**Thunder you can hear.** It was there, but nearly all of it was deep rumble below 150 Hz,
which laptop speakers, phones and most headphones can't play, under the engine and the rain.
Now it's a tearing crack when the strike is close, then rolling booms in the 100–700 Hz range
that come back two or three times, with the deep rumble underneath, about 9 dB louder. Far
strikes sound duller (the air soaks up the high notes), and strikes are a little closer, so
the thunder comes 1.5 to 6 seconds after the flash.

**A cheaper sky.** The sky is now drawn after the scenery, so its shader only runs where the
sky actually shows (in a normal race view, hills, stands and cars cover much of the screen),
and its broad shapes use cheaper noise. About two-thirds less work for the same look.

**Smoother edges: TAA.** Settings → Edge smoothing → TAA (Medium and up). The camera shifts by a
fraction of a pixel every frame, and each pixel blends with where it was last frame (found from
the depth and the camera, with cars moved by their own motion); last frame's colour is held
inside this frame's local colour range so moving things don't leave trails. It smooths what
MSAA can't: the wire in the catch fences, thin lines, shimmering highlights. The default stays
MSAA (Medium: SMAA), which is a little sharper.

**Car paint and glass.**
- The clear coat now has a gentle *orange peel* ripple, like real paint, so reflections aren't
  a perfect mirror.
- *Pearl* paint shifts colour with the angle (iridescence).
- Glass is smoked green-blue with a true glass reflection.
- **In the rain, water beads on the paint and glass**: little domes that bend the reflections,
  coming and going with how wet the track is.

**The trackside, close up.**
- **Concrete barriers** are 16 m of hand-worn panels: black tyre rubber where cars have
  scraped along, chipped paint, rain streaks from the top, grime at the foot, dark joints.
- **Tyre walls** are real tyres, hollow in the middle with a grooved face, stacked a little
  unevenly.
- **Braking boards** (150, 100, 50) on the run up to every corner after a straight.

Pictures in `docs/4g2/`.

## New in Phase 4G: the sky

One new sky for every weather and time of day, drawn by a single shader (`src/world/SkyDome.ts`).

- **Sunsets.** At dusk the sun sits low and big over the hills, the sky runs from deep blue
  overhead to orange at the horizon, and the clouds are lit gold on the sun side and purple
  underneath. Cars, paint and wet roads pick it up through the reflections.
- **Clouds that move.** They drift on the wind and are lit by the sun or the moon, with bright
  edges facing it. A clear night has a few; a cloudy night has big banks with gaps where the
  stars and moon show through; rain is one heavy deck.
- **Night sky.** A dense star field (several layers, twinkling, warmer and cooler stars) with the
  Milky Way band and its dust lanes, fading towards the horizon. A crescent moon with a halo.
- **Shooting stars** on clear nights, every few seconds, and now and then a shower of several
  streaking together. Settings → Shooting stars.
- **Lightning in the rain.** Forked bolts far off over the hills, the clouds round them lighting
  up, the whole circuit flashing for a moment, and the thunder arriving later the further away
  it struck (sound covers about 340 m a second): a crack when it's close, then a rolling rumble.
  It comes more often the harder it rains. **Settings → Lightning: On, Soft (gentler flashes)
  or Off**, for anyone who'd rather not have flashing.
- **Crows.** The birds are now black crows that row and glide, and at dusk a long loose line of
  them flies home across the setting sun.
- **Lens dirt.** Smudges and specks on the lens light up round bright lights: the sun, the
  floodlights, lightning, the searchlight. Settings → Lens fringe and dirt.

Online, each player sees their own shooting stars and lightning (they are scenery, not shared).
Pictures in `docs/4g/`: `sunset-chase.jpg`, `sunset-crows.jpg`, `sunset-sky.jpg`, `milky-way.jpg`,
`meteor-shower.jpg`, `cloudy-night-moon.jpg`, `lightning.jpg`.

## New in Phase 4F.1: realism pass on the 4F leftovers

**Real searchlight shadows (High and Ultra).** Cars, police and roadblocks in Air One's light now
cast real shadows in the shape of the car, and the cars shade themselves too. It costs about
0.3 ms a frame: the shadow is drawn with only what's near the beam, never the whole map. Medium
keeps the painted shadow.

**No more white haze on Medium.** The haze was the painted floodlight pool brightening your own
headlights about six times over, which the bloom then spread across the screen. The pool now
draws before the car light cards and is gentler, and Medium gets one real floodlight too (the
tower nearest you), so cars under it are lit on Medium as well.

**Air One looks right online.** A guest used to see the helicopter jump to each new update
(20 a second, a few metres at a time). It now glides between them. In a real two-player test
race the guest saw it within 3.5 m of where the host had it, 95% of the time, and moving as
smoothly as on the host's screen (`tools/airtest.py`).

**Air One sticks with one car.** With two players it used to swap between them every few
seconds, flying 100–200 m back and forth. It now stays on its car, and only moves to the other
one after the ground units have been on them for about 20 s (sooner if it has lost sight of its
own).

**Air One at night.** Its lights now show from far off, the way an aircraft's do: the red
beacon, the white strobe, red and green nav lights, and the red and blue flashers. Look up the
beam and the searchlight flares, blinding head-on.

**The "AIR ONE" tag** no longer sits on top of the race board or other HUD panels.

Pictures in `docs/4f1/`: `searchlight-real-shadow.jpg`, `floodlight-medium-fixed.jpg`,
`searchlight-glare.jpg`, `air-one-lights.jpg`, `online-guest-view.jpg`.

## New in Phase 4F: smarter police

**They work as a squad.** From Heat 2, the units round you take jobs: one gets out in front and
slows you down (a rolling block), one or two come alongside to box you in (and now and then try
a PIT), and a heavy pickup rams from behind. Dispatch calls the formation ("Unit four, get out in
front and slow them down. Six and seven, box them in."). Break out of a box at speed for a bounty.

**Roadblocks have a gap to aim for.** Two cruisers park either side of it; the minimap shows it as
a green dot and the warning tells you which side it's on ("the gap is on the left"). From Heat 4
the wider side is sawhorses instead of concrete: a second way through if you don't mind smashing
it (it slows you and raises the Heat). At Heat 5 the gap is tighter.

**Pursuit bounty.** Shown in the pursuit box and on the results, banked as Speed Points as you go:
- time in the chase (12 × Heat per second while they're on you)
- through a roadblock's gap without touching it: 800 × (Heat − 2)
- past a spike strip without a flat: 300 · a shock charge that missed you: 400
- broke out of a box: 500 · broke Air One's line of sight: 250
- evades and pursuit breakers, as before
A bust costs a quarter of the bounty you'd built up (on top of the fine).

**The search, and places to hide.** When nobody can see you, a red search circle grows on the
minimap round where they last saw you, the units slow to a search pace, and the hiding spots
light up in green: **the pit garages, the car park, and behind each grandstand**. Evade fills 60%
faster outside the circle and twice as fast in a hiding spot (both: 2.6×).

**From 4E's "not done" list:**
- **Searchlight shadows:** cars in Air One's light throw a soft shadow away from the helicopter.
- **Floodlights light the cars:** on High (1) and Ultra (2) the towers nearest you are real lights,
  so cars passing under them are lit, not just the road.
- **Smoke at night:** your headlights and the searchlight now light the smoke screens and tyre
  smoke, so they read as smoke instead of dark fog.
- **Floodlight pools fixed:** the painted pool under each tower now brightens what's beneath it
  instead of adding flat white, so the road stays tarmac and the grass stays green. A tower that
  has a real light on it drops its painted pool, so it isn't lit twice.
- **Searchlight on a low pass:** when Air One drops low, its light is held to its normal
  brightness, so the car under it isn't burned white.
- A picture of the gravel traps: `docs/4f/gravel.jpg`.

Pictures in `docs/4f/`: `gravel.jpg`, `searchlight-shadow.jpg`, `floodlight-high.jpg`,
`floodlight-medium.jpg`, `search-hud.jpg`.

## New in Phase 4E: Air One, a live police helicopter

**When it comes.** Settings → **Air support**: *From Heat 3* (new default), *From Heat 5* or
*Off*. It flies in from the horizon ("Air One on scene"), and a 2-second shot from the
helicopter shows it arriving (Settings → **Air One arrival shot** turns that off). After 80–105
s it runs low on fuel and leaves to refuel; it comes back later at a higher Heat. An evade sends
it away too.

**How it flies the chase.** It trails beside you, sits ahead of you facing you on the
straights, swings wide round the outside of corners, and now and then drops for a low pass
head-on over the cars. It noses down to speed up, banks into turns, flares to slow and wobbles
in the wind and rain. A height map keeps it clear of the stands, floodlight towers and trees.

**The new helicopter.** An original design (invented "AIR ONE · 07 / PROVING GROUNDS PATROL"
livery and crest, no real department or registration): black over white with a red pinstripe,
framed windows, sliding-door outline, engine fairing with twin exhausts, antennas, camera ball,
step bars on the skids, red/blue flashers, strobe, beacon, navigation and landing lights, and
rotors that blur into a lit disc without flicker.

**The searchlight** is a real moving light (Medium and up): it lights the road, the cars, the
barriers and the trees where it points, with a soft-edged beam you can see in rain, fog and at
night. On Low a soft pool on the ground stands in for the light.

**Hide from it.** It sees you within ~140 m (less in heavy rain) unless something is between
the helicopter and your car: a grandstand, the garages, a building, trees. The pursuit box
shows **Air One · Spotted** or **Hidden from it**, and a tag floats over the helicopter. While it
sees you, the Evade meter can't fill.

**What it drops** (Settings → **Air One drops** can turn them off and keep just the light).
Every drop shows a warning on the road (and the minimap) while it falls:
- **Smoke canisters** (from Heat 3): a grey or red cloud that pours over the road for ~10 s and
  hides the corner. Driving through rocks the camera and leaves smoke trailing off your car.
- **Spike strips** (from Heat 4): a red bar marks your lane. Hit it and you have a flat until the
  end of the lap (at least 6 s): less grip, less power, a lower top speed and sparks off the rim.
- **Shock charges** (from Heat 4, in twos and threes at Heat 5): a blinking red ring, then a bang,
  a flash, sparks and dust; a car inside the ring is shoved sideways, spun and slowed. The pilot
  never drops near police cars.
AI rivals ease off for smoke and steer round the markers.

**Rotor wash.** When it's low, rain blows outwards under it, spray and dust kick up off the road,
grass flattens and trees bend away, and smoke is pushed aside.

**Sound.** A deep blade thump you hear before you see it, a turbine whine up close, Doppler as
it passes, panned left and right; radio lines from the pilot.

**Online.** The host flies it (the host's Air support settings apply) and decides the drops;
everyone sees the same helicopter, smoke, spikes and bangs in the same places, and each player's
own car takes its own hits.

**Photo mode:** **V** (pad: Square) jumps to the **Air One view**, looking down from the helicopter.

**Proving Grounds fixes from 4D:**
- **Gravel traps drive like gravel:** less grip than grass and much more drag, the car twitches
  and bounces, stones spray and rattle off the floor, a dust trail, more rumble.
- **Floodlights light the track:** a broad pool of cool light under each tower at dusk and night.
- **Pause menu:** Back / Esc in the race pause menu went to the home screen after Settings had
  been opened from home. It now goes back to the race.

Pictures: `docs/4e/` (dusk chase, overhead, close-up, night rain searchlight, drop markers, a
floodlight pool).

**Not done in 4E** (both done in 4F): searchlight shadows, and floodlights lighting the cars.

## New in Phase 4D: background detail around the circuit, and venues

**The Proving Grounds, dressed** (`src/world/dressing/provingGrounds.ts`; placement data in
`src/world/venues.ts`). Pictures: `docs/4d/`.
- **Three grandstands** (start straight, right-hand hairpin, far corner) with stepped seating,
  roofs on columns, light strips under the roof edge, and a **crowd of about 2,700** drawn
  people (shirts, skin and hair vary per person). They **jump up and wave when cars pass**.
- **Pit garages lit from inside** (six invented teams), a door header, the control tower.
- **Marshal posts** at the six sharpest corners, with yellow flags.
- **Catch fences** behind the barriers and on the pit wall, **tyre walls** at the six sharpest
  apexes, **gravel traps** through the corners, **banners** on fences, stands and the pit wall
  (eight invented brands).
- **Flags in the wind** (start line, pit roof, grandstands, marshal posts); the wind picks up in rain.
- **Six floodlight towers** that light up at dusk and night.
- **A car park** behind the paddock with about 125 parked cars (you can bump into them).
- **Power lines** on lattice pylons across the hills behind the pits.
- **A town in the lowest valley**: thousands of window lights and a glow over it at night.
- **A highway** on the hills with moving traffic: headlights and tail lights at night.
- **Birds** circling over the circuit by day (not at night or in rain).

Cost: about +45 draw calls on High at the start grid (499 → 542 at dusk, 734 → 794 in night
rain). The small moving things (crowd, flags, birds, traffic, lights, wires, parked cars) are
drawn by the main camera only, not in the wet-road reflection or the mirrors. Low quality
thins the crowd and the town and drops the birds.

Not physical: the gravel traps look like gravel but behave like the grass under them (cars slow
down there anyway). The floodlights glow but don't cast extra light (that would cost too much).

**Venues.** A venue is now a definition (`VenueDef` in `src/world/venues.ts`): the circuit's
control points, its paved areas, and a facility builder (barriers, buildings, ramps, poles,
trees, pursuit features, 4D dressing data), plus a dressing builder registered in
`src/world/dressing/index.ts`. `WorldData` takes a venue; race logic doesn't know which one.
The event card has a **Venue** row: *Proving Grounds*, and *Hanagiri Pass*, shown as coming
in Phase 5. Choosing another venue reloads the game into it (`?venue=` in the address works too).
Online: everyone reports the venue they have loaded; only players on the host's venue go on the
grid, the rest wait and are told which venue to choose. (A venue is loaded before you can join,
so there is no loading race to wait for at the lights.)

## New in Phase 4D.1: your own music, built in

Spotify is gone. The game now plays **its own music files**, so nothing streams, nothing lags,
and nothing covers the menus.

**Where the music comes from**
- **A music pack next to the game**: a `music/` folder beside `ApexPursuit.html` (or beside
  `dist/index.html`). It holds `tracks.js` (the list), the audio files and the covers. Make one
  from any folder of MP3s:
  ```
  pip install mutagen
  python tools/music-pack.py "C:\Music\My racing mix"      (writes play/music/)
  ```
  The title, artist, album and cover art come from the files' own tags.
- **Music → Add music** (or **Add a folder**, or drop files on the window): any MP3, M4A, OGG,
  WAV or FLAC. These are kept in your browser, so it's a one-time step per browser.
  **Remove added** clears them again.

**Music packs are personal and never go into this repository** (`play/music/` is in
`.gitignore`). Songs belong to their artists and labels, and a public repository would hand them
out to everyone. The public game starts with no music; each friend adds their own.

**On the home screen** a small **Now playing** line sits in the bottom row, between the car and
the key hints (it fades after a few seconds and lights up again on each new track). Click it,
press **Tab**, or **△ / Y** on a controller to open the music page. In a race, a new track shows
as a short note at the top.

**The music page** (Home → Music, or Settings → Music menu), laid out like a football game's
soundtrack screen:
- left: every track with its cover and a tick (in the rotation or not); right: the selected
  track, big, with its buttons; bottom: what's playing now, with a progress bar.
- **✕ / Enter**: play the selected track now. When it ends, the shuffled rotation carries on.
- **R1 / X**: tick or untick it. **□ / T**: all on, or all off. **△ / Y**: play or stop.
- **L3 + R3 / M**: skip (works everywhere, in races too). **○ / Esc / Tab**: back.
- **Music volume** (its own, separate from the game sound) and **In races** on/off.

**Settings → Sound**: Music (play/stop), Music menu, Skip track, Music volume, Music in races,
plus the Engine, Effects and Sirens volumes from 4C.2.

## New in Phase 4C.2: online races with friends at home

(4C.2 also brought a Spotify playlist; Phase 4D.1 replaced it with the built-in music above.)

**Online with friends at home**: see "How to play" at the top and "Racing online with friends".

## New in Phase 4C: the big visual upgrade

**Where the assets come from.** The plan was to download CC0 textures and models from Poly Haven
and ambientCG. Those sites can't be reached from the machine this was built on, so every asset is
**generated in code** instead, at start-up, with nothing to download:
- `src/world/MaterialBaker.ts` paints each surface on the GPU with a shader into a texture
  (albedo + normal map), reads it back once and frees the render target. All patterns use
  periodic noise, so they tile without seams. A bake takes a few milliseconds.
- `src/world/Vegetation.ts` builds the trees from primitives (jittered cones, icospheres,
  stretched spheres) and renders them once from the side to make the forest impostors.
- The grass blades are drawn on a canvas.

If you want real scanned textures later, the swap is small: load the images and put them where
`bakeMaterials()` returns its maps (same `map` / `normal` pairs).

**Materials** (albedo + normal map each):
- **Asphalt** (2048² when the GPU allows, otherwise 1024²): fine aggregate with lighter stones,
  darker repair patches with sealed edges, thin hairline cracks, rubber laid down in the middle
  of the road, oil drips, and worn, chipped white edge lines.
- **Kerbs:** red and white 1 m blocks, chipped paint, dark joints, a ribbed top.
- **Grass:** light and dark clumps, dry patches, bare earth with small stones.
- **Concrete aprons:** cast slabs with joints, trowel marks, oil stains, tyre marks.
- **Rock** for the hills (sampled triplanar, so steep faces don't stretch).
- **Macro variation:** every ground material is lightened and darkened over 25–90 m in world
  space, so repeating tiles don't show from a distance.

**Terrain** (`src/world/Terrain.ts`): a height-field ring from just outside the fence (700 m
from the centre) to 2.9 km.
- Gentle grassy foothills first, then ridged ranges up to about 500 m, with some valleys left low.
- The shader blends grass, dirt and rock by slope and height; higher grass gets darker and greener.
- Aerial perspective: the hills take half the fog of the flat world, the fog thins with
  altitude, and far away it turns a cool blue-grey instead of the warm ground haze, so ranges
  fade in layers instead of vanishing. The old distant ridgelines stay behind as the farthest layer.
- One mesh, one draw call. The car can't reach the hills (the fence is still the edge of the world).

**Trees, forests and grass** (`src/world/Vegetation.ts`):
- **Three species:** pine (five jagged tiers), broadleaf (a cluster of lumpy crowns on a forked
  trunk) and cypress (tall and narrow). Each has soft crown normals (it shades like a crown,
  not like facets), ambient occlusion baked into the colours, random lean, turn, proportions
  and tint. They sit on the terrain height.
- **Wind:** trunks bend more towards the top, leaves flutter, every tree has its own phase. In
  rain the wind picks up.
- **Hillside forests:** up to 14,000 impostor cards in clumps and clearings on the foothills,
  using pictures rendered from the same 3D trees, so near and far trees match.
- **Grass clumps** along the track edges (up to 24,000): drawn blades on crossed cards, swaying,
  shrinking away beyond about 70 m, lit like the ground. Main camera only (not drawn in the
  wet-road mirror or the cockpit mirrors).
- **Cost:** 3 draw calls for the trees, 1 for the forests, 1 for the grass. By quality:

  | | Low | Medium | High | Ultra |
  |---|---|---|---|---|
  | Grass clumps | off | 35% | 70% | 100% |
  | Hillside forests | 35% | 60% | 100% | 100% |

**Image pipeline:**
- **Tone mapping** (Settings → Tone mapping): *Filmic (ACES)*, the punchy look you had so far
  (default), or *Natural (AgX)*, softer highlights and truer colour (exposure is raised a little
  to match).
- **SMAA** on Medium (Medium has no MSAA). High and Ultra keep 4× MSAA.
- **Lens fringe** (Settings → Lens fringe): slight colour fringing at the screen edges, like a
  real lens. On by default.
- The per-condition colour grade (shadow and highlight tints and saturation for each weather and
  time of day) and bloom carry over from Phase 3D.

**Before / after pictures:** `docs/compare/` has six side-by-side pictures (4B.2 left, 4C
right) at fixed spots: the start straight, trackside grass, the hills, an overview, night rain
and dusk rain. `tools/compare.py` makes them (see the top of the file for how to run it).

**Dev:** `__apex.shotCam = [x, y, z, lookX, lookY, lookZ, fov]` holds the camera at a fixed spot
(`null` to release).

**Not done in 4C:**
- **TAA** (temporal anti-aliasing): not added. With the motion blur and the wet-road mirror it
  would need careful motion vectors to avoid ghosting; MSAA + SMAA cover the edges for now.
- **Lens dirt** on the bloom: not added.
- **Sky:** the existing physical sky and cloud deck are unchanged (no new volumetric clouds).
- **Car materials:** unchanged in this phase (the paint already has clearcoat, flakes and the
  reflection probe from 3D).
- **Real scanned textures:** see above; the sites are blocked here, so everything is generated.
- **Frame-rate targets** (60 fps on High on an RTX 3050 laptop, 45+ on Ultra) can only be
  checked on your machine: press **F4** in a night-rain race and send me the result. Measured
  here at the start grid on High: draw calls 721 → 734 in night rain (the CPU cost that mattered
  in 4B.2 barely moves); triangles roughly double (about 1.1M → 2.1M), which is GPU work an RTX
  3050 handles easily but a built-in chip will feel. If it drops, Medium halves the grass and
  thins the forests.

## New in Phase 4B.2: heavy rain, lens drops and a smoother frame rate

**Rain intensity.** Rain now has a strength from 0 to 1 (about 0.3 light, 0.6 rain, 1.0 a
downpour).
- In a race it changes on its own over minutes: showers build into downpours and ease off.
- Settings → Rain strength: Changing / Light / Heavy / Downpour.
- Online, the host's rain is sent to everyone, so all players get wet together.
- It drives everything:
  - how many streaks there are, how bright and how long (still capped, so no hyperspace tunnel)
  - splashes and road wetness (grip, puddle shine, reflections)
  - fog
  - how fast lens drops gather
  - the windscreen rain in the cockpit, where the wiper runs intermittent in a light shower,
    normal in rain and fast in a downpour

**Lens drops (outside views)** are back on by default (Settings → Lens drops: Auto / Off).
- Each drop is a small lens. It shows the scene behind it shrunk and flipped, slightly soft,
  with a gentle rim where the light catches it. There are no dark outlines.
- Sizes mix: lots of tiny beads (High and Ultra), plus medium and large drops.
- The big ones slide slowly **down** the lens, wobbling, and leave a thin wet trail that fades.
- Speed never pushes them sideways. It only makes them gather faster (you drive into the rain),
  and the biggest ones near the edges tremble.
- The middle of the screen only ever gets a light covering; the edges and corners take most.
- A drop in front of a lamp, tail light or police bar glows.
- They take about 10 s to dry once the rain stops, and a nitrous burst flicks some off.

**Smoother frame rate.**
- **F3** now shows where the frame time goes:
  - CPU and GPU time
  - the graphics chip in use
  - milliseconds for physics, AI, police, effects, environment, HUD and scene
  - each render pass (main, wet road, paint probe, mirrors) with its draw calls
- **F4** runs a 30 s benchmark: the camera flies round the track at night in a downpour (Heat 5
  in a pursuit). It reports average fps, 1% low, CPU and GPU time, and copies the result to the
  clipboard.
- **What the measurement showed:** on Image-1/3-type scenes the frame was CPU-bound. The
  processor spends its time sending draw calls, and the wet-road mirror alone re-drew most of
  the scene. Particles and physics turned out to be cheap (a fraction of a millisecond), so they
  stayed on the CPU.
- **Fixes:**
  - Small details, rain, particles, name tags and road decals are left out of the extra passes
    (wet-road mirror, paint probe, mirrors).
  - Police cars and the pursuit breakers are merged into one draw call per material.
  - The paint probe updates every other frame.
  - The cockpit mirrors update one mirror per frame with a shorter view distance.
  - The minimap redraws at 30 Hz.
  - Per-frame allocations were removed from the reflection and post passes.
- **Target 60 fps** (on by default): when frames run long, the game lowers the render resolution
  in small steps if the graphics card is the limit (down to 70%). If the processor is the
  limit, the wet-road mirror refreshes every other frame instead (it stays lined up, one frame
  old). It restores both when there is room again.
- **Frame-rate cap:** 60 / 120 / Unlimited.
- **Settings → Graphics chip** shows which GPU the browser is drawing with. If it is a built-in
  chip, it explains how to switch the browser or Claude app to "High performance" in Windows
  Graphics settings. Plug the laptop in, too.

Draw calls before → after, same scenes, High, measured in the test browser:

| Scene | Before (4B) | After (4B.2) |
|---|---|---|
| Chase, pursuit Heat 5, night, rain | 1045 (main 559, wet road 418, probe 54) | ~700 (main ~450, wet road ~230, probe ~22) |
| Cockpit, pursuit, rain | 1257 (from your F3) | ~850 (mirrors 3×~250 → ~32 per frame) |

The test browser renders in software, so its fps means nothing. Please run F4 on your RTX 3050
(plugged in, High, 1080p) and send me the line it copies: that goes in this table.

## New in Phase 4B: realistic police and realistic rain

**Police**
- **Patrol sedan** (the main unit), an original full-size four-door:
  - bevelled panels with separate doors, windows and pillars
  - a push bar, mirrors and an A-pillar spotlight
  - black-and-white two-tone with clearcoat, a reflective stripe and "PROVING GROUNDS HIGHWAY
    PATROL" on the doors (invented words), and a roof number for the helicopter
  - steel wheels with hub caps, and two officers you can see through the glass
- **Unmarked car** (from Heat 4): the same sedan in dark metallic with no roof bar. Strobes hide
  in the grille, with a dash light bar behind the windscreen, rear-deck strobes and an antenna.
- **Heavy pickup** (now from Heat 3): the faceted crew-cab from 3C on the new light system.
- **Lights.** Each light bar has four module groups and runs real patterns:
  - quad flash at Heat 2 to 3, fast wig-wag at Heat 4 and up and on the pickup, alternating at
    Heat 1 and on roadblocks, dim cruise markers before they join or while they search
  - headlight wig-wag, grille and rear-deck strobes, and white alley lights at night
  - brake lights when they brake, reversing lights in reverse
  - the units nearest you share up to 4 real flashing lights (2 on Medium, 3 on High, 4 on Ultra);
    they alternate red and blue rather than washing everything purple
  - every bar lights the rain and smears red and blue streaks down a wet road
- **Sirens.** A wail far off, a yelp when they close in (or at Heat 3 and up), a phaser right on
  you, all with Doppler. A two-tone horn blast warns you a unit is about to ram.
- **Damage.** Hard knocks dent the nose and cave in the doors (blended dent shapes). A battered
  unit smokes from the bonnet, and a wrecked one has lost half its light bar. Damage comes from
  the host, so friends online see the same dents.
- **Life.** Units throw spray in the wet and smoke their tyres when they slide.
- **Levels of detail.** Full detail within 60 m, a plain shell to 200 m, and beyond that a
  glowing light-bar sprite.
- **Helicopter.** A smooth lathe-turned fuselage with a "PG AIR ONE" band and a glass nose. It
  has an engine fairing, a fenced tail rotor and skids that curl up at the front. The rotor blurs
  into a disc, and it carries a strobe and nav lights. Its searchlight beam shows in rain and fog
  as well as at night, and the down-wash throws a ring of spray on a wet track.

**Rain** (see `apex-pursuit-rain-prompt.txt` for the full brief)
- **No more bubbles on the camera.** Lens drops are **off** by default. Settings → "Lens drops
  (outside views)" → Light gives a few small, still drops with a gentle refraction; they no
  longer run sideways.
- **Streaks.**
  - Short, thin and capped in length, so they never fan out from the centre at speed.
  - They fade before the lens and fall at real rain speed with gusting wind.
  - They are **lit**: nearly invisible in the dark, bright where they cross a street lamp,
    your headlight beams, tail lights or a police bar.
- **Spray.** Every car on a wet road throws a rooster tail off each rear tyre and a thinner mist
  off the fronts. The spray grows with speed, hangs in the air and settles, and tail lights glow
  red in it. Rivals and police throw spray too.
- **Splashes.** Small rings flash on the road round you, lit the same way.
- **Road streaks.** Light streaks on the wet road are longer in the rain, and car lights streak
  at dusk too, not just at night.

## New in Phase 4A: HUD fixes, cameras and the cockpit

- **HUD zones.** Every HUD box keeps to its own zone: Heat top-left, race panel top-centre, event
  panel top-right, minimap bottom-left, rev dial bottom-right, Busted / Evade meters
  bottom-centre. Police radio lines and toasts now share one **call-out lane** under the race
  panel (two lines at most, newest pushes the oldest out), so the dispatcher no longer covers
  your position, lap and time. Big call-outs (3-2-1, SET, GO, JUMP START, lap times) sit below
  the lane.
- **Fits any window.** The whole HUD scales as one with min(width/1280, height/720), clamped
  0.7–1.15, times your HUD-size setting, and re-fits whenever the window changes size. Under
  900 px wide a compact layout kicks in (smaller panels, the event board shows just your row).
  `tools/hudcheck.py` fills every slot at once (radio line, toast, pop, recovery prompt, meters,
  sound hint) and checks that nothing overlaps or leaves the window at 1920×1080, 1280×720,
  1050×750, 960×540, 800×600 and 640×360, in the chase and hood cameras. All 12 pass.
- **Rain on the lens, redone.** Each drop is now a small lens: it shows the scene behind it
  shrunk and flipped, a little softer, with a bright rim and glint where it catches the light,
  and no dark outline. At speed the drops run sideways towards the edges, stretch and break up;
  they bead up over a few seconds and dry off quickly once the rain stops. Medium uses one
  layer of drops, High and Ultra two. Lens drops show in the chase and bumper views only.
- **Cameras.** Chase near, chase far, hood, bumper, **cockpit** and cinematic (C / △), and the
  game remembers your choice. Chase cameras are spring-damped, widen with speed and nitrous,
  and are kept out of walls by a ray against the world's colliders. **Z / X** look left and
  right (the chase camera swings round to show the side of the car; in the car your head
  turns), the right stick or a right-button mouse drag looks around freely and springs back.
- **Cockpit.** An original interior for the Phantom X1, under its bubble canopy:
  - central seat, an angular dash with a cyan LED line, and a carbon binnacle
  - a digital cluster showing live rpm, speed, gear and nitrous
  - a flat-bottomed wheel with shift lights and paddles; it turns 6.5× the front-wheel angle
  - gloved hands that stay on the rim, the right one pulls the paddle on up-shifts and the left
    one on down-shifts
  - a roll hoop, door cards and a lined roof
  - door mirrors and a rear camera mirror fed by one shared render target (every frame on
    High and Ultra, every other frame on Medium, a plain mirror tint on Low)
  - your head leans with cornering and nods under braking, and shakes a little on kerbs
  - windscreen rain with a working wiper that parks when the rain stops
  - a soft dash glow at night, and a cabin sound mix (muffled exhaust, louder intake, less wind)
  - rumble at the rev limiter and a light tick as the wiper turns round
  - option: hide the big HUD rev dial in this view (Settings → Rev dial in the cockpit)
  Looking back from the cockpit uses a camera on the tail, as the seat is in the way.
- **Hood and bumper mirror.** The race panel now moves down under the rear-view mirror instead
  of sitting behind it. In very short windows (under 480 px tall) the mirror is left off.

## New in Phase 3B: the in-race HUD

The race screen now follows the reference layout, and the centre of the screen is left clear.

- **Instrument cluster (bottom right).** A 0–10 ×1000 rpm analog dial with the red zone from 8,
  a cyan needle with a glow and a lit arc behind it, a big gear number, and the speed in a boxed
  panel. Small BOOST and N₂O gauges sit beside it. The gear blinks red and a shift light flashes
  just before the redline. The dial face is drawn once and cached, so each frame only draws the
  needles and numbers.
- **Minimap (bottom left).** A rounded square tilted back in perspective. It turns with the car
  (heading up), with you near the bottom so you see more road ahead, and zooms out as you speed
  up. Roads are light lines with the racing line in cyan. Rivals show in their paint colours and
  are pinned to the edge when off the map. Police flash red and blue (amber and blue in
  colour-blind-safe mode), and the helicopter, roadblocks, spike strips, work zones, speed traps,
  breakers and the chequered finish line all have their own marks.
- **Event panel (top right).** The event's name, a type icon, and a line with the race type,
  laps, weather and time. Under it is a small leaderboard: the leader plus the cars around you,
  each with their colour and the gap to you in seconds. It refreshes 4 times a second. Last and
  best lap sit at the bottom. In Free run it becomes a time-trial panel.
- **Top centre.** The event marker (red in a Pursuit Race), position, lap and lap time, and
  under them the gap to the car ahead (▲) and the car behind (▼). Gaps are estimated from the
  distance between you and your current speed.
- **Start lights with a random hold.** After 3, 2, 1 the lights go to SET and wait a random
  0.35–1.35 s before GO. Revving on the lights is fine, but stabbing the throttle during SET to
  guess the go is a **jump start**: you stay on the line for 1 s after everyone leaves. Online,
  the host's hold is sent to everyone so all players see the same lights.
- **Named events and Next event.** Six invented events (Neon Mile, Wet Asphalt, Blackout Run,
  Last Light, Storm Warning, Midnight Ten) mix circuit and pursuit races, lap counts, weather and
  time. The event card shows the name, and the results screen has a **Next event** button that
  sets up the next one. Online, only the host gets the button, and everyone goes to the new
  grid together.

Measured in the headless test browser (software rendering, slower than any real PC), the
cluster, text and minimap together cost about 0.4 ms a frame, under the 1 ms budget.

## New in Phase 3D: graphics for the RTX 3050

All of it is driven by the presets in `QUALITY` (`src/fx/PostFX.ts`); new code in
`src/fx/Reflections.ts`, `src/fx/GpuTimer.ts`, `src/world/StaticBatch.ts`, `src/ui/PhotoMode.ts`
and `src/game/Ghost.ts`.

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Resolution scale (× screen, capped at the display's) | 0.75 | 1 | 1.25 | 1.5 |
| Sun shadow (close-up, ±42 m round the car) | off | 1024 | 2048 | 4096 |
| Distant shadow (baked 4096² of the static world) | off | on | on | on |
| Wet-road mirror (render size × screen) | light streaks | 30% | 45% | 60% |
| Paint reflection probe on your car | off | off | 128² cube | 256² cube |
| Ambient occlusion (GTAO) | off | off | off | on |
| Camera motion blur (depth buffer) | off | off | on | on |
| MSAA / anisotropic filtering | 0 / 2× | 0 / 4× | 4 / 8× | 4 / 16× |
| Tyre smoke density | 0.7 | 1 | 1.3 | 1.5 |

- **Real wet-road reflections**: in rain the scene is drawn a second time from a camera mirrored
  in the road; the road, kerbs and paved areas show it where they are wet, pulled into vertical
  streaks by roughness, rippled by rain, stronger at grazing angles and mirror-sharp in puddles.
  Cars, tail lights, headlights, police light bars, lamps, gantries and buildings all reflect.
  Low keeps the cheap light streaks.
- **Paint reflections**: a cube camera follows your car and renders one face a frame, so the
  paint reflects what is really around it (rivals, police lights, lamps) instead of only the sky.
- **Shadows**: a sharp close-up sun shadow plus a baked distant shadow, so buildings, stands and
  trees shade the ground out to the horizon (re-baked when the sun moves).
- **Motion blur** reprojects every pixel with last frame's camera; pixels on a car use that car's
  own motion, so the car you follow stays sharp while the scenery streaks.
- **Lit tyre smoke**: thicker, longer-lasting clouds lit by the sky, the sun and street lamps,
  with tail lights, brake lights and police light bars glowing red and blue through them.
- **Dusk to night**: a new Time option; the race starts at dusk and ends at night (sun sets,
  lamps and headlights come up, stars appear). Works with every weather and online.
- **Photo mode** (Pause → Photo mode): free camera within 90 m of your car, depth of field
  (focus, aperture), exposure, a thirds grid, hidden HUD, and Save, which downloads a PNG.
- **Ghost car** in Free run: your best lap per edition is recorded and replayed as a see-through
  car, saved on this device. Settings → Ghost car turns it off.
- **Rear-view mirror** in the hood and bumper cameras (Settings → Rear-view mirror).
- **Level of detail**: rival cars drop brake discs and calipers beyond 45 m and small trim
  beyond 130 m (and stop casting shadows); your own car is always full detail.
- **Performance pass**: static scenery is merged per 160 m map cell (one draw call per material
  per cell, frustum culling kept); fewer per-frame allocations in the pursuit code.
- **Performance overlay**: F3 (or the backquote key, or Settings → Performance overlay) shows FPS,
  frame time, GPU time (where the browser supports timer queries), resolution, draw calls,
  triangles and which effects are on. The automatic step-down to a lower preset still runs when
  you haven't picked one yourself.

**Measured frame rates.** The build machine has no GPU (software rendering), so its numbers say
nothing about an RTX 3050. Measure with F3 on your laptop at 1080p and note them here:

| Preset | Clear dusk | Night rain, 8 cars | Pursuit, Heat 5 |
|---|---|---|---|
| Medium | | | |
| High | | | |
| Ultra | | | |

## New in Phase 3C-3: Pursuit Races

Pick **Pursuit** on the home screen (or *Pursuit race* on the event card). Tunables are in `POLICE`
in `src/config.ts`; the logic is `src/game/Pursuit.ts` (no rendering), drawn by
`src/world/PursuitView.ts`, `src/vehicle/PoliceCar.ts` and `src/vehicle/Helicopter.ts`.

- **Pacing (by share of the race)**: lap 1 is clean, with the speed-camera gantries visible but
  off. From lap 2 the cameras are live (over 200 km/h flashes you and adds Heat) and three work
  zones close one side of the track with cones, water-filled barriers and sawhorses (all
  breakable; they stand again each new lap). Police leave the pit lane at 40% of the race: start
  of lap 2 of 3, lap 3 of 5, lap 4 of 8.
- **Heat 1–5** decides the response: 1 two cruisers following and boxing you in; 2 three
  cruisers, PIT manoeuvres and rolling blocks; 3 four cruisers and roadblocks (two cruisers and
  concrete barriers across the track and the run-off, one 5 m gap) set ahead of the leader;
  4 spike strips (4 s of punctured tyres: about half the grip and much less pull) and a rammer;
  5 a second rammer and the helicopter, which keeps you in its searchlight.
  Heat rises with camera flashes, ramming police, smashing barriers and long chases in sight; it
  cools while nobody can see you. The HUD shows Heat, unit count and the Busted / Evade meters;
  the minimap marks police, roadblocks, spikes, work zones, cameras, breakers and the helicopter.
- **Busted**: under 15 km/h with police within 8 m fills the meter (about 3 s). Busted means a
  short slow-motion, the red Busted card, a fine (400 Speed Points × Heat) and a rolling restart
  behind the field after 5 s. Online, a teammate who rams the arresting cruiser within 5 s frees you.
- **Evade**: once they have seen you, 9 s with no police car or helicopter in sight (buildings,
  and trackside barriers at a distance, block the view) means *Evaded*: a bounty of 1,200 × Heat,
  Heat down a level and 9 s of searching before they come again.
- **Pursuit breakers**: scaffolding by the pit straight, a container stack and a timing tower,
  marked with orange chevrons. Drive past with police on your tail and the structure comes down
  across the track, wrecking the units behind you (bounty 1,500 each); they stand again two laps later.
- **Police vehicles** (original designs, invented livery "Proving Grounds Patrol"): a faceted
  matte-black crew-cab pickup with a full-width white LED nose bar, a roof bar flashing red and
  blue, bumper strobes and red / blue sill strips, on big off-road tyres; the Rammer is lifted,
  heavier and wears a steel push bar. They use the same physics as everyone, tuned heavier,
  torquier and slower (≈300 km/h), so you can outrun them on the straights. At night their
  beams and flashing pools light the road; on High and Ultra the two nearest also light the scene.
- **Sound**: sirens with Doppler shift for the two nearest units, a dispatcher with radio squelch
  and subtitles (spoken with the browser's speech voice; *Settings → Police radio voice* turns
  the voice off), camera flash and spike sounds. Rumble on camera flashes, police contact,
  spikes, barrier smashes, Busted, Evaded and breakers.
- **AI rivals** steer around work zones, roadblocks and police; police only chase a rival who rams them.
- **Online**: the host runs the police, traps and helicopter and sends them with the race; each
  player works out their own Busted / Evade / spikes / cameras; Heat is shared (guests report
  what they raised).

## New in Phase 3C-2: weather and time of day

- **Conditions**: the event card picks Weather (Clear, Cloudy, Rain, Random) and Time (Dusk,
  Night). Random rolls when the race starts. The home screen's drift scene shows your current
  choice. Online, the host's choice is sent to everyone (a guest sees a toast when it changes).
- **Cloudy**: overcast dome and solid cloud deck, flat grey light, short soft shadows, denser fog,
  a cooler, less saturated grade.
- **Rain**: GPU rain streaks around the camera that lean into you with speed; wet, darker tarmac
  with puddles in the roughness and stronger reflections; streak reflections of lamps, headlights
  and tail lights on the road; spray off every car's rear tyres; raindrops on the lens in the
  chase camera; rain and wet-tyre hiss in the audio; less tyre smoke and fainter skid marks.
- **Wet grip** (`WEATHER` in `src/config.ts`): tarmac 85%, kerbs 66%, grass 80%, run-off 80% of
  dry. 160–0 km/h takes 72 m instead of 64 m; the skid pad holds 1.35 g instead of 1.51 g.
  The AI scales its planned speeds to the wet grip (plus a small margin), so it brakes earlier;
  a hard AI laps in 75.0 s wet against 68.8 s dry, without touching a wall.
- **Night**: dark dome with twinkling stars and a moon (clear) or a low orange-lit cloud deck
  (cloudy / rain); 46 new street lamps all the way round the lap (plus the pit-straight and skid-pad
  floodlights), each with a pool of light on the road; lit windows and signs; headlight beams on
  the road for every car, tail-light glow and the Phantom X1 LED bar glowing on the tarmac; a
  real headlight spotlight on your car that lights rivals and barriers (Medium and up); the paint
  picks up lamp highlights from a night reflection map.
- **Quality presets stay honest** (`WEATHER.rainDrops`, `WEATHER.lampLights`): rain streaks
  1,800 / 4,500 / 9,000 / 14,000 and street-lamp spotlights 0 / 2 / 4 / 6 on Low / Medium / High /
  Ultra; everything else is cheap decals. Lens drops need the post-processing chain (Medium+).
- The home camera no longer passes through the drifting car.

## New in Phase 3C-1: handling, recovery, race flow

- **Handling modes** (Settings → Handling): *Arcade* (default, most forgiving), *Balanced*, and
  *Expert* (the original model, no help). Arcade caps the slide angle, catches slides harder,
  adds counter-steer help, slows steering at high speed, softens gear-change shunts and fades
  nitrous in, so the car stays smooth at 250+ km/h. Full lock at 150 km/h slides 9° instead of 32°.
- **Driving assists**: *Steering assist* (Off / Low / High) nudges you back toward the racing line
  near the edges and fades out when you steer hard; *Traction control* trims wheelspin;
  *Braking assist* keeps the car straight under heavy braking. All four sit in Settings and apply
  instantly, also mid-race.
- **Off-track recovery**: grass and run-off grip much better and drag less, so you can drive
  back on (about 2.4 s from beside the track, 5 s facing away). A wider paved run-off strip
  lines the circuit. If you are off track, stopped or going the wrong way for 3 s, a prompt
  appears; press **R / Share** to rejoin at once, or wait 6 s for the automatic rejoin. You come
  back on the racing line at a clear spot, rolling, and ghosted (blinking, no contact) for 2.5 s.
- **Keyboard throttle and brake ramp in** instead of snapping to 100%, for smoother corner exits.
- **Race flow**: Home → *Race* opens the event card (circuit drawing with sectors, length,
  estimated duration, the starting grid) where you pick 3, 5 or 8 laps and the rival level.
  Pursuit, cloudy, rain and night show as "soon" (3C-2 and 3C-3). The HUD shows *Lap n/N* and
  "Final lap". Crossing the line on the last lap: a moment of slow motion, *FINISHED 1st*, your
  car drives a cool-down lap on autopilot, then the results page (live times, gaps, best laps,
  Speed Points with a place bonus of 1,500 / 1,000 / 700 / …). Restart or go back to home.
- **Online**: the host's lap count is sent with the race, so everyone races the same distance.
  Free run stays endless.

## New in Phase 3A

- **Design system** (top of `index.html`): deep teal-black pages, cyan accent for selection and
  numbers, red kept for danger, the Outfit typeface, rounded cards with a cyan outline when
  selected, circular icon buttons, pill buttons, a faint diagonal stripe texture. Every menu
  page uses it: loading, home, car select, garage, pause, settings, controls, online box.
- **Navigation** (`src/ui/Nav.ts`): every page works with mouse, keyboard and DualShock 4.
  D-pad / stick / arrows move between controls, ✕ / Enter selects, ○ / Esc goes back, L1 / R1
  (Q / E) changes car. Pages slide and fade in 260 ms; reduced-motion settings shorten that.
- **Loading screen**: key art, a driving tip and real progress while the world builds.
- **Home**: the key art fades into a live scene of your car drifting circles on the skid pad.
  Menu: Race, Free run, Pursuit (arrives in 3C), Online with friends, Garage, Settings. The top
  row shows your driver name (click to edit), Speed Points, best lap and friends online.
- **Car select** (`src/vehicle/Cars.ts`): a card carousel of Phantom X1 editions with studio
  renders made from the real 3D car, stat bars and an in-use badge.

  | Edition | Livery | Tuning |
  | --- | --- | --- |
  | Street | Pearl White, pearl | the base car |
  | Sport | Racing Red, metallic | +6 % grip, +25 % downforce, more drag |
  | Nitro | Electric Blue, cyan underglow | 28 % slower nitrous burn, faster refill, a little less grip |
  | Pursuit | Gunmetal, matte | 16 % heavier, harder in contact, a touch more torque |

  A new car model is one entry in `CAR_MODELS` plus its editions.
- **Garage**: 8 factory paints plus a custom colour picker, finish (gloss, metallic, pearl,
  matte), rim colour, brake caliper colour and underglow. Saved in the browser.
- **Speed Points**: earned from banked drifts, air time and laps (more for a best lap).
  Editions can be gated behind them with the `unlock` field; all four are open for now.
- **Settings**: HUD size and colour-blind-safe colours added; pause menu gained Quit to home.
- **Online**: each player brings their own edition and look; the host still makes sure no two
  cars share a colour.

### Key art

The four pictures in `art/` (home 16:9 and 9:16, two loading screens) were generated with
Higgsfield (Nano Banana 2.1) from in-game renders of the Phantom X1, so the car matches the
model. The single-file build carries them inline; the published page loads them as its own files.

## Racing online with friends

Up to **4 players share one grid of 8**; AI fills the rest (2 players + 6 AI, 3 + 5, 4 + 4). Switch
it on with **Race online with friends** on the title screen or **Pause → Online race**, and set
your **Driver name** in the pause menu.

How it works: every player simulates their own car and publishes its state 20 times a second.
The player who has been in longest is the **host**: the host also runs the AI, sets the grid
(AI in front, players behind in joining order, no two cars the same colour) and owns the
starting lights. A new player joining sends everyone back to the grid. If the host leaves, the
next player takes over and restarts. The host's Rivals and Rival difficulty settings apply to all.
An online race cannot pause: with the menu open, your car just coasts.

**Phase 4C.2 (friends at their own homes)**: join by link from any copy of the game, one-click
internet hosting through a Cloudflare quick tunnel (`server/host.mjs`), a lobby with Ready and
Start, late joiners wait for the next race, an AI takes over a friend's car when they drop out,
room passwords, ping in the lobby, smoother remote cars at internet latency, and a version check
(everyone needs the same version of the game: protocol 2). This replaces "a new player joining
sends everyone back to the grid". Test: `tools/nettest.py` runs four players through the relay
(lobby, Ready, a 150 ms laggy player, a drop-out taken over by the AI, a late joiner, a wrong
password).

Ways to connect:

1. **As a shared claude.ai page.** Share the page with your friends from its Share menu. Friends
   who are signed in and have been given access open the same page and switch Online race on.
   A public link alone does not carry the live connection.
2. **Your own relay server** (anyone with a browser can join, no accounts):

   ```bash
   npm install
   npm run play:online        # builds, then serves the game + relay on http://localhost:8080
   ```

   The server prints the links. On the same Wi-Fi, friends open `http://<your-ip>:8080/?room=friends`.
   From home: `node server/host.mjs --internet` (what `Host online race.bat` runs) adds a public link.
   Over the internet, put the project on any Node host (Render, Railway, Fly.io, a VPS): start
   command `npm run play:online`, port from the `PORT` variable. Then share
   `https://<your-app-address>/?room=friends`. Any `?room=` name makes a separate race.

The relay (`server/relay.mjs`) is about 90 lines and holds no game logic. Each machine is the
authority for its own car, which is simple and lag-tolerant but not cheat-proof; a
server-authoritative mode is a later step. Not synced yet: knocked-over cones and barrels.

## New in Stage 2A

- **Eight-car grid**: you start 8th behind seven AI rivals, all in Phantom X1s. Every car has a
  different paint; changing yours swaps with whoever had it. Rivals carry a number and name tag.
- **Starting lights**: 3-2-1-GO with beeps and rumble. Cars are held on the grid, but you can
  rev and spin the rears while you wait.
- **AI drivers** (`src/ai/`): follow a computed racing line and speed plan, brake before turn-in,
  pull out to pass, hold a gap when alongside, defend (the "blocker" style), use nitrous on
  straights, make the odd mistake, and reverse out or get placed back on track if stranded.
  They use the same physics and nitrous tank as you. Three levels: easy laps in about 77 s,
  medium 71 s, hard 67.5 s. The rubber band is at most ±3.5 % of corner grip.
- **Car-to-car collisions** (`src/vehicle/CarCollisions.ts`): impulse-based, with sparks, sound,
  camera shake and rumble.
- **Slipstream**: tucking in behind another car cuts aero drag by up to 32 %.
- **HUD**: race position, lap number, rivals on the minimap in their paint colours.
- **Pause menu**: Rivals (7 cars / off for free run), Rival difficulty, Restart from the grid.
- One shared car model: geometry and materials are built once, so eight cars cost about 330
  draw calls in total.

Not in yet (next steps of Stage 2): race length and finish, results, garage, police traps.

## What came with Stage 1

- **Phantom X1**: procedural lofted body with real wheel-arch cut-outs, bubble canopy, full-width
  LED light bar, splitter, side intakes, turbine wheels, clear-coat metallic paint. Eight paints.
- **Physics** (`src/vehicle/VehiclePhysics.ts`): deterministic 120 Hz model. Saturating tyre
  curves, rear-drive friction circle, drift sustain and catch assists, 4-corner suspension with
  bump stops (weight transfer, kerbs, jumps), 7-speed auto/manual gearbox, nitrous, wall impacts.
  It has no rendering imports, so the same file can run on the server for reconciliation later.
- **Proving grounds**: 3.26 km circuit with lap timing, skid pad, link road, two ramps, cones and
  barrels to hit, barriers, pit complex, billboards for made-up sponsors, dusk lighting.
- **Cameras**: chase (speed FOV, drift swing, shake), hood, bumper, cinematic.
- **Effects**: tyre smoke, dust, sparks, skid marks, nitrous flames, bloom, radial speed blur,
  chromatic aberration, speed lines, colour grade, vignette, grain. Four quality presets, with
  automatic step-down if the frame rate stays low.
- **Audio**: synthesised engine, intake, blow-off, tyres, wind, nitrous, impacts, horn.
- **HUD**: speed, gear, rev bar, nitrous, lap times, minimap, drift and air-time call-outs.

## Layout

```
src/
  main.ts                 game loop and wiring
  config.ts               every tunable number (see below)
  core/                   math helpers, saved settings
  vehicle/                VehiclePhysics.ts (simulation), CarCollisions.ts, PhantomX1.ts (3D model), Cars.ts (editions, garage)
  ai/                     RacingLine.ts (line + speed plan), AIDriver.ts (one rival's brain)
  ui/                     Screens.ts (loading, home, car select, garage), Nav.ts, CardRenders.ts, Menu.ts,
                          HUD.ts (in-race overlay), Cluster.ts (rev dial), MiniMap.ts (rotating map)
  game/                   Race.ts (everyone on track: steps, contact, slipstream, positions), LapTimer.ts
  net/                    Transport.ts (page room / WebSocket relay / browser tabs), OnlineSession.ts (host, grid, sync)
  world/                  WorldData.ts (track, surfaces, colliders: logic only),
                          WorldBuilder.ts (meshes), Props.ts, textures.ts,
                          MaterialBaker.ts (GPU-painted PBR textures), Terrain.ts (hills),
                          Vegetation.ts (trees, forests, grass), venues.ts (track + facility
                          per venue), dressing/ (each venue's background detail)
  input/                  InputManager.ts (keyboard + Gamepad API), Haptics.ts (rumble mixer)
  camera/ fx/ audio/ ui/
tools/physics-test.ts     headless regression checks
tools/hudcheck.py         HUD overlap check at six window sizes (needs dist/ served on :8901)
tools/nettest.py          four players online through the relay: lobby, lag, drop-out, late joiner, password
tools/compare.py          before/after pictures at six fixed spots into docs/compare/
server/relay.mjs          serves the game and relays player states for online play (rooms, passwords, ping)
server/host.mjs           host from home: relay + Cloudflare quick tunnel, prints and copies the link
play/ApexPursuit.html     prebuilt single-file game (npm run build:play refreshes it)
Host online race.bat      Windows: start the relay for online play (host-online.sh on macOS / Linux)
build.mjs                 esbuild bundling
```

## Tunable parameters (`src/config.ts`)

| Group | Examples |
| --- | --- |
| `VEHICLE` chassis | `mass`, `yawInertia`, `cgToFront/Rear`, `halfTrack`, `wheelRadius` |
| `VEHICLE` suspension | `staticCompression` (ride frequency), `bumpTravel`, `dampingRatio` |
| `VEHICLE` engine | `torque`, `gearRatios`, `finalDrive`, `upshiftRpm`, `redlineRpm`, `shiftTime` |
| `VEHICLE` tyres | `gripAsphalt/Kerb/Grass`, `tyreB`, `tyreC`, `tractionBoost`, `powerSlide`, `spinSlideLoss` |
| `VEHICLE` drift feel | `driftSustain`, `driftAngleLimit`, `driftCatch`, `driftDamping`, `handbrakeGrip`, `counterSteerAssist` |
| `VEHICLE` aero | `dragCoef` (top speed), `downforce`, `grassDragBase/Speed` |
| `VEHICLE` steering | `steerMax`, `steerGain`, `steerRateDigital`, `steerRateAnalog` |
| `VEHICLE` nitrous | `nitroTorque`, `nitroAccel`, `nitroFadeSpeed`, `nitroBurn`, `nitroRegen*` |
| `VEHICLE` racing | `draftDrag`, `draftRange`, `carRadius`, `carRestitution`, `carFriction`, `carYawKick` |
| `AI` | `levels` (grip, power, nitrous per difficulty), `cornerGrip`, `brakeDecel`, `steerGain`, `laneRate`, `passGap`, `rubberBand`, `mistakeEvery`, `stuckTime`, `respawnTime` |
| `RIVALS` | each rival's name, number and style (aggressive, clean, blocker) |
| `HAPTICS` | `engineGain`, `slipGain`, `nitroGain`, `roughGrass/Kerb`, `speedBuzzFrom`, `tickMs` |
| `WORLD` | `trackHalfWidth`, `kerbWidth`, bounds |
| `PAINTS` | name, colour, metalness, roughness, clear coat |
| `RACE_FLOW` | start hold range, jump-start penalty, leaderboard refresh rate |
| `CAMERA` | chase near / far distances, heights and lag, hood / bumper / cockpit field of view, head movement, look angles, wall margin |
| `COCKPIT` | eye and wheel position, steering ratio, mirror resolution, wiper speed and sweep |
| `HUD_FIT` | HUD auto-scale limits and how many call-outs show at once |
| `LENS` | lens drops: how fast they gather (and faster at speed), how fast they dry, how light the middle of the screen stays |
| `PERF` | dynamic resolution floor and step, benchmark length and camera speed |
| `POLICE_LOOK` | police detail distances, light-bar brightness, damage thresholds, shared light count, horn range |
| `RAIN` | fall speed, wind, streak exposure and length cap, near fade, opacity, splash radius, lens-drop density |
| `POLICE.units` | units per Heat level: [patrol sedans, heavy pickups, unmarked] |
| `EVENTS` | the named event ladder used by Next event |

Reference numbers from the test suite: 0–100 km/h in 2.7 s, 360 km/h top speed (413 on
nitrous), 200–0 km/h in 98 m. The circuit layout is the `CONTROL` point list at the top of
`src/world/WorldData.ts`.

## Roadmap

1. Drivable Phantom X1, test track, cameras, keyboard + DualShock 4 with rumble (done)
2. Circuit racing with 7 AI rivals, car contact, slipstream, online play for 4 (done)
3. Phase 3
   - 3A. Design system, home, car select, garage, loading, restyled menus (done)
   - 3C-1. Handling modes, assists, off-track recovery, event card, finish and results (done)
   - 3C-2. Weather (cloudy, rain) and time of day (dusk, night) (done)
   - 3C-3. Pursuit Races: police, Heat, traps, roadblocks, spikes, breakers, helicopter (done)
   - 3D. RTX 3050 graphics: wet-road mirror, paint probe, shadows, AO, motion blur, lit smoke,
     dusk to night, photo mode, ghost car, mirror, LODs, performance pass (done)
   - 3B. In-race HUD: instrument cluster, tilted rotating minimap, event panel with live
     leaderboard, gaps, start hold and jump starts, named events with Next event (done)
4. Phase 4
   - 4A. HUD zones and auto-fit, HUD overlap check, lens rain rewrite, camera set with a full
     cockpit, mirrors and look controls (done)
   - 4B. Realistic police (patrol sedan, unmarked, heavy pickup), light patterns, sirens,
     horn, damage, LODs, helicopter; realistic rain (lit streaks, spray, splashes) (done)
   - 4B.2. Rain intensity (changing showers to downpours), realistic lens drops that slide
     down, and the smooth-60 pass: F3 timing breakdown, F4 benchmark, fewer draw calls,
     dynamic resolution, frame cap (done)
   - 4C. The big visual upgrade: GPU-painted materials, terrain and mountain ranges, trees,
     forests and grass with wind, aerial haze, AgX option, SMAA, lens fringe, before/after
     pictures (done). Still to do: TAA, lens dirt, new sky, car materials
   - 4C.2. Sound mixer; online races with friends at their own homes: join by link,
     one-click hosting, lobby, late joiners, AI takes over drop-outs, passwords (done)
   - **4D. Background detail around the circuit (grandstands with a reacting crowd, lit
     garages, marshals, catch fences, tyre walls, gravel, flags, floodlights, car park, power
     lines, a town and a highway at night, birds) and the venue system (done)**
   - 4D.1. Built-in music instead of Spotify: music packs, Add music, a Now playing line on
     home, and the music page with ticks, play-now, all on/off and its own volume (done)
   - 4E. Air One: a live police helicopter (searchlight, rotor wash, sound, smoke, spike
     strips, shock charges), gravel traps that drive like gravel, floodlights that light the
     track (done)
   - 4F. Smarter police: squads, roadblock gaps, a pursuit bounty, the search and hiding
     spots; searchlight shadows, floodlights that light the cars (done)
   - 4F.1. Real searchlight shadows, the Medium haze fixed, Air One smooth and steady
     online, its lights at night (done)
   - 4G. The sky: sunsets, moving clouds, stars and the Milky Way, a crescent moon,
     shooting stars, lightning and thunder, crows, lens dirt (done)
   - 4G.2. Online music from the host, audible thunder, a cheaper sky, TAA, paint and glass
     with rain beads, trackside detail (done)
   - **4G.3. Thunder on time with the lightning, deeper, one per strike, controller rumble in
     sync, silent in the menus (this build)**
   - 4H. Garage and career: money from bounties, upgrades, liveries, an event ladder (next)
   - Phase 5: Hanagiri Pass, the mountain venue (sprints and touge battles)
   - 4D. Proving Grounds background dressing; venue system ready for Phase 5 (a mountain pass)
