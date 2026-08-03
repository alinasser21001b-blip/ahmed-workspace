from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.constants import JobStatus, JobType, PackStatus
from app.db.session import SessionLocal
from app.models import PackJob, StudyPack, User
from app.services.delivery import process_delivery_job
from app.services.pipeline.generator import run_pack_pipeline


async def process_pack_job(ctx, job_id: str) -> None:
    async with SessionLocal() as session:
        result = await session.execute(select(PackJob).where(PackJob.id == job_id))
        job = result.scalar_one_or_none()
        if not job or job.status not in {JobStatus.PENDING, JobStatus.FAILED}:
            return

        job.status = JobStatus.RUNNING
        job.started_at = datetime.now(timezone.utc)
        job.attempts += 1
        await session.commit()

        try:
            if job.job_type == JobType.GENERATE_PACK:
                pack_result = await session.execute(
                    select(StudyPack).where(StudyPack.id == job.study_pack_id)
                )
                pack = pack_result.scalar_one()
                user_result = await session.execute(select(User).where(User.id == pack.user_id))
                user = user_result.scalar_one()
                await run_pack_pipeline(session, pack, user)
            elif job.job_type == JobType.DELIVER_PACK:
                await process_delivery_job(session, job)
            else:
                job.status = JobStatus.COMPLETED

            if job.job_type != JobType.GENERATE_PACK:
                job.status = JobStatus.COMPLETED
            job.finished_at = datetime.now(timezone.utc)
            await session.commit()

            if job.job_type == JobType.GENERATE_PACK:
                delivery_result = await session.execute(
                    select(PackJob).where(
                        PackJob.study_pack_id == job.study_pack_id,
                        PackJob.job_type == JobType.DELIVER_PACK,
                        PackJob.status == JobStatus.PENDING,
                    )
                )
                delivery_job = delivery_result.scalar_one_or_none()
                if delivery_job:
                    from app.workers.enqueue import enqueue_job
                    await enqueue_job(str(delivery_job.id))

        except Exception as exc:
            job.status = JobStatus.FAILED if job.attempts >= job.max_attempts else JobStatus.PENDING
            job.error_message = str(exc)
            job.finished_at = datetime.now(timezone.utc)
            pack_result = await session.execute(select(StudyPack).where(StudyPack.id == job.study_pack_id))
            pack = pack_result.scalar_one_or_none()
            if pack:
                pack.status = PackStatus.FAILED
                pack.error_message = str(exc)
            await session.commit()
            raise


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [process_pack_job]
