"""Unit tests for Furniture Language, Design DNA, and Graph helpers (no DB required)."""

from design_dna import DesignDNA, FurnitureType, StyleFamily
from furniture_language import FurnitureLanguage, parse
from model_gateway import StubEmbedding, EmbeddingRequest, cosine_similarity, build_gateway
import asyncio


def test_furniture_language_royal_chair():
    p = parse("كرسي ملكي بتاج محفور")
    assert p.filters.get("furniture_type") == "chair"
    assert p.filters.get("style_family") == "royal"
    assert "crown_shape" in p.filters or any(s.code == "crown" for s in p.spans)


def test_furniture_language_french_carving():
    p = parse("حفر فرنسي على سفرة زان")
    assert p.filters.get("style_family") == "french_classic" or p.filters.get("carving_type") == "french"
    assert p.filters.get("furniture_type") == "dining_table"
    assert p.filters.get("wood_species") == "beech"


def test_preference_polarity():
    p = parse("لا أحب هذا النوع من القماش المخمل")
    assert p.preference_polarity == "dislikes"
    assert p.filters.get("fabric_family") == "velvet"


def test_design_dna_overlap():
    a = DesignDNA(
        furniture_type=FurnitureType.SOFA,
        style_family=StyleFamily.FRENCH_CLASSIC,
        crown_shape="broken_pediment",
        carving_type="french",
    )
    b = DesignDNA(
        furniture_type=FurnitureType.SOFA,
        style_family=StyleFamily.FRENCH_CLASSIC,
        crown_shape="broken_pediment",
        carving_type="french",
    )
    c = DesignDNA(furniture_type=FurnitureType.CHAIR, style_family=StyleFamily.MODERN_CLASSIC)
    assert a.trait_overlap_score(b) == 1.0
    assert a.trait_overlap_score(c) < 0.5


def test_design_dna_from_vision():
    dna = DesignDNA.from_vision_dict(
        {
            "furniture_type": "dining_table",
            "style_family": "damietta_classic",
            "colors": ["gold", "beige"],
            "wood": "beech",
            "confidence": 0.8,
        }
    )
    assert dna.furniture_type == FurnitureType.DINING_TABLE
    assert dna.wood_species == "beech"
    assert "gold" in dna.colorway


def test_stub_embeddings_deterministic():
    async def _run():
        emb = StubEmbedding()
        a = await emb.embed(EmbeddingRequest(texts=["french classic sofa"]))
        b = await emb.embed(EmbeddingRequest(texts=["french classic sofa"]))
        c = await emb.embed(EmbeddingRequest(texts=["modern chair"]))
        assert a.vectors[0] == b.vectors[0]
        assert cosine_similarity(a.vectors[0], c.vectors[0]) < 0.99

    asyncio.run(_run())


def test_gateway_stub_complete():
    async def _run():
        g = build_gateway()
        r = await g.complete(
            [{"role": "user", "content": "محتاجين موافقة على القماش"}],
            response_json=True,
        )
        assert r.provider == "stub"
        assert "decisions" in r.content or "موافقة" in r.content

    asyncio.run(_run())
