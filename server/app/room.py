import uuid
from fastapi import WebSocket
from .models import Room, Participant, _generate_color, _generate_name


class RoomManager:
    def __init__(self):
        self.room = Room()
        self.participant_ws: dict[str, WebSocket] = {}
        self.admin_ws: set[WebSocket] = set()

    def add_participant(self, ws: WebSocket) -> Participant:
        pid = uuid.uuid4().hex[:8]
        index = self.room.participant_counter
        self.room.participant_counter += 1
        p = Participant(
            id=pid,
            color=_generate_color(index),
            name=_generate_name(index),
        )
        self.room.participants[pid] = p
        self.participant_ws[pid] = ws
        return p

    def remove_participant(self, pid: str):
        self.room.participants.pop(pid, None)
        self.participant_ws.pop(pid, None)

    def get_participant_by_ws(self, ws: WebSocket) -> str | None:
        for pid, w in self.participant_ws.items():
            if w is ws:
                return pid
        return None

    def update_position(self, pid: str, alpha: float, beta: float, gamma: float, drawing: bool):
        p = self.room.participants.get(pid)
        if not p:
            return
        # Direct mapping: normalize orientation to [-1, 1]
        p.x = max(-1.0, min(1.0, (alpha / 180.0) - 1.0)) + p.offset_x
        p.y = max(-1.0, min(1.0, beta / 90.0)) + p.offset_y
        p.z = max(-1.0, min(1.0, gamma / 45.0)) + p.offset_z
        p.drawing = drawing

    def get_snapshot(self) -> list[dict]:
        return [
            {
                "id": p.id,
                "color": p.color,
                "x": round(p.x, 4),
                "y": round(p.y, 4),
                "z": round(p.z, 4),
                "drawing": p.drawing,
            }
            for p in self.room.participants.values()
        ]

    @property
    def phase(self) -> str:
        return self.room.phase

    @phase.setter
    def phase(self, value: str):
        self.room.phase = value

    @property
    def participant_count(self) -> int:
        return len(self.room.participants)
