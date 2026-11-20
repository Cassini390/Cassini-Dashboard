# Cassini

**Cassini** is a browser-based marine monitoring dashboard that receives live NMEA 2000 data
from an Actisense **W2K-2** over Wi-Fi (**TCP, UDP or WebSocket**, **N2K ASCII** format).

```
W2K-2 data server ──TCP/UDP, N2K ASCII──▶ server.js (bridge) ──SSE──▶ browser dashboard
W2K-2 WebSocket ──────────────────────────────────────────────────▶ browser dashboard
```

Browsers cannot open raw TCP/UDP sockets, so `server.js` is a small bridge that
does it for them. It has **no dependencies** – only Node.js (18+) is needed.

## Run

```
node server.js            # then open http://localhost:8642
node server.js --lan      # also viewable from tablets/phones on the same network
node server.js --port 9000
node server.js --demo     # always use the simulator; never reads or writes config.json
```

On Windows you can double-click `run.bat`.

It starts in **Demo data** mode (a built-in simulator that emits real N2K ASCII,
so the full decode path is exercised). Click the connection pill or the settings
icon to connect to a gateway.

## Building a no-install download

```
node build.js
```

creates `dist/Cassini-<platform>/` and a `.zip` of it: a private copy of the Node.js runtime, the
dashboard and two double-click launchers, "Start Cassini" (this computer only) and "Start Cassini (share on
network)". The person using it needs nothing installed. Your own `config.json`, `prefs.json` and
`history.json` are never copied into the download. Build on the platform
you are targeting (the runtime copied is the one running the build).

```
node build.js --exe
```

additionally creates **one file**, `dist/Cassini.exe`: the bridge, simulator and every dashboard file
embedded in the Node.js runtime (Node's "single executable application" feature). Double-clicking it starts
the bridge and opens the browser; settings are saved next to the exe. On Windows the exe is given the Cassini icon and name
from `icon/cassini.ico` if the `rcedit` tool is present at `tools/rcedit/rcedit-x64.exe` (download it from
https://github.com/electron/rcedit/releases; it is not stored in the repository). `node icon/make-icon.js` regenerates the icon. This step fetches the `postject` tool
from npm the first time. Options: `--no-open`, `--lan`, `--port <n>`, `--demo`. If `Cassini.exe` is running
and cannot be replaced, build under another name with `node build.js --exe --exe-name Cassini-new.exe`.
Give the exe its own folder: `config.json`, `prefs.json`, `history.json` and `tile-cache/` are created
next to it. The exe is not code-signed,
so Windows SmartScreen will warn on first run until it is signed with a code-signing certificate.

## Three ways to get data

| Source | How | Needs the bridge? |
|---|---|---|
| **WebSocket** | The browser connects straight to the gateway's built-in WebSocket (`ws://<gateway>/api/websocket`). No data server setup on the gateway. Chosen per device. | No - `public/index.html` can even be opened straight from disk (the OpenStreetMap map is not available then, see Map tiles) |
| **TCP** / **UDP** | The bridge connects to a W2K-2 data server set to N2K ASCII and relays it to every browser. | Yes |
| **Demo data** | Built-in simulator. | Yes |

## Connecting to a W2K-2

1. In the W2K-2 web interface, set one of its data servers to output **N2K ASCII**
   (TCP or UDP) and note the port.
2. In the dashboard: **Settings → Data source**
   - **TCP** – enter the W2K-2 address (e.g. `192.168.4.1` when joined to its
     access point) and the server's port.
   - **UDP** – enter the port; the bridge listens for the gateway's broadcasts.
     The address is optional and only used to read gateway status.
   - **Find data servers on gateway** reads `GET /api/data_server_config` from the
     W2K-2 REST API and lists the servers so you can pick one.

The connection is saved in `config.json` and restored on the next start. TCP
reconnects automatically.

## What it shows

| Page | Contents |
|---|---|
| Overview | Compass, SOG, depth + history, wind, position, alerts, engines, batteries, tanks, environment |
| My Dashboard | Your own layout: add any panels (instruments, chart, single values, gauges, history graphs, lists), drag to move, drag the corner to resize; shared by every device viewing the dashboard |
| Navigation | AIS targets (list with range, bearing, CPA and time to CPA, and markers on the chart), heading/COG/ROT, own-ship track plot, GNSS quality, waypoint (DTW, BTW, XTE, VMG, ETA), roll/pitch/rudder, depth & speed history |
| Engines | Per engine: RPM, coolant, oil pressure, load, fuel rate, alternator, boost, gearbox, hours, warning flags |
| Power & Tanks | Per battery: voltage, current, power, SOC, temperature, time remaining; tank levels; switch bank status |
| Environment | Apparent & true wind (true is calculated if not on the network), barometer + trend, temperatures, humidity |
| Alarms | Active alarms; enable/disable each alarm, set its trigger threshold and severity; optional sound on new critical alarms |
| Sources | Choose which source address to prioritise when several devices send the same data (automatic fail-over if it stops); custom names for engines, batteries and tanks |
| Network | Gateway status (W2K-2 REST API), devices on the bus, PGN traffic table, raw N2K ASCII log, and Gateway logs (see below) |

- **Themes:** light, dark and a red-only **night** mode, plus a brightness control (per device).
- **Alarm bar:** an active alarm shows on every page until acknowledged; critical alarms flash and can beep.
- **Stale data:** a value dims when its data is overdue, then goes blank ("—") when it stops.
- **Shared settings:** units, alarms, source priority, custom names and the My Dashboard layout are saved by
  the bridge in `prefs.json`, so every device viewing the dashboard shares them. Export/import is in Settings.
  Theme, brightness, sound, the Map / Offline plot choice and the WebSocket source stay on each device.
- **Clear all data:** Settings > Received data forgets everything received so far (values, engine, battery and
  tank instances, sources, AIS targets, the track and the stored history) on every connected device. Use it
  before testing a new data stream. Settings, alarms and custom names are kept.
- **Stored history:** the bridge decodes the stream itself and keeps depth, speed, wind, pressure,
  temperatures, battery, engine and tank values plus the vessel position in `history.json`: a sample
  every 30 s for 24 hours and 10-minute averages for 30 days. Charts have Live / 24 h / 7 d / 30 d
  buttons and draw the matching alarm thresholds as dashed lines; the Track history card loads the stored
  track and draws it on the chart. History is cleared when the data source changes, and is not recorded
  for a browser using the direct WebSocket source unless the bridge is also connected to the gateway.
- **Map tiles:** the bridge fetches each map tile once and keeps it in `tile-cache/`, so areas you have
  already viewed keep working with no internet. Only viewed tiles are stored. Settings > Map tiles accepts another
  provider's tile address and credit if you do not want to use OpenStreetMap. The cache folder is safe to delete.
  When `public/index.html` is opened straight from disk there is no bridge, and the OpenStreetMap servers
  refuse tile requests from such a page, so the chart explains this instead (a custom tile provider still works
  if it allows it); the offline plot works either way.
- **Gateway logs:** the Network page lists the EBL log folders and files the W2K-2 writes to its SD card, marks
  the file being written, and downloads one file at a time (the gateway serves them at roughly 200 kB/s, so a
  5 MB file takes about half a minute). The files are in Actisense EBL format: open them with Actisense EBL
  Reader or Toolkit. Downloads use the gateway's `/api/download` request, which is not in the published
  REST API document.
- **AIS:** PGNs 129038, 129039, 129794, 129809 and 129810 are decoded from the public PGN definitions and have
  only been checked against the built-in simulator, not a real AIS receiver.
- **Test connection:** Settings can test a TCP/UDP source and says plainly what is wrong.

### Decoded PGNs

60928, 126992, 126996, 127245, 127250, 127251, 127257, 127258, 127488, 127489,
127493, 127501, 127505, 127506, 127508, 128259, 128267, 128275, 129025, 129026,
129029, 129038, 129039, 129283, 129284, 129539, 129540, 129794, 129809, 129810, 130306, 130310, 130311, 130312, 130313,
130314, 130316. Other PGNs are still counted on the Network page. To add one,
add a decoder to `DECODERS` in `public/n2k.js`.

## Notes

- **Receive only.** The dashboard never transmits onto the NMEA 2000 bus and only
  makes read-only `GET` requests to the gateway's REST API (`about`, `info`, `wifi`, `installation`,
  `data_server_config`, `data_routing`, `data_logs`, `paths`) and, when you click a download, fetches that
  one log file. It never logs in to the gateway and never changes or deletes anything on it.
- **Network sharing has no password.** With `--lan` (or the "share on network" launcher) anyone on the same
  network who opens the dashboard can change the shared settings, use Clear all data and download the
  gateway's log files. Only use it on a network you trust.
- **Branding.** The logo is `public/cassini_logo_bold.svg`; it is recoloured automatically for the dark theme.
  The theme uses the logo purple (`#3b0a91`) for buttons, switches and the active page, blue for data, and
  green / amber / red for status. The colours are CSS variables in the "theme colours" block at the top of
  `public/styles.css`. Text is set in Roboto.
- **Map.** The Navigation chart uses [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause, bundled in
  `public/vendor/`) with [OpenStreetMap](https://www.openstreetmap.org/copyright) base tiles and the
  [OpenSeaMap](https://www.openseamap.org) seamark overlay. Both are free; the attribution shown on the map
  must stay visible. Tiles are fetched from the internet by the bridge (and cached, see Map tiles) - with no
  connection the chart switches to the built-in offline plot. The public OSM tile servers are donation-funded
  and have a [usage policy](https://operations.osmfoundation.org/policies/tiles/) (no bulk downloading, no
  guaranteed availability); if this is distributed widely, use your own or a commercial tile service, either in
  Settings > Map tiles or by changing `TILE_SOURCES` in `server.js`.
- **Offline use.** Everything else is served locally, including the Roboto font (bundled in `public/vendor/fonts/`).
- Not a substitute for certified navigation instruments.

## How the code is organised

- `server.js` – bridge: static files, TCP/UDP client, SSE stream, gateway REST and log-file proxy, map tile cache
- `sim.js` – demo simulator (N2K ASCII generator)
- `history.js` – stored history for the 24 h / 7 d / 30 d charts and the track
- `public/n2k.js` – N2K ASCII parser and PGN decoders (shared by the bridge and the browser)
- `public/index.html`, `public/styles.css` – the page and its styling
- `public/js/` – the browser application, one file per job:

  | File | What it holds |
  | --- | --- |
  | `core.js` | DOM helpers, settings (shared and per-device), unit conversion |
  | `store.js` | live value store, staleness, source arbitration, derived values, names |
  | `alarms.js` | alarm definitions, evaluation, acknowledgement, audible alert |
  | `widgets.js` | arc gauge, compass, wind dial, history charts |
  | `chart.js` | Navigation map, offline plot, AIS targets, track card |
  | `instruments.js` | ready-made gauges, tank rows, history chart boxes, custom names |
  | `panels.js` | My Dashboard (the customisable panel grid) |
  | `pages.js` | the fixed pages |
  | `gateway.js` | gateway status and log files from the W2K-2 REST API |
  | `shell.js` | sidebar navigation, rendering loop, theme, status messages |
  | `connection.js` | bridge event stream, direct WebSocket source, periodic work |
  | `settings-dialog.js` | the Settings dialog |
  | `main.js` | logo and start-up |

  There is no build step and no module system: these are plain scripts loaded by `index.html` in the order above,
  and their top-level `const`, `let` and `function` declarations share one scope. That keeps the page working when
  it is opened straight from disk (`file://`), where JavaScript modules are not allowed. The cost is that names must
  be unique across the files, and a file may only *run* code at load time that uses things from files listed before it.

## Licence

Released under the [MIT Licence](LICENSE). Third-party components and map data are credited in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Cassini is an independent project and is not an Actisense product. "Actisense" and "W2K-2" are trademarks of
Active Research Limited, used here only to say which hardware Cassini works with.
