"""Furniture Language — Egyptian classical furniture lexicon and NLU helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field


@dataclass
class Lexeme:
    code: str
    kind: str  # furniture_type | style | trait | stage | material | action | sense
    surfaces: list[str]
    maps_to: dict[str, str] = field(default_factory=dict)
    disambiguation: str | None = None


# Controlled vocabulary: English codes + Arabic / English surface forms
LEXICON: list[Lexeme] = [
    Lexeme("chair", "furniture_type", ["كرسي", "كراسي", "chair", "chairs"], {"furniture_type": "chair"}),
    Lexeme("sofa", "furniture_type", ["كنبة", "كنب", "أنتريه", "sofa", "couch"], {"furniture_type": "sofa"}),
    Lexeme("dining_table", "furniture_type", ["سفرة", "ترابيزة سفرة", "طاولة طعام", "dining table"], {"furniture_type": "dining_table"}),
    Lexeme("bedroom_set", "furniture_type", ["غرفة نوم", "أوضة نوم", "bedroom"], {"furniture_type": "bedroom_set"}),
    Lexeme("wardrobe", "furniture_type", ["دولاب", "wardrobe"], {"furniture_type": "wardrobe"}),
    Lexeme("console", "furniture_type", ["كونسول", "console"], {"furniture_type": "console"}),
    Lexeme("salon", "furniture_type", ["صالون", "salon"], {"furniture_type": "salon"}),
    Lexeme("coffee_table", "furniture_type", ["ترابيزة قهوة", "منضدة", "coffee table"], {"furniture_type": "coffee_table"}),
    Lexeme(
        "royal",
        "style",
        ["ملكي", "رويال", "royal"],
        {"style_family": "royal"},
    ),
    Lexeme("french_classic", "style", ["فرنسي", "حفر فرنسي", "french", "french classic"], {"style_family": "french_classic", "carving_type": "french"}),
    Lexeme("damietta_classic", "style", ["دمياطي", "دمياط", "damietta"], {"style_family": "damietta_classic"}),
    Lexeme("turkish_luxury", "style", ["تركي", "تركي فاخر", "turkish"], {"style_family": "turkish_luxury"}),
    Lexeme("victorian", "style", ["فكتوري", "victorian"], {"style_family": "victorian"}),
    Lexeme("neo_classic", "style", ["نيوكلاسيك", "neo classic", "neoclassic"], {"style_family": "neo_classic"}),
    Lexeme(
        "crown",
        "trait",
        ["تاج", "النتاج", "crown", "pediment"],
        {"crown_shape": "present"},
        disambiguation="furniture_crown",
    ),
    Lexeme("legs", "trait", ["أرجل", "رجل", "legs"], {"legs_shape": "present"}),
    Lexeme("carving", "trait", ["حفر", "محفور", "نقش", "carving", "carved"], {"carving_type": "present"}),
    Lexeme("cabriole", "trait", ["كعب فرنسي", "cabriole"], {"legs_shape": "cabriole"}),
    Lexeme("gold", "material", ["دهب", "ذهب", "ذهبي", "gold", "gilding"], {"gilding": "true", "color": "gold"}),
    Lexeme("beech", "material", ["زان", "beech"], {"wood_species": "beech"}),
    Lexeme("walnut", "material", ["جوز", "walnut"], {"wood_species": "walnut"}),
    Lexeme("oak", "material", ["بلوط", "oak"], {"wood_species": "oak"}),
    Lexeme("mahogany", "material", ["ماهوجني", "mahogany"], {"wood_species": "mahogany"}),
    Lexeme("velvet", "material", ["مخمل", "قطيفة", "velvet"], {"fabric_family": "velvet"}),
    Lexeme("leather", "material", ["جلد", "leather"], {"fabric_family": "leather"}),
    Lexeme("linen", "material", ["كتان", "linen"], {"fabric_family": "linen"}),
    Lexeme("painting", "stage", ["دهان", "طلاء", "painting", "paint"], {"stage": "painting"}),
    Lexeme("upholstery", "stage", ["تنجيد", "نجاد", "upholstery"], {"stage": "upholstery"}),
    Lexeme("carving_stage", "stage", ["مرحلة الحفر", "في الحفر"], {"stage": "carving"}),
    Lexeme("finishing", "stage", ["تشطيب", "تحت التشطيب", "finishing"], {"stage": "finishing"}),
    Lexeme("wood_stage", "stage", ["نجارة", "خشب", "قطع خشب", "cutting"], {"stage": "wood"}),
    Lexeme("approve", "action", ["وافق", "موافقة", "اعتماد", "اعتمد", "approve", "approved"], {"decision_type": "approve"}),
    Lexeme("reject", "action", ["رفض", "مرفوض", "مش عاجبني", "لا أحب", "reject"], {"decision_type": "reject"}),
    Lexeme("review", "action", ["راجع", "شوف", "معاينة", "review", "sample"], {"decision_type": "review"}),
    Lexeme("delay", "action", ["تأخير", "متأخر", "delay", "delayed"], {"decision_type": "delay"}),
    Lexeme("start", "action", ["ابدأ", "نبدأ", "start production", "بدء"], {"decision_type": "start"}),
]


class ParsedSpan(BaseModel):
    code: str
    kind: str
    surface: str
    maps_to: dict[str, str] = Field(default_factory=dict)


class ParsedQuery(BaseModel):
    raw: str
    spans: list[ParsedSpan] = Field(default_factory=list)
    filters: dict[str, Any] = Field(default_factory=dict)
    decision_type: str | None = None
    preference_polarity: str | None = None


class FurnitureLanguage:
    def __init__(self, extra_lexemes: list[Lexeme] | None = None):
        self.lexemes = list(LEXICON)
        if extra_lexemes:
            self.lexemes.extend(extra_lexemes)
        # Longer surfaces first for greedy match
        self._patterns: list[tuple[re.Pattern[str], Lexeme, str]] = []
        for lex in self.lexemes:
            for surface in sorted(lex.surfaces, key=len, reverse=True):
                pat = re.compile(re.escape(surface), re.IGNORECASE)
                self._patterns.append((pat, lex, surface))

    def parse(self, text: str) -> ParsedQuery:
        spans: list[ParsedSpan] = []
        filters: dict[str, Any] = {}
        decision_type: str | None = None
        preference_polarity: str | None = None
        consumed: list[tuple[int, int]] = []

        for pat, lex, surface in self._patterns:
            for m in pat.finditer(text):
                start, end = m.span()
                if any(start < ce and end > cs for cs, ce in consumed):
                    continue
                consumed.append((start, end))
                spans.append(
                    ParsedSpan(code=lex.code, kind=lex.kind, surface=surface, maps_to=dict(lex.maps_to))
                )
                for k, v in lex.maps_to.items():
                    if k == "decision_type":
                        decision_type = v
                    elif k == "gilding" and v == "true":
                        filters["gilding"] = True
                    elif k == "color":
                        filters.setdefault("colors", [])
                        if v not in filters["colors"]:
                            filters["colors"].append(v)
                    else:
                        filters[k] = v

        lower = text
        if any(x in lower for x in ("لا أحب", "مش بحب", "مبحبش", "don't like", "hate")):
            preference_polarity = "dislikes"
        elif any(x in lower for x in ("بحب", "عاجبني", "I like", "prefer")):
            preference_polarity = "likes"

        # Sense: تاج in furniture context → crown trait (already mapped); jewelry sense ignored without gold+jewelry combo
        return ParsedQuery(
            raw=text,
            spans=spans,
            filters=filters,
            decision_type=decision_type,
            preference_polarity=preference_polarity,
        )

    def normalize_to_dna_fields(self, text: str) -> dict[str, Any]:
        parsed = self.parse(text)
        out: dict[str, Any] = dict(parsed.filters)
        if "colors" in out:
            out["colorway"] = out.pop("colors")
        return out

    def explain_term(self, term: str) -> dict[str, Any] | None:
        parsed = self.parse(term)
        if not parsed.spans:
            return None
        s = parsed.spans[0]
        return {"code": s.code, "kind": s.kind, "maps_to": s.maps_to, "surface": s.surface}


_default = FurnitureLanguage()


def parse(text: str) -> ParsedQuery:
    return _default.parse(text)


def normalize_to_dna_fields(text: str) -> dict[str, Any]:
    return _default.normalize_to_dna_fields(text)
