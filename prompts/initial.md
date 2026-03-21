# Collective Canvas 3D — Sprint Plan

## Section 0 — Big Picture

### What you are building

A real-time collaborative 3D painting application. A presenter at a conference or workshop projects a QR code. Audience members scan it with their phones — no app install, no sign-in. Each phone becomes a 3D paintbrush: rotating and moving the phone in any direction changes the brush position in a virtual 3D space, and touching the screen emits colored particles at that position. A large screen (projector or monitor) shows all participants' particles floating, glowing, drifting, and slowly fading away in a shared 3D scene — like luminous smoke in the dark. The painting is ephemeral: particles disappear after a few seconds. The presenter can freeze the scene to accumulate a denser sculpture, export it as a 3D model file (GLB or PLY), and then unfreeze to resume the live painting.

### Who is involved at runtime

- **Admin (the presenter):** One person. Opens the dashboard on their laptop. Controls the session: creates the room, shows the QR, decides when to start painting ("Go Live"), adjusts visual parameters, freezes the scene, exports sculptures, ends the round. The projector is their HDMI second display — it shows the audience-facing view (QR during lobby, 3D canvas during painting). Admin controls stay on the laptop screen, never projected.
- **Participants (the audience):** 1 to 100 people. Each has a phone. They scan the QR, tap "Join," and wait. When the admin clicks Go Live, all phones unlock simultaneously. Moving and rotating the phone controls the brush position in 3D. Touching the screen draws. Lifting the finger stops drawing but keeps the brush in position. Shaking the phone triggers a particle burst. They see the shared 3D result on the projector. They have no admin powers. They don't sign in. They are fully anonymous.

### The experience, step by step

1. Admin runs `podman compose up` on their laptop. Opens the dashboard in a browser.
2. Projector shows a QR code, the room name, and a live participant count.
3. Audience scans the QR. Each phone connects via WebSocket, gets a unique color and a random name (e.g., "Blue Fox"). Phone shows a "waiting" screen in their assigned color.
4. Admin sees the count rise. When enough people are in, admin clicks "Go Live" (or presses `Space`).
5. All phones simultaneously switch to the painting UI. The projector switches to the 3D canvas.
6. People move and rotate their phones to steer their brush through 3D space. Touch the screen to draw. Lift to reposition without drawing. Shake for a burst. Colored particles appear on the projector, fading after ~5 seconds.
7. Admin can freeze the scene (particles stop fading, sculpture accumulates), export a 3D file, then unfreeze to resume the live flow.
8. Admin clicks "Stop" to return to lobby. Phones go back to "waiting." QR reappears. Ready for another round.

### Technical constraints and philosophy

- **Containerized, nothing on the host.** Every build, test, and runtime process happens inside Podman containers. The host only runs `podman compose` commands. No `pip install`, no `npm install`, no global tools on the host. Ever.
- **No external services.** No Firebase, no Google, no cloud APIs, no third-party anything. The entire system is two containers: a FastAPI/Uvicorn server (Python) and a Vite/React static build (Node, build-time only). All state is in-memory in the Python process. No database.
- **No user accounts.** Participants are anonymous. The only credential in the system is a single admin password, set as an environment variable in the compose file.
- **Ephemeral by default.** Particles fade. Positions are overwritten. `podman compose down` erases everything. The only persistent artifact is an exported GLB/PLY file saved to the admin's laptop.
- **Pen up / pen down.** Phone orientation always updates the brush position. Touch controls whether particles emit. This makes deliberate shapes (letters, faces) possible alongside freeform painting.
- **Lobby → Live.** Nobody paints during the join phase. The admin controls when painting starts. Everyone begins at the same instant — a collective "go" moment.
- **Local-first development.** The dev setup is `podman compose up` on a laptop, phone on the same WiFi. Production deployment means putting the same containers behind your own reverse proxy (Nginx + certbot or whatever you use) on a VPS.
- **WebSocket is the only transport.** Phones connect over `ws://` (dev) or `wss://` (production). The server is a dumb relay: it receives position data from phones and broadcasts it to the dashboard. It manages rooms, colors, lobby/live state, and admin auth. It does not store particles — the particle system lives entirely in the dashboard's browser memory.

### What this document is

This is a sprint plan describing *what* to build in *what order*, focused on user-facing behavior and business logic. It is designed to be used as a prompt for an LLM-based coding tool. Each sprint ends with a functional, testable artifact. Implementation details (file structure, exact APIs, library choices beyond the stack) are left to the implementer.

---

**Focus of this document: local development setup.** You run `podman compose up` on your laptop, test with your phone on the same network. When you're ready for a real event, deploy the same containers to any VPS with your own reverse proxy and TLS (certbot, Nginx, whatever you already use).

---

## Stack

| Concern | Choice | Why |
|---------|--------|-----|
| Real-time relay | **FastAPI + WebSockets** | Native async WebSocket support, Python ecosystem, familiar stack |
| State | In-memory (server process) | Everything is ephemeral — particles fade, rooms are temporary. No database needed. |
| Admin auth | Simple token (env var) | Admin password set in compose env. Dashboard sends it once to authenticate. No user database — just one shared secret. |
| Containerization | Docker Compose / Podman Compose | Two services: `server` + `web`. One command to start. |
| Mobile app | Vite + React (static build) | Served at `/mobile` |
| Dashboard | Vite + React + R3F (static build) | Served at `/dashboard` |

No database. No auth provider. No cloud functions. No third-party services.

TLS and reverse proxy are left to your existing setup. For local dev, FastAPI/Uvicorn serves everything directly over plain HTTP (DeviceOrientation works on `localhost` without HTTPS). For production, put your usual Nginx + certbot in front.

### Nothing runs on the host

Every build, every test, every runtime process happens inside containers. The host machine only runs Podman. Specifically:

- **Python deps, Vite builds, linting, tests** — all execute inside container builds or via `podman compose run`.
- **No global installs** — no `pip install`, `npm install -g`, `npx`, or `python` on the host.
- **Dev workflow:** edit source files on the host (your editor), containers pick them up via volume mounts or rebuilds.
- **Running tests:** `podman compose run --rm server pytest` or equivalent — never bare `pytest` on the host.
- **Building frontend:** happens inside the `web` container's Dockerfile (multi-stage) — never bare `npm run build` on the host.
- **The only host commands are:** `podman compose up`, `podman compose down`, `podman compose run`, `podman compose build`.

This keeps the host clean, the environment reproducible, and avoids "works on my machine" entirely.

---

## Local Dev Setup

```
podman compose up
```

The FastAPI server (via Uvicorn) serves static files and handles WebSocket connections on port 8080. Open `http://localhost:8080/dashboard` on your laptop. Open `http://<laptop-lan-ip>:8080/mobile` on your phone (same WiFi).

DeviceOrientation works without HTTPS on `localhost`. On LAN by IP, most Android browsers allow it over HTTP. iOS Safari requires a secure context — for phone testing over LAN, you can either use a self-signed cert or tunnel via `ssh -R` to a machine with one. This is a dev-only concern; production will have proper TLS.

---

## docker-compose.yml (conceptual)

```yaml
services:
  server:
    build: ./server
    environment:
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-changeme}
    ports:
      - "8080:8080"
    volumes:
      - ./server/app:/app/app    # live reload during dev
    # FastAPI + Uvicorn
    # WebSocket endpoints: /ws (participants), /ws/admin (dashboard)
    # Static file mount: /mobile, /dashboard, /viewer
    # REST endpoints: /health
    # All state in memory — dies when the container stops

  web:
    build: ./web
    volumes:
      - ./web/src:/app/src       # live rebuild during dev
    # Vite build stage — produces static files
    # Copied into the server image or mounted as a volume
    # (Alternative: multi-stage build that bakes static files into the server image)
```

```bash
# Run server tests (inside container, nothing on host):
podman compose run --rm server pytest

# Run frontend linting (inside container):
podman compose run --rm web npm run lint

# Rebuild after dependency changes:
podman compose build
```

For production, deploy behind your existing reverse proxy (Nginx + certbot, or whatever you use). Uvicorn exposes HTTP on 8080 and handles WebSocket upgrade natively — any standard reverse proxy passes this through.

---

## Admin Access

The dashboard is password-protected. No user database — just a single shared secret.

1. `ADMIN_PASSWORD` is set as an environment variable in the compose file (or passed on the command line).
2. When opening `/dashboard`, the presenter is prompted for the password.
3. The dashboard sends it once over WebSocket. The server checks it against the env var.
4. If it matches, the WebSocket is tagged as an admin connection. All admin commands (go live, clear, new room, fade settings) require this tag.
5. If it doesn't match, the connection is closed. No retries, no lockout — just try again with the right password.

Participants never see a password prompt. The mobile app has no admin capabilities.

---

## Session Flow: Lobby → Live

A session has two phases, controlled by the admin from the dashboard. One projector, two moments.

**Phase 1 — Lobby (projector shows QR)**

1. Admin opens `/dashboard` on their laptop, enters the password.
2. The projector shows a big QR code, the room name, and a live participant count.
3. Audience scans the QR → phones connect → count goes up.
4. Phones show a "waiting" screen in their assigned color: "You're in. Waiting for the session to start…" with their color name and a subtle breathing animation.
5. No one is painting yet. The 3D scene is empty or showing a gentle ambient animation (floating dust, the room name in 3D, or just darkness).

**Phase 2 — Live (projector shows the 3D canvas)**

1. When enough people have joined (the admin sees the count), the admin clicks "Go Live" on the dashboard (or presses a keyboard shortcut like `Space`).
2. The server broadcasts a `go` event to all connected phones.
3. All phones simultaneously switch from "waiting" to the active painting UI. Orientation tracking activates. The screen says "Paint!" briefly and then becomes the paint interface.
4. The projector transitions from the QR/lobby view to the full-screen 3D canvas. Particles start flowing.
5. Everyone starts at the same moment. The "3, 2, 1, go" effect is built into the design.

**Ending a session:**

The admin can click "Stop" to return to Lobby phase. Phones go back to "waiting." Particles fade out. The QR reappears on the projector, ready for a new round. The admin can also click "New Room" which disconnects everyone and starts fresh.

---

## How users join

No accounts. No sign-in. Fully anonymous.

1. Admin starts a session → projector shows QR code + participant count.
2. User scans QR → phone opens the mobile web app with the room code pre-filled.
3. User taps "Join" → WebSocket connects → server assigns a color and a random display name (e.g., "Blue Fox", "Red Owl").
4. Phone shows "waiting" screen in their color. They're in, but not painting yet.
5. Admin clicks "Go Live" → all phones unlock painting simultaneously.

If the user wants a custom name, they can type one before tapping Join. But it's optional — the default name is enough to get started instantly.

---

## Sprint 1 — Lobby, Go Live, Paint (the minimum)

**Goal:** Admin controls the session. Audience joins, waits, then everyone paints together on cue.

**What happens:**

1. `podman compose up` starts the server and web containers.
2. Admin opens `/dashboard` in a browser, enters the password.
3. The dashboard creates a room and shows a QR code + participant count. This is projected for the audience.
4. Audience scans the QR → phones open `/mobile` → tap "Join" → WebSocket connects → server assigns a color.
5. Phones show a "waiting" screen in their assigned color. Participant count ticks up on the projector.
6. Admin clicks "Go Live" (or presses `Space`). Server broadcasts `go` to all phones.
7. All phones simultaneously switch to the painting UI. The phone requests orientation permission (iOS) and starts streaming position data based on the phone's 3D orientation: pitch, roll, and yaw map to X, Y, and Z axes. Movement speed is sent as intensity (0–1).
8. **Touch to draw:** Particles only emit when the user's finger is on the screen. Lifting the finger stops painting but keeps streaming position — like lifting a pen. This allows deliberate shapes (letters, faces, patterns), not just continuous trails. The position payload includes a `drawing: true/false` flag based on `touchstart`/`touchend`.
9. The projector transitions from the QR view to the full-screen 3D canvas.
10. The dashboard receives position updates for all participants via WebSocket.
11. For each update where `drawing` is true, colored particles are emitted in 3D space. They drift, fade, shrink, and disappear after ~5 seconds.
12. A bloom effect makes particles glow. Camera auto-orbits the scene.
13. Closing the phone tab → WebSocket disconnects → server removes the participant → dashboard stops emitting their particles.
14. Admin clicks "Stop" → back to lobby. Phones return to "waiting." Projector shows QR again for the next round.

**Fallback:** If no orientation sensor (desktop testing), mouse/touch drag controls X/Y. Mouse button down = drawing, mouse button up = not drawing — same pen-up/pen-down mechanic.

**Acceptance criteria:**
- `podman compose up` → system ready in under 30 seconds. No prior install steps on the host.
- Dashboard requires password. Wrong password → rejected.
- QR scan → join → waiting state in under 5 seconds.
- "Go Live" → all phones switch to painting simultaneously.
- Particles visible on dashboard within 200 ms of phone movement.
- Two phones produce two distinct color streams.
- Particles fade smoothly over ~5 seconds.
- "Stop" returns to lobby. Phones go back to waiting.
- 60 FPS on dashboard with 10+ users.

**This sprint is the product.** Everything after is polish.

---

## Sprint 2 — Mobile Feel

**Goal:** The phone feels like a real controller.

**What happens:**

1. **Color feedback:** Phone screen background matches assigned color.
2. **Drawing indicator:** Screen glows brighter when finger is down (actively painting). Dims when finger is lifted (pen up). Clear visual distinction between "painting" and "repositioning."
3. **Pulse:** Screen brightness subtly throbs with movement intensity while drawing.
4. **Connection dot:** Green = connected. Yellow = reconnecting. Red = lost.
5. **Shake burst:** Vigorous shake → particle explosion + optional haptic vibration (fires regardless of finger state — it's a gesture, not a draw).
6. **Leave button:** Tap to disconnect, with confirmation.
7. **Auto-reconnect:** If WebSocket drops, retry with backoff. User sees yellow dot, then green when restored.

**Acceptance criteria:**
- Shake detection works without false triggers during normal movement.
- Reconnection succeeds within 5 seconds on a stable network.
- Leaving cleans up the participant immediately.

---

## Sprint 3 — Dashboard Controls

**Goal:** Admin can tune the experience and run multiple rounds.

All dashboard controls require the admin password (entered once at session start).

**What happens:**

1. **Fade slider:** Adjusts particle lifetime (1–10 seconds). Immediate effect.
2. **Clear all:** Wipes all particles instantly (useful between rounds).
3. **Freeze / Unfreeze:** Pauses particle aging — the painting accumulates. See Sprint 4 for full export workflow. Keyboard shortcut: `F`.
4. **Scatter start positions (checkbox):** When enabled, the server assigns each participant a small random offset (±0.3 on each axis) so they start painting from different spots in 3D space. When off, everyone starts near center. Default: on. Changeable during Lobby phase before Go Live.
5. **Camera toggle:** Auto-orbit vs. manual drag-to-rotate.
6. **Participant list:** Names and color swatches of connected users.
7. **Go Live / Stop toggle:** Switch between lobby and painting phases. Keyboard shortcut: `Space`.
8. **New room:** Disconnects everyone, generates fresh room code and QR. Starts a clean session.
9. **Kick participant:** Remove a specific user (if someone is being disruptive).

**Acceptance criteria:**
- Fade slider visibly changes particle persistence.
- "Clear all" empties the scene in under 1 second.
- Freeze stops fading. Unfreeze resumes it.
- New room → new QR → old participants disconnected.
- Multiple rounds work: Go Live → paint → Freeze → Export → Unfreeze → Stop → Clear → Go Live again.

---

## Sprint 4 — Freeze and Export

**Goal:** The admin can accumulate a dense sculpture and download it as a 3D model.

**Where the painting lives:** The particle pool exists only in the dashboard's browser memory. The server is a dumb relay — it forwards position updates from phones but never stores particles. This means export is a client-side operation: the dashboard snapshots its own memory and writes a file.

**The problem with naive export:** Particles live ~5 seconds and die. Exporting at a random moment captures only a thin 5-second slice — it might look sparse and disappointing as a 3D object.

**The solution: Freeze mode.**

**What happens:**

1. While the session is live and people are painting, the admin clicks **"Freeze"** (or presses `F`).
2. All existing particles stop aging — their fade timers pause. Nothing disappears.
3. People keep painting. New particles keep appearing, but they don't fade either. The sculpture accumulates density.
4. The admin watches the 3D scene fill up on the projector. When it looks good — dense, colorful, sculptural — they proceed to export.
5. The admin clicks **"Export GLB"** or **"Export PLY"**:
   - **GLB** → downloads a `.glb` file. Opens in Blender, macOS Preview, Windows 3D Viewer, any web-based viewer. Supports color, PBR materials. Good for sharing and 3D printing services.
   - **PLY** → downloads a point cloud. Opens in MeshLab, CloudCompare. Lightweight.
6. Export captures all live particles in the pool: position, color, size. Generated client-side, downloaded directly to the admin's laptop.
7. The admin clicks **"Unfreeze"** (or presses `F` again). Particles resume fading. The ephemeral flow returns. The audience sees the frozen sculpture dissolve back into the live painting.
8. A standalone viewer page at `/viewer` lets anyone drag-to-rotate and explore the last exported model.

**Typical cycle at an event:**

```
Go Live → audience paints for a while → Freeze → painting accumulates
→ Export GLB → Unfreeze → painting resumes → ... repeat for next sculpture
```

**What happens on phones during Freeze:** Nothing changes. Phones keep streaming orientation data. The participants don't know the painting is frozen — they just see the 3D scene getting denser on the projector, which is actually a nice visual moment.

**3D printing path:**
- Open the exported GLB in Blender or MeshLab.
- Add a base plate for stability.
- Export as STL (for single-color prints) or WRL/VRML (for full-color sandstone on services like Shapeways, Sculpteo, or i.materialise).
- Default scale: ~150 mm bounding box.

**Acceptance criteria:**
- Freeze stops all fading. Particles accumulate without disappearing.
- Painting continues during Freeze — new particles appear and stay.
- Export GLB → file downloads → opens in at least 2 desktop viewers with correct colors.
- Export PLY → file downloads → opens in MeshLab or CloudCompare.
- Unfreeze → particles resume aging, frozen ones start fading from their current age.
- Export completes in under 3 seconds for 60,000 particles.
- Viewer page loads the model with orbit controls and auto-rotate.
- Full cycle works: Freeze → Export → Unfreeze → Freeze again for a second sculpture.

---

## Sprint 5 — Hardening

**Goal:** The system handles a real event without babysitting.

**What happens:**

1. **Room capacity:** Server rejects joins beyond a configurable cap (default 100).
2. **Stale cleanup:** Participants with no WebSocket heartbeat for 30 seconds are removed.
3. **Input clamping:** Server ignores position values outside [-1, 1] and intensity outside [0, 1].
4. **Rate limiting:** Server drops position updates faster than 30/second per client.
5. **Admin command validation:** All admin WebSocket messages (go live, stop, clear, kick, settings) are rejected unless the connection was authenticated with the correct password. Participant connections cannot send admin commands.
6. **Graceful shutdown:** `podman compose down` sends a close frame to all connected WebSockets before stopping.
7. **Health check:** `/health` endpoint on the server returns participant and room counts (no auth required — useful for monitoring during an event).

**Acceptance criteria:**
- 101st user gets a "room full" message, not a crash.
- Phones that lose connection are cleaned up within 30 seconds.
- Malformed messages are silently dropped, not echoed.
- A participant WebSocket sending "go live" or "kick" → ignored.
- `podman compose down` is clean — no orphan processes.
- All tests run via `podman compose run` — nothing installed or executed on the host.

---

## Sprint 6 — Proximity (Optional)

**Goal:** People standing near each other produce intertwined particle trails.

**What happens:**

1. On join, phone optionally shares coarse location (geohash at ~5 km precision — "same venue" detection, not tracking).
2. Users with matching geohash prefix are clustered together in 3D space.
3. Within a cluster, particle trails appear close together — they intermingle.
4. Users at different locations occupy different regions of the 3D volume.
5. Declining location → no clustering, but painting works normally.
6. No location data is persisted — it lives only in server memory while the user is connected.

**Acceptance criteria:**
- Two phones at the same location → particles in the same 3D region.
- Two phones far apart → particles in separate regions.
- Location declined → default position, no error.

---

## Sprint Sequence

```
Sprint 1   Lobby, Go Live, Paint  ← the product — demo-able
Sprint 2   Mobile Feel            ← phone polish
Sprint 3   Dashboard Controls     ← admin tools + multi-round
Sprint 4   Freeze and Export      ← accumulate a sculpture, take it home
Sprint 5   Hardening              ← event-ready
Sprint 6   Proximity (optional)   ← spatial clustering
```

**Demo after Sprint 1. Event-ready after Sprint 5.**

---

## Dev Topology (testing on your desk)

```
┌──────────────────────────────────────────────────┐
│  Same WiFi network                               │
│                                                  │
│   ┌───────────┐     ┌──────────────────────┐     │
│   │  Phone    │────▸│  Your laptop         │     │
│   │  browser  │ ws  │                      │     │
│   └───────────┘     │  podman compose up   │     │
│                     │                      │     │
│                     │  :8080 → server      │     │
│                     │  /dashboard          │     │
│                     │  /mobile             │     │
│                     └──────────────────────┘     │
└──────────────────────────────────────────────────┘

Phone: http://<laptop-ip>:8080/mobile?room=XXXX
Laptop: http://localhost:8080/dashboard
```

For production: deploy the same containers to a VPS, put your reverse proxy + TLS in front, point a domain at it. The QR code then encodes the public URL and phones connect over any network.

---

## Key Behaviors

- **Zero user accounts:** No sign-in for participants. No passwords. No OAuth. Just scan and paint.
- **Admin-only control:** One password (set in compose env) protects all admin actions. Participants cannot access dashboard controls.
- **Lobby → Live:** Everyone waits, then everyone starts together. The admin controls the moment.
- **Multi-round:** Stop → clear → Go Live again. Same audience, fresh canvas.
- **Server is stateless about art:** The server relays position data but never stores particles. The painting exists only in the dashboard's browser memory. The admin's browser is the "source of truth" for what the sculpture looks like.
- **Freeze → Export:** Particles normally fade in ~5 seconds. Freeze pauses aging so the painting accumulates. The admin exports when the sculpture looks right. Unfreeze resumes the ephemeral flow.
- **No external services:** No Firebase, no Google, no cloud functions, no third-party APIs. Just containers and your own infra.
- **Zero persistence:** All state is in-memory. `podman compose down` erases everything. Exported GLB/PLY files on the admin's laptop are the only artifact that survives.
- **Graceful degradation:** No gyroscope → touch fallback. No location → no clustering. Lost connection → auto-reconnect.
- **Pen up / pen down:** Finger on screen = painting. Finger off = repositioning. Phone orientation always updates the brush position; touch controls whether particles emit. This makes deliberate drawing (shapes, letters, faces) possible alongside freeform painting.
- **One command:** `podman compose up` → ready.
