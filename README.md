# Cassini

**Cassini** is a browser-based marine monitoring dashboard that receives live NMEA 2000 data
from an Actisense **W2K-2** over Wi-Fi (**TCP or UDP**, **N2K ASCII** format).

```
W2K-2 data server ──TCP/UDP, N2K ASCII──▶ server.js (bridge) ──SSE──▶ browser dashboard
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
dashboard and a double-click launcher. The person using it needs nothing installed. Build on the platform
you are targeting (the runtime copied is the one running the build).

```
node build.js --exe
```

additionally creates **one file**, `dist/Cassini.exe`: the bridge, simulator and every dashboard file
embedded in the Node.js runtime (Node's "single executable application" feature). Double-clicking it starts
the bridge and opens the browser; settings are saved next to the exe. On Windows the exe is given the Cassini icon and name
from `icon/cassini.ico` if the `rcedit` tool is present at `tools/rcedit/rcedit-x64.exe` (download it from
https://github.com/electron/rcedit/releases; it is not stored in the repository). `node icon/make-icon.js` regenerates the icon. This step fetches the `postject` tool
from npm the first time. Options: `--no-open`, `--lan`, `--port <n>`, `--demo`. The exe is not code-signed,
so Windows SmartScreen will warn on first run until it is signed with a code-signing certificate.

## Three ways to get data

| Source | How | Needs the bridge? |
|---|---|---|
| **WebSocket** | The browser connects straight to the gateway's built-in WebSocket (`ws://<gateway>/api/websocket`). No data server setup on the gateway. Chosen per device. | No - `public/index.html` can even be opened straight from disk |
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
| My Dashboard | Your own layout: add any panels (instruments, chart, single values, gauges, history graphs, lists), drag to move, drag the corner to resize; saved in the browser |
| Navigation | AIS targets (list with range, bearing, CPA and time to CPA, and markers on the chart), heading/COG/ROT, own-ship track plot, GNSS quality, waypoint (DTW, BTW, XTE, VMG, ETA), roll/pitch/rudder, depth & speed history |
| Engines | Per engine: RPM, coolant, oil pressure, load, fuel rate, alternator, boost, gearbox, hours, warning flags |
| Power & Tanks | Per battery: voltage, current, power, SOC, temperature, time remaining; tank levels; switch bank status |
| Environment | Apparent & true wind (true is calculated if not on the network), barometer + trend, temperatures, humidity |
| Alarms | Active alarms; enable/disable each alarm, set its trigger threshold and severity; optional sound on new critical alarms |
| Sources | Choose which source address to prioritise when several devices send the same data (automatic fail-over if it stops); custom names for engines, batteries and tanks |
| Network | Gateway status (W2K-2 REST API), devices on the bus, PGN traffic table, raw N2K ASCII log |

- **Themes:** light, dark and a red-only **night** mode, plus a brightness control (per device).
- **Alarm bar:** an active alarm shows on every page until acknowledged; critical alarms flash and can beep.
- **Stale data:** a value dims when its data is overdue, then goes blank ("—") when it stops.
- **Shared settings:** units, alarms, source priority and the My Dashboard layout are saved by the bridge
  in `prefs.json`, so every device viewing the dashboard shares them. Export/import is in Settings.
- **Stored history:** the bridge decodes the stream itself and keeps depth, speed, wind, pressure,
  temperatures, battery, engine and tank values plus the vessel position in `history.json`: a sample
  every 30 s for 24 hours and 10-minute averages for 30 days. Charts have Live / 24 h / 7 d / 30 d
  buttons and draw the matching alarm thresholds as dashed lines; the Track history card loads the stored
  track and draws it on the chart. History is cleared when the data source changes, and is not recorded
  for a browser using the direct WebSocket source unless the bridge is also connected to the gateway.
- **Map tiles:** the bridge fetches each map tile once and keeps it in `tile-cache/`, so areas you have
  already viewed keep working with no internet. Only viewed tiles are stored. Settings > Map tiles accepts another
  provider's tile address and credit if you do not want to use OpenStreetMap. The cache folder is safe to delete.
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
  makes read-only `GET` requests to the gateway's REST API (`about`, `info`,
  `wifi`, `installation`, `data_server_config`).
- **Branding.** The logo is `public/cassini_logo_bold.svg`; it is recoloured automatically for the dark theme.
  The theme uses the logo purple (`#3b0a91`) for buttons, switches and the active page, blue for data, and
  green / amber / red for status. The colours are CSS variables in the "Cassini theme" block at the end of
  `public/styles.css`. Text is set in Roboto.
- **Map.** The Navigation chart uses [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause, bundled in
  `public/vendor/`) with [OpenStreetMap](https://www.openstreetmap.org/copyright) base tiles and the
  [OpenSeaMap](https://www.openseamap.org) seamark overlay. Both are free; the attribution shown on the map
  must stay visible. Tiles are fetched from the internet by the browser - with no connection the chart
  switches to the built-in offline plot. The public OSM tile servers are donation-funded and have a
  [usage policy](https://operations.osmfoundation.org/policies/tiles/) (no bulk downloading, no guaranteed
  availability); if this is distributed widely, point the tile URL in `public/app.js` at your own or a
  commercial tile service.
- **Offline use.** Everything else is served locally, including the Roboto font (bundled in `public/vendor/fonts/`).
- Not a substitute for certified navigation instruments.

## Files

- `server.js` – bridge: static files, TCP/UDP client, SSE stream, REST proxy
- `sim.js` – demo simulator (N2K ASCII generator)
- `public/n2k.js` – N2K ASCII parser and PGN decoders
- `public/app.js`, `styles.css`, `index.html` – the dashboard

## Licence

Released under the [MIT Licence](LICENSE). Third-party components and map data are credited in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Cassini is an independent project and is not an Actisense product. "Actisense" and "W2K-2" are trademarks of
Active Research Limited, used here only to say which hardware Cassini works with.
