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
    osm_raceway_names: tuple[str, ...] = ()  # si no vacío, solo vías raceway con ese name


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
    "spa": TrackSpec(
        id="spa",
        name="Circuit de Spa-Francorchamps",
        tumftm_csv="Spa.csv",
        fastf1_event="Belgian",
        years=(2022, 2021),
        official_length_m=7004.0,
        direction="cw",
        corner_names={
            1: "La Source", 2: "Eau Rouge", 3: "Raidillon", 4: "Raidillon",
            5: "Les Combes", 6: "Les Combes", 7: "Malmedy", 8: "Bruxelles",
            10: "Pouhon", 11: "Pouhon", 12: "Fagnes", 13: "Fagnes",
            15: "Stavelot", 17: "Blanchimont", 18: "Chicane", 19: "Chicane",
        },
        bbox=(50.420, 5.935, 50.450, 5.985),
    ),
    "bahrain": TrackSpec(
        id="bahrain",
        name="Bahrain International Circuit",
        tumftm_csv="Sakhir.csv",
        fastf1_event="Bahrain",
        years=(2022, 2021),
        official_length_m=5412.0,
        direction="cw",
        corner_names={},
        bbox=(26.020, 50.500, 26.045, 50.525),
        osm_raceway_names=("Grand Prix Circuit",),
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
