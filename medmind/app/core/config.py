from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    api_base_url: str = "http://localhost:8000"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_base_url: str = "http://localhost:8000"

    database_url: str = "postgresql+asyncpg://medmind:medmind@localhost:5432/medmind"
    redis_url: str = "redis://localhost:6379/0"

    student_bot_token: str = ""
    admin_bot_token: str = ""
    admin_telegram_ids: str = ""

    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "medmind-packs"
    s3_region: str = "us-east-1"
    s3_use_ssl: bool = False

    anthropic_api_key: str = ""
    openai_api_key: str = ""
    llm_provider: str = "anthropic"
    llm_model: str = "claude-sonnet-4-20250514"

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    email_from: str = "packs@medmind.iq"

    default_timezone: str = "Asia/Baghdad"
    max_pdf_size_mb: int = 20
    max_pdf_pages: int = 150
    pack_generation_timeout_sec: int = 480

    @property
    def admin_ids(self) -> set[int]:
        if not self.admin_telegram_ids.strip():
            return set()
        return {int(x.strip()) for x in self.admin_telegram_ids.split(",") if x.strip()}


settings = Settings()
