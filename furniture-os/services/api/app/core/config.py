from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT = Path(__file__).resolve().parents[4]  # furniture-os/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_ROOT / ".env"), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_base_url: str = "http://localhost:8000"

    database_url: str = "sqlite+aiosqlite:///./data/fios.db"
    redis_url: str = "redis://localhost:6380/0"

    s3_endpoint: str = "http://localhost:9010"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "fios-media"
    s3_region: str = "us-east-1"
    s3_use_ssl: bool = False

    llm_provider: str = "stub"
    llm_model: str = "stub-reasoner"
    vision_provider: str = "stub"
    vision_model: str = "stub-vision"
    asr_provider: str = "stub"
    asr_model: str = "stub-asr"
    embedding_provider: str = "stub"
    embedding_model: str = "stub-embed"
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    whatsapp_verify_token: str = "fios-verify"
    whatsapp_app_secret: str = ""
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""

    owner_email: str = "owner@furniture.local"
    owner_password: str = "change-me"
    jwt_secret: str = "dev-secret-change-in-production"
    tenant_id: str = "00000000-0000-0000-0000-000000000001"

    export_upload_dir: str = "./data/exports"
    storage_local: bool = True
    local_media_dir: str = "./data/media"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
