from dataclasses import dataclass, field
import random
import colorsys


ANIMAL_NAMES = [
    "Fox", "Owl", "Bear", "Wolf", "Hawk", "Deer", "Lynx", "Crow",
    "Hare", "Moth", "Seal", "Wren", "Dove", "Frog", "Swan", "Orca",
    "Pike", "Newt", "Lark", "Vole", "Mole", "Wasp", "Crab", "Toad",
]

# Generate distinct hues for up to 100 participants
def _generate_color(index: int) -> str:
    hue = (index * 0.618033988749895) % 1.0  # golden ratio for max spread
    r, g, b = colorsys.hsv_to_rgb(hue, 0.85, 0.95)
    return f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"


def _generate_name(index: int) -> str:
    color_names = [
        "Red", "Blue", "Green", "Gold", "Pink", "Teal", "Lime", "Plum",
        "Mint", "Coral", "Amber", "Sky", "Rose", "Sage", "Rust", "Jade",
    ]
    color_name = color_names[index % len(color_names)]
    animal = random.choice(ANIMAL_NAMES)
    return f"{color_name} {animal}"


@dataclass
class Participant:
    id: str
    color: str
    name: str
    offset_x: float = field(default_factory=lambda: random.uniform(-0.3, 0.3))
    offset_y: float = field(default_factory=lambda: random.uniform(-0.3, 0.3))
    offset_z: float = field(default_factory=lambda: random.uniform(-0.3, 0.3))
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    drawing: bool = False


@dataclass
class Room:
    phase: str = "lobby"  # "lobby" or "live"
    participants: dict[str, Participant] = field(default_factory=dict)
    participant_counter: int = 0
