"""Tabla de circuitos soportados por el pipeline."""
from dataclasses import dataclass


@dataclass(frozen=True)
class TrackSpec:
    id: str
    name: str
    tumftm_csv: str
    fastf1_event: str
    years: tuple[int, ...]  # orden de intento
    official_length_m: float
    direction: str  # "ccw" | "cw"
    corner_names: dict[int, str]  # nº de curva -> nombre; el resto "Curva N"
    bbox: tuple[float, float, float, float] | None = None  # lat_min, lon_min, lat_max, lon_max


# Constantes del pipeline del entorno (design b12 D8)
WORLD_DEFAULTS = {
    "marginM": 600.0, "cellM": 10.0, "blendM": 40.0, "terrainSinkM": 0.3,
    "clearM": 6.0, "grandstandClearM": 2.0, "alignMaxRmsM": 8.0, "tileZoom": 14,
}


TRACKS: dict[str, TrackSpec] = {
    "interlagos": TrackSpec(
        id="interlagos",
        name="Autódromo José Carlos Pace",
        tumftm_csv="SaoPaulo.csv",
        fastf1_event="São Paulo",
        years=(2026, 2025, 2024, 2023, 2022, 2021),
        official_length_m=4309.0,
        direction="ccw",
        corner_names={
            1: "S do Senna", 2: "S do Senna", 3: "Curva do Sol",
            4: "Descida do Lago", 5: "Descida do Lago", 6: "Ferradura",
            7: "Ferradura", 8: "Laranjinha", 9: "Pinheirinho",
            10: "Bico de Pato", 11: "Mergulho", 12: "Junção",
            13: "Subida dos Boxes", 14: "Arquibancadas",
        },
        bbox=(-23.7080, -46.7050, -23.6960, -46.6920),
    ),
    "monza": TrackSpec(
        id="monza",
        name="Autodromo Nazionale Monza",
        tumftm_csv="Monza.csv",
        fastf1_event="Italian",
        years=(2026, 2025, 2024, 2023, 2022, 2021),
        official_length_m=5793.0,
        direction="cw",
        corner_names={},
    ),
}
