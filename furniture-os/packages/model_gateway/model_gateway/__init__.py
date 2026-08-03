"""Provider-agnostic Model Gateway — swap LLM/Vision/ASR/Embeddings without engine changes."""

from __future__ import annotations

import hashlib
import json
import math
import re
from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: str


class LLMRequest(BaseModel):
    messages: list[ChatMessage]
    model: str | None = None
    temperature: float = 0.2
    response_json: bool = False


class LLMResponse(BaseModel):
    content: str
    model: str
    provider: str
    usage: dict[str, Any] = Field(default_factory=dict)


class VisionRequest(BaseModel):
    image_bytes: bytes
    prompt: str
    model: str | None = None


class VisionResponse(BaseModel):
    content: str
    structured: dict[str, Any] = Field(default_factory=dict)
    model: str
    provider: str


class ASRRequest(BaseModel):
    audio_bytes: bytes
    language: str = "ar"
    model: str | None = None


class ASRResponse(BaseModel):
    transcript: str
    confidence: float
    model: str
    provider: str


class EmbeddingRequest(BaseModel):
    texts: list[str] | None = None
    image_bytes: bytes | None = None
    model: str | None = None


class EmbeddingResponse(BaseModel):
    vectors: list[list[float]]
    dim: int
    model: str
    provider: str


class LLMProvider(ABC):
    @abstractmethod
    async def complete(self, req: LLMRequest) -> LLMResponse: ...


class VisionProvider(ABC):
    @abstractmethod
    async def analyze(self, req: VisionRequest) -> VisionResponse: ...


class ASRProvider(ABC):
    @abstractmethod
    async def transcribe(self, req: ASRRequest) -> ASRResponse: ...


class EmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, req: EmbeddingRequest) -> EmbeddingResponse: ...


def _deterministic_vector(seed: str, dim: int = 384) -> list[float]:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    vals: list[float] = []
    while len(vals) < dim:
        digest = hashlib.sha256(digest).digest()
        for b in digest:
            vals.append((b / 255.0) * 2 - 1)
            if len(vals) >= dim:
                break
    norm = math.sqrt(sum(v * v for v in vals)) or 1.0
    return [v / norm for v in vals]


class StubLLM(LLMProvider):
    async def complete(self, req: LLMRequest) -> LLMResponse:
        joined = " ".join(m.content for m in req.messages)
        # Heuristic JSON for decision / summary pipelines when no API key
        if req.response_json:
            payload = {
                "decisions": [],
                "preferences": [],
                "entities": [],
                "summary": joined[:240],
                "urgency": "normal",
            }
            lower = joined.lower()
            if any(x in joined for x in ("وافق", "approve", "موافقة", "اعتماد")):
                payload["decisions"].append(
                    {
                        "type": "approve",
                        "subject": "fabric_or_sample",
                        "confidence": 0.7,
                        "urgency": "high",
                    }
                )
            if any(x in joined for x in ("رفض", "reject", "مش عاجبني", "لا أحب")):
                payload["preferences"].append(
                    {"polarity": "dislikes", "target": "fabric_or_style", "confidence": 0.75}
                )
                payload["decisions"].append(
                    {"type": "reject", "subject": "sample", "confidence": 0.7, "urgency": "high"}
                )
            if "انتظار" in joined or "waiting" in lower or "موافقة" in joined:
                payload["decisions"].append(
                    {
                        "type": "review",
                        "subject": "pending_approval",
                        "confidence": 0.65,
                        "urgency": "high",
                    }
                )
            content = json.dumps(payload, ensure_ascii=False)
        else:
            content = f"[stub] Processed {len(joined)} chars of production context."
        return LLMResponse(content=content, model="stub-reasoner", provider="stub")


class StubVision(VisionProvider):
    async def analyze(self, req: VisionRequest) -> VisionResponse:
        # Lightweight heuristic from prompt keywords + image size
        size = len(req.image_bytes)
        structured = {
            "furniture_type": "sofa" if size % 3 == 0 else "dining_table" if size % 3 == 1 else "bedroom_set",
            "style_family": "damietta_classic" if size % 2 == 0 else "french_classic",
            "colors": ["beige", "gold"] if size % 2 == 0 else ["white", "walnut"],
            "materials": ["beech", "velvet"],
            "fabric": "velvet",
            "wood": "beech",
            "stage": "upholstery" if size % 5 == 0 else "carving" if size % 5 == 1 else "painting",
            "carving_present": True,
            "carving_type": "french",
            "legs_shape": "cabriole",
            "crown_shape": "broken_pediment",
            "arm_style": "rolled",
            "handle_style": None,
            "fabric_pattern": "plain",
            "pattern": "floral_carving",
            "visible_dimensions": None,
            "quality_notes": [],
            "confidence": 0.55,
            "keywords": ["classic", "carved"],
        }
        return VisionResponse(
            content=json.dumps(structured, ensure_ascii=False),
            structured=structured,
            model="stub-vision",
            provider="stub",
        )


class StubASR(ASRProvider):
    async def transcribe(self, req: ASRRequest) -> ASRResponse:
        # Stub: no real audio decode — placeholder transcript for pipeline wiring
        return ASRResponse(
            transcript="محتاجين موافقة على القماش قبل ما نكمل التنجيد",
            confidence=0.4,
            model="stub-asr",
            provider="stub",
        )


class StubEmbedding(EmbeddingProvider):
    dim = 384

    async def embed(self, req: EmbeddingRequest) -> EmbeddingResponse:
        vectors: list[list[float]] = []
        if req.texts:
            for t in req.texts:
                vectors.append(_deterministic_vector(t, self.dim))
        elif req.image_bytes:
            vectors.append(_deterministic_vector(hashlib.sha256(req.image_bytes).hexdigest(), self.dim))
        else:
            vectors.append(_deterministic_vector("empty", self.dim))
        return EmbeddingResponse(vectors=vectors, dim=self.dim, model="stub-embed", provider="stub")


class OpenAILLM(LLMProvider):
    def __init__(self, api_key: str, default_model: str):
        self.api_key = api_key
        self.default_model = default_model

    async def complete(self, req: LLMRequest) -> LLMResponse:
        import httpx

        model = req.model or self.default_model
        body: dict[str, Any] = {
            "model": model,
            "messages": [m.model_dump() for m in req.messages],
            "temperature": req.temperature,
        }
        if req.response_json:
            body["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        return LLMResponse(
            content=data["choices"][0]["message"]["content"],
            model=model,
            provider="openai",
            usage=data.get("usage", {}),
        )


class OpenAIEmbedding(EmbeddingProvider):
    def __init__(self, api_key: str, default_model: str = "text-embedding-3-small"):
        self.api_key = api_key
        self.default_model = default_model
        self.dim = 1536

    async def embed(self, req: EmbeddingRequest) -> EmbeddingResponse:
        import httpx

        if not req.texts:
            # Fall back to stub for image until multimodal embed configured
            stub = StubEmbedding()
            return await stub.embed(req)
        model = req.model or self.default_model
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": model, "input": req.texts},
            )
            r.raise_for_status()
            data = r.json()
        vectors = [row["embedding"] for row in data["data"]]
        return EmbeddingResponse(
            vectors=vectors, dim=len(vectors[0]) if vectors else self.dim, model=model, provider="openai"
        )


class ModelGateway:
    """Single entry for all model calls used by brain/production pipelines."""

    def __init__(
        self,
        llm: LLMProvider,
        vision: VisionProvider,
        asr: ASRProvider,
        embedding: EmbeddingProvider,
        llm_model: str,
        vision_model: str,
        asr_model: str,
        embedding_model: str,
    ):
        self.llm = llm
        self.vision = vision
        self.asr = asr
        self.embedding = embedding
        self.llm_model = llm_model
        self.vision_model = vision_model
        self.asr_model = asr_model
        self.embedding_model = embedding_model

    async def complete(
        self,
        messages: list[dict[str, str]] | list[ChatMessage],
        *,
        response_json: bool = False,
        temperature: float = 0.2,
    ) -> LLMResponse:
        msgs = [
            m if isinstance(m, ChatMessage) else ChatMessage(**m)  # type: ignore[arg-type]
            for m in messages
        ]
        return await self.llm.complete(
            LLMRequest(messages=msgs, model=self.llm_model, temperature=temperature, response_json=response_json)
        )

    async def analyze_image(self, image_bytes: bytes, prompt: str) -> VisionResponse:
        return await self.vision.analyze(
            VisionRequest(image_bytes=image_bytes, prompt=prompt, model=self.vision_model)
        )

    async def transcribe(self, audio_bytes: bytes, language: str = "ar") -> ASRResponse:
        return await self.asr.transcribe(
            ASRRequest(audio_bytes=audio_bytes, language=language, model=self.asr_model)
        )

    async def embed_texts(self, texts: list[str]) -> EmbeddingResponse:
        return await self.embedding.embed(EmbeddingRequest(texts=texts, model=self.embedding_model))

    async def embed_image(self, image_bytes: bytes) -> EmbeddingResponse:
        return await self.embedding.embed(EmbeddingRequest(image_bytes=image_bytes, model=self.embedding_model))


def build_gateway(
    *,
    llm_provider: str = "stub",
    llm_model: str = "stub-reasoner",
    vision_provider: str = "stub",
    vision_model: str = "stub-vision",
    asr_provider: str = "stub",
    asr_model: str = "stub-asr",
    embedding_provider: str = "stub",
    embedding_model: str = "stub-embed",
    openai_api_key: str = "",
) -> ModelGateway:
    if llm_provider == "openai" and openai_api_key:
        llm: LLMProvider = OpenAILLM(openai_api_key, llm_model)
    else:
        llm = StubLLM()

    if embedding_provider == "openai" and openai_api_key:
        emb: EmbeddingProvider = OpenAIEmbedding(openai_api_key, embedding_model)
    else:
        emb = StubEmbedding()

    # Vision/ASR: stub until keys + models configured (gateway still swappable)
    vision: VisionProvider = StubVision()
    asr: ASRProvider = StubASR()

    return ModelGateway(
        llm=llm,
        vision=vision,
        asr=asr,
        embedding=emb,
        llm_model=llm_model if llm_provider != "stub" else "stub-reasoner",
        vision_model=vision_model,
        asr_model=asr_model,
        embedding_model=embedding_model if embedding_provider != "stub" else "stub-embed",
    )


def cosine_similarity(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    dot = sum(a[i] * b[i] for i in range(n))
    na = math.sqrt(sum(a[i] * a[i] for i in range(n))) or 1.0
    nb = math.sqrt(sum(b[i] * b[i] for i in range(n))) or 1.0
    return dot / (na * nb)
