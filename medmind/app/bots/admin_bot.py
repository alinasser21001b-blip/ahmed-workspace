"""MedMind IQ — Admin Telegram Bot."""

from __future__ import annotations

import logging

import httpx
from sqlalchemy import func, select
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

from app.core.config import settings
from app.core.constants import PaymentStatus
from app.db.session import SessionLocal
from app.models import PaymentRequest, StudyPack, User
from app.services.packs import confirm_payment

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API = settings.api_base_url.rstrip("/") + "/internal"


def is_admin(user_id: int) -> bool:
    return user_id in settings.admin_ids


async def pending_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("غير مصرّح.")
        return

    async with SessionLocal() as session:
        result = await session.execute(
            select(PaymentRequest)
            .where(PaymentRequest.status == PaymentStatus.PENDING)
            .order_by(PaymentRequest.created_at.desc())
            .limit(10)
        )
        requests = result.scalars().all()
        if not requests:
            await update.message.reply_text("✅ لا توجد طلبات معلّقة.")
            return

        for req in requests:
            user_result = await session.execute(select(User).where(User.id == req.user_id))
            user = user_result.scalar_one()
            short_id = str(req.id)[:8]
            keyboard = InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton("✅ تأكيد", callback_data=f"confirm_{req.id}"),
                        InlineKeyboardButton("❌ رفض", callback_data=f"reject_{req.id}"),
                    ]
                ]
            )
            await update.message.reply_text(
                f"#{short_id}\n"
                f"المستخدم: {user.telegram_id} @{user.telegram_username or '—'}\n"
                f"المبلغ: {req.amount_iqd:,} IQD\n"
                f"الطريقة: {req.method.value}",
                reply_markup=keyboard,
            )


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update.effective_user.id):
        await update.callback_query.answer("غير مصرّح.")
        return

    query = update.callback_query
    await query.answer()
    action, req_id = query.data.split("_", 1)

    async with SessionLocal() as session:
        if action == "confirm":
            req, error = await confirm_payment(session, request_id=req_id, admin_id=None)
            if error == "PAYMENT_ALREADY_CONFIRMED":
                await query.edit_message_text("⚠️ تم التأكيد مسبقاً.")
                return
            await session.commit()
            await query.edit_message_text(f"✅ تم تأكيد الدفع #{str(req.id)[:8]}")
        elif action == "reject":
            result = await session.execute(select(PaymentRequest).where(PaymentRequest.id == req_id))
            req = result.scalar_one_or_none()
            if req:
                req.status = PaymentStatus.REJECTED
                await session.commit()
            await query.edit_message_text(f"❌ تم رفض #{req_id[:8]}")


async def stats_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update.effective_user.id):
        return
    async with SessionLocal() as session:
        users = await session.execute(select(func.count()).select_from(User))
        packs = await session.execute(select(func.count()).select_from(StudyPack))
        pending = await session.execute(
            select(func.count()).select_from(PaymentRequest).where(PaymentRequest.status == PaymentStatus.PENDING)
        )
        await update.message.reply_text(
            f"📊 *إحصائيات MedMind IQ*\n\n"
            f"المستخدمون: {users.scalar_one()}\n"
            f"الحزم: {packs.scalar_one()}\n"
            f"دفعات معلّقة: {pending.scalar_one()}",
            parse_mode="Markdown",
        )


async def user_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update.effective_user.id) or not context.args:
        return
    tg_id = int(context.args[0])
    async with SessionLocal() as session:
        result = await session.execute(select(User).where(User.telegram_id == tg_id))
        user = result.scalar_one_or_none()
        if not user:
            await update.message.reply_text("المستخدم غير موجود.")
            return
        await update.message.reply_text(
            f"👤 {user.full_name}\n"
            f"ID: {user.telegram_id}\n"
            f"التخصص: {user.specialty.value}\n"
            f"محظور: {user.is_blocked}"
        )


def main() -> None:
    if not settings.admin_bot_token:
        raise SystemExit("ADMIN_BOT_TOKEN is required")

    app = Application.builder().token(settings.admin_bot_token).build()
    app.add_handler(CommandHandler("pending", pending_cmd))
    app.add_handler(CommandHandler("stats", stats_cmd))
    app.add_handler(CommandHandler("user", user_cmd))
    app.add_handler(CallbackQueryHandler(callback_handler, pattern="^(confirm|reject)_"))

    logger.info("Admin bot starting...")
    app.run_polling()


if __name__ == "__main__":
    main()
