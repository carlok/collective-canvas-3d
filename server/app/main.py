import asyncio
import json
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .room import RoomManager

app = FastAPI()
room_mgr = RoomManager()

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")
BROADCAST_INTERVAL = 1.0 / 20  # 20Hz snapshot broadcast


# --- Health ---

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "phase": room_mgr.phase,
        "participants": room_mgr.participant_count,
    }


# --- Snapshot broadcaster (20Hz) ---

async def broadcast_snapshots():
    while True:
        if room_mgr.phase == "live" and room_mgr.admin_ws:
            snapshot = room_mgr.get_snapshot()
            msg = json.dumps({"type": "snapshot", "participants": snapshot})
            dead = []
            for ws in room_mgr.admin_ws:
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                room_mgr.admin_ws.discard(ws)
        await asyncio.sleep(BROADCAST_INTERVAL)


@app.on_event("startup")
async def startup():
    asyncio.create_task(broadcast_snapshots())


# --- Participant WebSocket ---

@app.websocket("/ws")
async def ws_participant(ws: WebSocket):
    await ws.accept()

    if room_mgr.participant_count >= 100:
        await ws.send_text(json.dumps({"type": "error", "message": "Room is full"}))
        await ws.close()
        return

    participant = room_mgr.add_participant(ws)
    pid = participant.id

    # Send assignment
    await ws.send_text(json.dumps({
        "type": "assigned",
        "id": participant.id,
        "color": participant.color,
        "name": participant.name,
    }))

    # Notify admins of count change
    await _broadcast_admin_count()

    # If already live, tell this late joiner
    if room_mgr.phase == "live":
        await ws.send_text(json.dumps({"type": "go_live"}))

    try:
        while True:
            raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
            data = json.loads(raw)

            if data.get("type") == "position":
                alpha = float(data.get("alpha", 0))
                beta = float(data.get("beta", 0))
                gamma = float(data.get("gamma", 0))
                drawing = bool(data.get("drawing", False))

                # Clamp inputs
                alpha = max(0.0, min(360.0, alpha))
                beta = max(-180.0, min(180.0, beta))
                gamma = max(-90.0, min(90.0, gamma))

                room_mgr.update_position(pid, alpha, beta, gamma, drawing)

    except (WebSocketDisconnect, asyncio.TimeoutError, Exception):
        pass
    finally:
        room_mgr.remove_participant(pid)
        await _broadcast_admin_count()


# --- Admin WebSocket ---

@app.websocket("/ws/admin")
async def ws_admin(ws: WebSocket):
    await ws.accept()

    # First message must be auth
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10.0)
        data = json.loads(raw)
        if data.get("type") != "auth" or data.get("password") != ADMIN_PASSWORD:
            await ws.send_text(json.dumps({"type": "error", "message": "Invalid password"}))
            await ws.close()
            return
    except Exception:
        await ws.close()
        return

    await ws.send_text(json.dumps({
        "type": "authenticated",
        "phase": room_mgr.phase,
        "participant_count": room_mgr.participant_count,
    }))

    room_mgr.admin_ws.add(ws)

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "go_live":
                room_mgr.phase = "live"
                # Broadcast to all participants
                go_msg = json.dumps({"type": "go_live"})
                for pw in list(room_mgr.participant_ws.values()):
                    try:
                        await pw.send_text(go_msg)
                    except Exception:
                        pass
                await _broadcast_admin_state()

            elif msg_type == "stop":
                room_mgr.phase = "lobby"
                stop_msg = json.dumps({"type": "stop"})
                for pw in list(room_mgr.participant_ws.values()):
                    try:
                        await pw.send_text(stop_msg)
                    except Exception:
                        pass
                await _broadcast_admin_state()

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        room_mgr.admin_ws.discard(ws)


# --- Helpers ---

async def _broadcast_admin_count():
    if not room_mgr.admin_ws:
        return
    msg = json.dumps({
        "type": "participant_count",
        "count": room_mgr.participant_count,
    })
    dead = []
    for ws in room_mgr.admin_ws:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        room_mgr.admin_ws.discard(ws)


async def _broadcast_admin_state():
    if not room_mgr.admin_ws:
        return
    msg = json.dumps({
        "type": "state_change",
        "phase": room_mgr.phase,
    })
    for ws in list(room_mgr.admin_ws):
        try:
            await ws.send_text(msg)
        except Exception:
            room_mgr.admin_ws.discard(ws)


# --- Static files (must be last) ---

import os as _os

STATIC_DIR = "/app/static"

@app.get("/mobile")
@app.get("/mobile/")
async def serve_mobile():
    return FileResponse(f"{STATIC_DIR}/mobile.html")

@app.get("/dashboard")
@app.get("/dashboard/")
async def serve_dashboard():
    return FileResponse(f"{STATIC_DIR}/dashboard.html")

@app.get("/display")
@app.get("/display/")
async def serve_display():
    return FileResponse(f"{STATIC_DIR}/display.html")

# Mount assets directory if it exists (may not exist on first startup before web build completes)
_assets_dir = f"{STATIC_DIR}/assets"
if _os.path.isdir(_assets_dir):
    app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")
else:
    @app.on_event("startup")
    async def mount_assets_when_ready():
        """Try to mount assets on startup, retry is handled by reload."""
        if _os.path.isdir(_assets_dir):
            app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")
