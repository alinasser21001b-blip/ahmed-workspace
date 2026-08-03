"""Design DNA — structured phenotype of a furniture design or piece."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class FurnitureType(str, Enum):
    SOFA = "sofa"
    CHAIR = "chair"
    ARMCHAIR = "armchair"
    DINING_TABLE = "dining_table"
    COFFEE_TABLE = "coffee_table"
    CONSOLE = "console"
    BEDROOM_SET = "bedroom_set"
    BED = "bed"
    WARDROBE = "wardrobe"
    MIRROR = "mirror"
    TV_UNIT = "tv_unit"
    SALON = "salon"
    OFFICE = "office"
    UNKNOWN = "unknown"


class StyleFamily(str, Enum):
    FRENCH_CLASSIC = "french_classic"
    DAMIETTA_CLASSIC = "damietta_classic"
    TURKISH_LUXURY = "turkish_luxury"
    ROYAL = "royal"
    VICTORIAN = "victorian"
    NEO_CLASSIC = "neo_classic"
    MODERN_CLASSIC = "modern_classic"
    UNKNOWN = "unknown"


class ProductionStage(str, Enum):
    DESIGN = "design"
    WOOD = "wood"
    CARVING = "carving"
    PAINTING = "painting"
    UPHOLSTERY = "upholstery"
    FINISHING = "finishing"
    DELIVERY = "delivery"
    COMPLETE = "complete"
    UNKNOWN = "unknown"


class DesignDNA(BaseModel):
    """Phenotype used for search, similarity, and graph edges — not raw pixels."""

    furniture_type: FurnitureType = FurnitureType.UNKNOWN
    style_family: StyleFamily = StyleFamily.UNKNOWN
    substyle: str | None = None

    legs_shape: str | None = None
    crown_shape: str | None = None
    arm_style: str | None = None
    back_style: str | None = None
    base_type: str | None = None

    carving_type: str | None = None
    carving_density: str | None = None
    motif: str | None = None
    handle_style: str | None = None

    wood_species: str | None = None
    finish: str | None = None
    colorway: list[str] = Field(default_factory=list)
    gilding: bool | None = None

    fabric_family: str | None = None
    fabric_pattern: str | None = None
    upholstery_style: str | None = None

    proportions_notes: str | None = None
    curved_vs_straight: str | None = None
    set_composition: str | None = None

    stage: ProductionStage = ProductionStage.UNKNOWN
    keywords: list[str] = Field(default_factory=list)
    trait_confidence: dict[str, float] = Field(default_factory=dict)
    extractor_version: str = "dna-v1"
    overall_confidence: float = 0.0

    def trait_overlap_score(self, other: "DesignDNA") -> float:
        pairs = [
            ("furniture_type", self.furniture_type.value, other.furniture_type.value),
            ("style_family", self.style_family.value, other.style_family.value),
            ("legs_shape", self.legs_shape, other.legs_shape),
            ("crown_shape", self.crown_shape, other.crown_shape),
            ("arm_style", self.arm_style, other.arm_style),
            ("carving_type", self.carving_type, other.carving_type),
            ("fabric_family", self.fabric_family, other.fabric_family),
            ("wood_species", self.wood_species, other.wood_species),
        ]
        matched = 0
        considered = 0
        for _, a, b in pairs:
            if a in (None, "", "unknown") or b in (None, "", "unknown"):
                continue
            considered += 1
            if a == b:
                matched += 1
        if considered == 0:
            return 0.0
        return matched / considered

    def to_search_text(self) -> str:
        parts = [
            self.furniture_type.value,
            self.style_family.value,
            self.legs_shape,
            self.crown_shape,
            self.arm_style,
            self.carving_type,
            self.fabric_family,
            self.fabric_pattern,
            self.wood_species,
            self.finish,
            " ".join(self.colorway),
            " ".join(self.keywords),
        ]
        return " ".join(p for p in parts if p)

    @classmethod
    def from_vision_dict(cls, data: dict[str, Any]) -> "DesignDNA":
        def enum_or(enum_cls: type[Enum], raw: Any, default: Enum) -> Enum:
            if raw is None:
                return default
            try:
                return enum_cls(str(raw).lower())
            except ValueError:
                for m in enum_cls:
                    if m.value.replace("_", "") == str(raw).lower().replace("_", "").replace(" ", ""):
                        return m
                return default

        colors = data.get("colors") or data.get("colorway") or []
        if isinstance(colors, str):
            colors = [colors]
        return cls(
            furniture_type=enum_or(FurnitureType, data.get("furniture_type"), FurnitureType.UNKNOWN),  # type: ignore[arg-type]
            style_family=enum_or(StyleFamily, data.get("style_family"), StyleFamily.UNKNOWN),  # type: ignore[arg-type]
            legs_shape=data.get("legs_shape"),
            crown_shape=data.get("crown_shape"),
            arm_style=data.get("arm_style"),
            carving_type=data.get("carving_type") or ("carved" if data.get("carving_present") else None),
            handle_style=data.get("handle_style"),
            wood_species=data.get("wood") or data.get("wood_species"),
            fabric_family=data.get("fabric") or data.get("fabric_family"),
            fabric_pattern=data.get("fabric_pattern") or data.get("pattern"),
            colorway=list(colors),
            stage=enum_or(ProductionStage, data.get("stage"), ProductionStage.UNKNOWN),  # type: ignore[arg-type]
            keywords=list(data.get("keywords") or []),
            overall_confidence=float(data.get("confidence") or data.get("overall_confidence") or 0.5),
            extractor_version="dna-v1",
        )
