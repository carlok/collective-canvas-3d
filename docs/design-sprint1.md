# Collective Canvas 3D — Sprint 1 Design Document

## Understanding Summary

- **What**: Real-time collaborative 3D painting app for conferences/workshops
- **Why**: Interactive collective art experience — ephemeral, no install, no sign-in
- **Who**: One admin (presenter + laptop + projector), 1-100 anonymous audience (phones)
- **Key constraint**: Everything containerized (Podman), no external services, no database, all in-memory
- **Non-goals for Sprint 1**: Freeze/export, shake burst, reconnect, kick, multi-room, proximity

## Architecture

### Pages

| URL | Purpose | Who sees it |
|-----|---------|-------------|
| `/mobile` | Phone paint controller | Audience |
| `/dashboard` | Admin controls + 3D preview | Presenter's laptop |
| `/display` | Full-screen 3D canvas | Projector (HDMI) |

### Containers

```
docker-compose.yml
├── server (FastAPI + Uvicorn, port 8080)
│   ├── Serves static files (/mobile, /dashboard, /display)
│   ├── WebSocket: /ws (participants), /ws/admin (dashboard/display)
│   └── REST: /health
└── web (Vite + React, build-time only)
    ├── Multi-stage Dockerfile
    └── Outputs static files → copied into server container
```

### WebSocket Flow (Asymmetric)

```
Phone → Server:    { type: "position", alpha, beta, gamma, drawing: bool }
Server → Phone:    { type: "assigned", color, name }
                   { type: "go_live" }
                   { type: "stop" }

Server → Dashboard/Display:  { type: "snapshot", participants: [
                                 { id, color, x, y, z, drawing }
                               ]}
                             (batched at 20Hz)

Dashboard → Server: { type: "auth", password }
                    { type: "go_live" }
                    { type: "stop" }
```

### Key Design Decisions

#### 1. Direct Orientation Mapping
Phone orientation maps directly to 3D position in a bounded cube [-1, 1]:
- Alpha (yaw, 0-360°) → X
- Beta (pitch, -180 to 180°) → Y
- Gamma (roll, -90 to 90°) → Z

Rationale: Instant feedback, zero learning curve, bounded space keeps all participants visible.

#### 2. Batched Snapshot Relay (not 1:1)
Server accumulates position updates per participant and broadcasts a single snapshot at 20Hz to dashboard/display connections. This reduces outbound from 3000 msg/s to 20 msg/s.

#### 3. Server-Assigned Random Offset
Each participant gets a random offset (±0.3 on each axis) on join, so brushes start spread out in 3D space. The offset is applied server-side before broadcasting.

#### 4. Instanced Points Ring Buffer
Pre-allocated Float32Array (~30K particles). Ring buffer with per-particle age. Each frame: increment ages, fade alpha, recycle dead slots. One draw call. Adaptive cap: if FPS < 50, reduce active particles.

#### 5. iOS Permission on Direct Gesture
"Tap to enable your brush" button calls `DeviceOrientationEvent.requestPermission()` directly in the onclick handler. If denied → fallback to touch-drag controls.

#### 6. Two Separate Pages for Admin
- `/dashboard`: controls + 3D preview with full OrbitControls
- `/display`: distraction-free full-screen 3D, auto-orbit camera

#### 7. Single Default Room
No room creation UI. Server starts with one room. QR encodes `http://<host>:8080/mobile`.

#### 8. 3-Second Onboarding Hint
After permission granted, animated hint showing phone tilting → brush moving. Plus a colored dot on phone screen mirroring brush position for continuous feedback.

#### 9. 5-Second Ping Timeout
Short WebSocket ping/pong. Immediate cleanup on disconnect. No reconnection state in Sprint 1.

### Particle System Specs

| Parameter | Value |
|-----------|-------|
| Max particles | 30,000 (adaptive) |
| Lifetime | ~5 seconds |
| Emission | ~4 particles per position update while drawing |
| Visual | Point sprites, bloom post-processing |
| Fade | Linear alpha fade over lifetime |
| Camera | Auto-orbit on /display, OrbitControls on /dashboard |

### Mobile UI States

1. **Loading** → spinner, "Connecting..."
2. **Join** → "Join" button, optional name field
3. **Waiting** → assigned color background, "You're in! The presenter will start soon. Get ready to move your phone to paint in 3D.", breathing animation
4. **Permission** → "Tap to enable your brush" (on Go Live)
5. **Hint** → 3s animated onboarding (phone tilt → brush movement)
6. **Painting** → colored dot showing brush position, touch to draw
7. **Error** → "Can't reach the server — same WiFi?" + retry button

### Session Flow

```
[Lobby Phase]
Admin opens /dashboard → enters password → authenticated
Projector shows /display → QR code + participant count
Phones scan → connect → get color → waiting screen
Count rises on projector

[Go Live]
Admin clicks "Go Live" (or Space)
Server broadcasts go_live to all phones
Phones show "Tap to enable your brush" → permission → hint → paint UI
/display transitions from QR to 3D canvas

[Painting]
Phones stream orientation at ~30Hz
Server batches → broadcasts snapshots at 20Hz
Dashboard/display render particles

[Stop]
Admin clicks "Stop"
Server broadcasts stop
Phones → waiting screen
/display → QR + count
```

## Assumptions

- Dev: laptop + phone on same WiFi, plain HTTP
- 30Hz phone updates is sufficient fidelity
- 4 particles per emission gives good visual density
- 30K particle cap handles 30+ concurrent painters
- Admin password is set via .env file, acceptable for LAN use
- No TLS needed for local dev (DeviceOrientation works on localhost)

## Risks Accepted for Sprint 1

- No reconnection state (re-join gets new color)
- Admin auth has no session expiry or rate limiting
- Single process = single point of failure (acceptable for ephemeral sessions)
- No TLS on LAN (iOS may need workaround for DeviceOrientation over HTTP by IP)

## Decision Log

| # | Decision | Alternatives | Why |
|---|----------|-------------|-----|
| 1 | Direct orientation mapping | Velocity-based | Instant feedback, bounded space, zero learning curve |
| 2 | Simple fan-out (no pub/sub) | Room-based pub/sub | Single room, unnecessary abstraction |
| 3 | Batched snapshot at 20Hz | 1:1 relay | Eliminates fanout bottleneck (3K→20 msg/s) |
| 4 | Instanced points ring buffer | Individual meshes | Only viable path for 60 FPS |
| 5 | /dashboard + /display separate | Single page | Clean separation, projector distraction-free |
| 6 | Client-side QR generation | Server-side | Simpler, no extra endpoint |
| 7 | Single default room | Multi-room | Sprint 1 simplicity |
| 8 | iOS permission on direct gesture | On Join tap | Avoids silent denial, natural UX flow |
| 9 | 30K particle cap (adaptive) | 60K fixed | GPU safety on weak projector hardware |
| 10 | 3s onboarding hint + brush dot | No onboarding | Users won't discover tilt mechanic otherwise |
| 11 | 5s ping timeout | 10s / reconnect | Fast cleanup, no phantom participants |
