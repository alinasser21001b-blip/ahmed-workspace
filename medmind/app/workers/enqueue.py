from arq import create_pool
from arq.connections import RedisSettings

from app.core.config import settings


async def enqueue_job(job_id: str) -> None:
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await redis.enqueue_job("process_pack_job", job_id)
    await redis.aclose()
