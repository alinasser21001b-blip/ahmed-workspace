"""MedMind IQ — Student Telegram Bot."""

from __future__ import annotations

import logging
import uuid

import httpx
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from app.core.config import settings
from app.core.constants import SPECIALTY_LABELS
from app.core.guards import looks_like_medical_question

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API = settings.api_base_url.rstrip("/") + "/internal"

# Conversation states
CONSENT, SPECIALTY, YEAR, UNIVERSITY, EMAIL = range(5)
PACK_INPUT_TYPE, PACK_INPUT, PACK_CONFIRM = range(5, 8)
PAY_PLAN, PAY_METHOD, PAY_PROOF = range(8, 11)

BLOCKED_REPLY = (
    "🔒 MedMind IQ ينتج حزم مراجعة من محاضراتك — لا يجيب أسئلة طبية مباشرة.\n\n"
    "استخدم /newpack لإنشاء حزمة من موضوعك أو PDF محاضرتك."
)

DISCLAIMER = (
    "⚕️ *MedMind IQ* — أداة مراجعة دراسية.\n"
    "لا يقدّم تشخيصاً أو علاجاً. المحتوى للمراجعة الأكademية فقط.\n\n"
    "اضغط *أفهم وأوافق* للمتابعة."
)


async def api_client(method: str, path: str, **kwargs):
    async with httpx.AsyncClient(base_url=API, timeout=60.0) as client:
        response = await client.request(method, path, **kwargs)
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", {})
            except Exception:
                detail = {"message": response.text}
            raise RuntimeError(detail.get("error_code", "ERROR") + ": " + detail.get("message", ""))
        return response.json()


async def get_profile(update: Update) -> dict:
    tg_id = update.effective_user.id
    return await api_client("GET", f"/users/by-telegram/{tg_id}")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    tg_user = update.effective_user
    try:
        profile = await api_client(
            "POST",
            "/users/upsert",
            json={"telegram_id": tg_user.id, "username": tg_user.username, "full_name": tg_user.full_name},
        )
    except Exception as exc:
        await update.message.reply_text(f"خطأ في الاتصال: {exc}")
        return ConversationHandler.END

    context.user_data["profile"] = profile
    user = profile["user"]

    if user.get("consent_at"):
        await show_menu(update, context)
        return ConversationHandler.END

    keyboard = [[InlineKeyboardButton("✅ أفهم وأوافق", callback_data="consent_yes")]]
    await update.message.reply_text(DISCLAIMER, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return CONSENT


async def consent_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    user = context.user_data["profile"]["user"]
    await api_client("PATCH", f"/users/{user['id']}", json={"consent": True})

    buttons = [
        [InlineKeyboardButton(label, callback_data=f"spec_{spec.value}")]
        for spec, label in SPECIALTY_LABELS.items()
    ]
    await query.edit_message_text("اختر تخصصك:", reply_markup=InlineKeyboardMarkup(buttons))
    return SPECIALTY


async def specialty_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    spec = query.data.replace("spec_", "")
    context.user_data["specialty"] = spec
    years = [[InlineKeyboardButton(str(y), callback_data=f"year_{y}") for y in range(1, 5)]]
    years.append([InlineKeyboardButton(str(y), callback_data=f"year_{y}") for y in range(5, 8)])
    await query.edit_message_text("اختر السنة الدراسية:", reply_markup=InlineKeyboardMarkup(years))
    return YEAR


async def year_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data["study_year"] = int(query.data.replace("year_", ""))
    await query.edit_message_text("أدخل اسم الجامعة (أو اكتب - للتخطي):")
    return UNIVERSITY


async def university_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    uni = update.message.text.strip()
    context.user_data["university"] = None if uni == "-" else uni
    await update.message.reply_text("أدخل بريد Gmail (أو - للتخطي):")
    return EMAIL


async def email_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    email = update.message.text.strip()
    user = context.user_data["profile"]["user"]
    payload = {
        "specialty": context.user_data["specialty"],
        "study_year": context.user_data["study_year"],
        "university": context.user_data.get("university"),
        "email": None if email == "-" else email,
        "consent": True,
    }
    await api_client("PATCH", f"/users/{user['id']}", json=payload)
    await update.message.reply_text("✅ تم إعداد حسابك!")
    await show_menu(update, context)
    return ConversationHandler.END


async def show_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    keyboard = [
        [
            InlineKeyboardButton("📦 حزمة جديدة", callback_data="menu_newpack"),
            InlineKeyboardButton("📚 مكتبتي", callback_data="menu_library"),
        ],
        [
            InlineKeyboardButton("💳 الاشتراك", callback_data="menu_sub"),
            InlineKeyboardButton("💰 الدفع", callback_data="menu_pay"),
        ],
        [InlineKeyboardButton("⚙️ الإعدادات", callback_data="menu_settings")],
    ]
    text = "📋 *القائمة الرئيسية*\n\n/newpack — حزمة جديدة\n/library — مكتبتي\n/pay — الدفع\n/help — مساعدة"
    target = update.callback_query.message if update.callback_query else update.message
    if update.callback_query:
        await update.callback_query.answer()
        await target.edit_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await target.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")


async def menu_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    action = query.data.replace("menu_", "")
    if action == "newpack":
        return await newpack_start(update, context)
    if action == "library":
        await library_cmd(update, context)
        return ConversationHandler.END
    if action == "sub":
        await subscription_cmd(update, context)
        return ConversationHandler.END
    if action == "pay":
        return await pay_start(update, context)
    await query.edit_message_text("الإعدادات: استخدم /settings")
    return ConversationHandler.END


async def newpack_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    keyboard = [
        [InlineKeyboardButton("📄 PDF", callback_data="input_pdf")],
        [InlineKeyboardButton("📝 نص", callback_data="input_text")],
        [InlineKeyboardButton("📚 اسم موضوع", callback_data="input_topic")],
    ]
    msg = update.callback_query.message if update.callback_query else update.message
    if update.callback_query:
        await update.callback_query.answer()
        await msg.edit_text("اختر نوع المدخل:", reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await msg.reply_text("اختر نوع المدخل:", reply_markup=InlineKeyboardMarkup(keyboard))
    return PACK_INPUT_TYPE


async def pack_input_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data["input_type"] = query.data.replace("input_", "")
    prompts = {
        "pdf": "أرسل ملف PDF (حتى 20MB):",
        "text": "الصق النص:",
        "topic": "اكتب اسم الموضوع (مثال: Cardiovascular Physiology):",
    }
    await query.edit_message_text(prompts[context.user_data["input_type"]])
    return PACK_INPUT


async def pack_input_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    profile = await get_profile(update)
    user = profile["user"]
    input_type = context.user_data["input_type"]
    title = None
    input_text = None
    storage_key = None

    if input_type == "pdf":
        doc = update.message.document
        if not doc or not doc.file_name.lower().endswith(".pdf"):
            await update.message.reply_text("يرجى إرسال ملف PDF.")
            return PACK_INPUT
        file = await doc.get_file()
        data = await file.download_as_bytearray()
        files = {"file": ("lecture.pdf", bytes(data), "application/pdf")}
        upload = await api_client("POST", f"/files/upload?user_id={user['id']}", files=files)
        storage_key = upload["storage_key"]
        title = doc.file_name.replace(".pdf", "")
    else:
        input_text = update.message.text.strip()
        title = input_text[:120] if input_type == "topic" else title or "Study Pack"

    context.user_data["pack_payload"] = {
        "user_id": user["id"],
        "input_type": input_type if input_type != "topic" else "topic",
        "input_storage_key": storage_key,
        "input_text": input_text if input_type != "pdf" else None,
        "title": title or input_text or "Study Pack",
    }
    keyboard = [
        [
            InlineKeyboardButton("✅ تأكيد", callback_data="pack_confirm"),
            InlineKeyboardButton("❌ إلغاء", callback_data="pack_cancel"),
        ]
    ]
    await update.message.reply_text(
        f"سيتم إنشاء حزمة كاملة:\n📄 Summary\n🗺️ MindMap\n🔑 Keywords\n❓ Quiz\n🃏 Anki\n\nالموضوع: *{context.user_data['pack_payload']['title']}*",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return PACK_CONFIRM


async def pack_confirm_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if query.data == "pack_cancel":
        await query.edit_message_text("تم الإلغاء.")
        return ConversationHandler.END

    payload = context.user_data.get("pack_payload")
    if not payload:
        await query.edit_message_text("انتهت الجلسة. استخدم /newpack")
        return ConversationHandler.END

    try:
        result = await api_client(
            "POST",
            "/packs",
            json=payload,
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        await query.edit_message_text("⏳ جاري التحضير... (~3-5 دقائق)\nسنرسل الملفات هنا عند الانتهاء.")
    except RuntimeError as exc:
        if "SUBSCRIPTION_REQUIRED" in str(exc):
            await query.edit_message_text("⚠️ تحتاج اشتراكاً فعّالاً.\nاستخدم /pay للاشتراك.")
        elif "QUOTA_EXCEEDED" in str(exc):
            await query.edit_message_text("⚠️ استنفدت حد الحزم الشهري.\nاستخدم /pay للترقية.")
        else:
            await query.edit_message_text(f"خطأ: {exc}")
    return ConversationHandler.END


async def library_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    profile = await get_profile(update)
    user = profile["user"]
    data = await api_client("GET", f"/users/{user['id']}/packs?limit=10")
    packs = data.get("packs", [])
    if not packs:
        await (update.message or update.callback_query.message).reply_text("📚 مكتبتك فارغة. استخدم /newpack")
        return
    lines = []
    for p in packs:
        status_icon = "✅" if p["status"] == "completed" else "⏳" if p["status"] in {"queued", "processing"} else "❌"
        lines.append(f"{status_icon} {p['title']} — {p['status']}")
    await (update.message or update.callback_query.message).reply_text("📚 *مكتبتك:*\n" + "\n".join(lines), parse_mode="Markdown")


async def subscription_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    profile = await get_profile(update)
    sub = profile.get("subscription")
    msg = update.message or update.callback_query.message
    if not sub:
        await msg.reply_text("لا يوجد اشتراك فعّال.\nاستخدم /pay")
        return
    plan = sub["plan"]
    limit = plan["packs_per_month"]
    limit_text = "غير محدود" if limit == 0 else str(limit)
    await msg.reply_text(
        f"💳 *{plan['name_ar']}*\n"
        f"الحالة: {sub['status']}\n"
        f"ينتهي: {sub.get('expires_at', '—')}\n"
        f"الحزم: {profile['packs_used']}/{limit_text}",
        parse_mode="Markdown",
    )


async def pay_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    keyboard = [
        [InlineKeyboardButton("أساسي — 5,000", callback_data="plan_basic")],
        [InlineKeyboardButton("احترافي — 12,000", callback_data="plan_pro")],
        [InlineKeyboardButton("شامل — 20,000", callback_data="plan_ultimate")],
    ]
    msg = update.callback_query.message if update.callback_query else update.message
    if update.callback_query:
        await update.callback_query.answer()
        await msg.edit_text("اختر الباقة:", reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await msg.reply_text("اختر الباقة:", reply_markup=InlineKeyboardMarkup(keyboard))
    return PAY_PLAN


async def pay_plan_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data["plan_code"] = query.data.replace("plan_", "")
    keyboard = [
        [InlineKeyboardButton("ZainCash", callback_data="method_zaincash")],
        [InlineKeyboardButton("تحويل بنكي", callback_data="method_bank_transfer")],
    ]
    await query.edit_message_text("اختر طريقة الدفع:", reply_markup=InlineKeyboardMarkup(keyboard))
    return PAY_METHOD


async def pay_method_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    method = query.data.replace("method_", "")
    profile = await get_profile(update)
    result = await api_client(
        "POST",
        "/payments/request",
        json={"user_id": profile["user"]["id"], "plan_code": context.user_data["plan_code"], "method": method},
    )
    await query.edit_message_text(result["instructions"] + "\n\n📸 أرسل صورة الإيصال الآن:")
    context.user_data["payment_id"] = result["id"]
    return PAY_PROOF


async def pay_proof_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text("✅ تم استلام طلب الدفع.\n⏳ بانتظار تأكيد الإدارة (عادة خلال ساعات).")
    return ConversationHandler.END


async def free_text_guard(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if looks_like_medical_question(update.message.text):
        await update.message.reply_text(BLOCKED_REPLY)


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "📖 *MedMind IQ*\n\n"
        "/newpack — إنشاء حزمة دراسية\n"
        "/library — مكتبتك\n"
        "/pay — الاشتراك\n"
        "/subscription — حالة الاشتراك\n"
        "/menu — القائمة\n\n"
        "⚠️ لا نجيب أسئلة طبية مباشرة.",
        parse_mode="Markdown",
    )


def main() -> None:
    if not settings.student_bot_token:
        raise SystemExit("STUDENT_BOT_TOKEN is required")

    app = (
        Application.builder()
        .token(settings.student_bot_token)
        .build()
    )

    onboarding = ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            CONSENT: [CallbackQueryHandler(consent_handler, pattern="^consent_")],
            SPECIALTY: [CallbackQueryHandler(specialty_handler, pattern="^spec_")],
            YEAR: [CallbackQueryHandler(year_handler, pattern="^year_")],
            UNIVERSITY: [MessageHandler(filters.TEXT & ~filters.COMMAND, university_handler)],
            EMAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, email_handler)],
        },
        fallbacks=[CommandHandler("menu", show_menu)],
    )

    newpack_conv = ConversationHandler(
        entry_points=[CommandHandler("newpack", newpack_start), CallbackQueryHandler(newpack_start, pattern="^menu_newpack")],
        states={
            PACK_INPUT_TYPE: [CallbackQueryHandler(pack_input_type, pattern="^input_")],
            PACK_INPUT: [
                MessageHandler(filters.Document.PDF, pack_input_handler),
                MessageHandler(filters.TEXT & ~filters.COMMAND, pack_input_handler),
            ],
            PACK_CONFIRM: [CallbackQueryHandler(pack_confirm_handler, pattern="^pack_")],
        },
        fallbacks=[CommandHandler("menu", show_menu)],
    )

    pay_conv = ConversationHandler(
        entry_points=[CommandHandler("pay", pay_start), CallbackQueryHandler(pay_start, pattern="^menu_pay")],
        states={
            PAY_PLAN: [CallbackQueryHandler(pay_plan_handler, pattern="^plan_")],
            PAY_METHOD: [CallbackQueryHandler(pay_method_handler, pattern="^method_")],
            PAY_PROOF: [MessageHandler(filters.PHOTO | filters.Document.ALL, pay_proof_handler)],
        },
        fallbacks=[],
    )

    app.add_handler(onboarding)
    app.add_handler(newpack_conv)
    app.add_handler(pay_conv)
    app.add_handler(CommandHandler("menu", show_menu))
    app.add_handler(CommandHandler("library", library_cmd))
    app.add_handler(CommandHandler("subscription", subscription_cmd))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CallbackQueryHandler(menu_handler, pattern="^menu_"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, free_text_guard))

    logger.info("Student bot starting...")
    app.run_polling()


if __name__ == "__main__":
    main()
