from functools import lru_cache

from model_gateway import ModelGateway, build_gateway

from app.core.config import settings


@lru_cache
def get_gateway() -> ModelGateway:
    return build_gateway(
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        vision_provider=settings.vision_provider,
        vision_model=settings.vision_model,
        asr_provider=settings.asr_provider,
        asr_model=settings.asr_model,
        embedding_provider=settings.embedding_provider,
        embedding_model=settings.embedding_model,
        openai_api_key=settings.openai_api_key,
    )
