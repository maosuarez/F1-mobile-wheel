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
