import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from telegram import Bot

from app.core.config import settings
from app.core.constants import ArtifactType, JobStatus
from app.models import PackJob, StudyPack, User, UserSettings
from app.services.storage import storage


async def deliver_pack_to_telegram(session: AsyncSession, bot_token: str, pack: StudyPack, user: User) -> None:
    bot = Bot(token=bot_token)
    await bot.send_message(
        chat_id=user.telegram_id,
        text=f"✅ تم إعداد حزمتك: *{pack.title}*",
        parse_mode="Markdown",
    )
    for artifact in pack.artifacts:
        data = storage.download_bytes(artifact.storage_key)
        filename = artifact.storage_key.split("/")[-1]
        await bot.send_document(chat_id=user.telegram_id, document=data, filename=filename)


async def deliver_pack_to_email(pack: StudyPack, user: User) -> None:
    if not user.email or not settings.smtp_host:
        return
    settings_row = None
    msg = MIMEMultipart()
    msg["Subject"] = f"MedMind IQ — {pack.title}"
    msg["From"] = settings.email_from
    msg["To"] = user.email
    msg.attach(MIMEText(f"مرفق حزمة المراجعة: {pack.title}", "plain", "utf-8"))
    for artifact in pack.artifacts:
        if artifact.artifact_type in {ArtifactType.SUMMARY_PDF, ArtifactType.QUIZ_PDF, ArtifactType.ANKI_APKG}:
            data = storage.download_bytes(artifact.storage_key)
            part = MIMEApplication(data, Name=artifact.storage_key.split("/")[-1])
            part["Content-Disposition"] = f'attachment; filename="{artifact.storage_key.split("/")[-1]}"'
            msg.attach(part)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        if settings.smtp_user:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


async def process_delivery_job(session: AsyncSession, job: PackJob) -> None:
    result = await session.execute(
        select(StudyPack)
        .options(selectinload(StudyPack.artifacts))
        .where(StudyPack.id == job.study_pack_id)
    )
    pack = result.scalar_one()
    user_result = await session.execute(select(User).where(User.id == pack.user_id))
    user = user_result.scalar_one()
    settings_result = await session.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    user_settings = settings_result.scalar_one_or_none()

    if settings.student_bot_token:
        await deliver_pack_to_telegram(session, settings.student_bot_token, pack, user)
    if user_settings and user_settings.gmail_delivery_enabled:
        await deliver_pack_to_email(pack, user)

    job.status = JobStatus.COMPLETED
