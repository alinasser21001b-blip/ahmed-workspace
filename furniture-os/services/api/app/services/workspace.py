"""Owner-facing workspace projections — AI stays invisible.

Inspired by WhatsApp + Missive/Front (enriched inbox, not tickets)
and Pinterest/Houzz (visual discovery, not BI).
"""

from __future__ import annotations

import hashlib
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.graph import GraphPort
from production.service import ProductionService

from app.db.models import DomainEvent, MediaAsset


ROLE_HINTS = {
    "carpenter": ("نجّار", "🪵"),
    "نجار": ("نجّار", "🪵"),
    "upholstery": ("تنجيد", "🛋️"),
    "نجاد": ("تنجيد", "🛋️"),
    "upholster": ("تنجيد", "🛋️"),
    "paint": ("دهان", "🎨"),
    "دهان": ("دهان", "🎨"),
    "wood": ("أخشاب", "🌲"),
    "خشب": ("أخشاب", "🌲"),
    "supplier": ("مورد", "📦"),
    "workshop": ("ورشة", "🏭"),
    "ورشة": ("ورشة", "🏭"),
}


class WorkspaceService:
    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID):
        self.session = session
        self.tenant_id = tenant_id
        self.graph = GraphPort(session, tenant_id)
        self.production = ProductionService(session, tenant_id)

    async def conversations(self, filter_mode: str = "all") -> list[dict[str, Any]]:
        events = list(
            (
                await self.session.execute(
                    select(DomainEvent)
                    .where(DomainEvent.tenant_id == self.tenant_id)
                    .order_by(DomainEvent.occurred_at.desc())
                    .limit(3000)
                )
            ).scalars().all()
        )
        decisions = await self.production.decisions_inbox(limit=200)
        by_conv = self._group_events(events)

        workshops = {
            str(n.id): n for n in await self.graph.find_nodes(node_type="Workshop", limit=200)
        }
        workshops_by_key = {(n.external_key or "").replace("wa:", ""): n for n in workshops.values()}
        pieces = await self.graph.find_nodes(node_type="FurniturePiece", limit=100)

        cards: list[dict[str, Any]] = []
        for key, evs in by_conv.items():
            evs_sorted = _sorted_events(evs)
            last = evs_sorted[-1]
            workshop = workshops_by_key.get(key)
            workshop_id = str(workshop.id) if workshop else None
            name = (workshop.name if workshop else None) or (last.payload or {}).get("sender_name") or key
            role, role_icon = _infer_role(name)

            pending = _match_decisions(decisions, workshop_id, name, key)
            waiting_hours = _max_waiting_hours(pending, last)
            stage = _infer_stage(evs_sorted, pieces, name)
            media_count, media_insights, sample_previews = await self._media_for_events(evs_sorted)

            summary = _conversation_summary(name, pending, (last.payload or {}).get("text") or "", stage)
            memory_note = next((p.get("memory_warning") for p in pending if p.get("memory_warning")), None)
            urgency = "high" if pending else ("watch" if waiting_hours and waiting_hours > 12 else "normal")

            status_line = _status_line(pending, stage, waiting_hours, media_insights)

            cards.append(
                {
                    "id": key,
                    "name": name,
                    "avatar_seed": hashlib.md5(name.encode()).hexdigest()[:6],
                    "role": role,
                    "role_icon": role_icon,
                    "last_message": ((last.payload or {}).get("text") or "")[:160]
                    or ("📎 مرفق" if media_count else ""),
                    "last_at": last.occurred_at.isoformat() if last.occurred_at else None,
                    "message_count": len(evs_sorted),
                    "urgency": urgency,
                    "pending_count": len(pending),
                    "pending_decisions": [
                        {
                            "id": p["id"],
                            "label": _human_decision_label(p),
                            "type": p.get("type"),
                            "memory_note": p.get("memory_warning"),
                            "waiting_hours": p.get("delay_hours"),
                        }
                        for p in pending
                    ],
                    "summary": summary,
                    "status_line": status_line,
                    "stage": stage,
                    "waiting_hours": waiting_hours,
                    "memory_note": memory_note,
                    "media_count": media_count,
                    "media_insights": media_insights,
                    "sample_previews": sample_previews,
                    "workshop_id": workshop_id,
                    "progress": _progress_steps(stage),
                    "pinned": urgency == "high",
                }
            )

        high = [c for c in cards if c["urgency"] == "high"]
        watch = [c for c in cards if c["urgency"] == "watch"]
        rest = [c for c in cards if c["urgency"] == "normal"]
        for group in (high, watch, rest):
            group.sort(key=lambda c: c.get("last_at") or "", reverse=True)
        ordered = high + watch + rest

        if filter_mode == "needs_you":
            return [c for c in ordered if c["pending_count"] > 0]
        if filter_mode == "waiting":
            return [c for c in ordered if (c.get("waiting_hours") or 0) >= 3]
        if filter_mode == "media":
            return [c for c in ordered if c["media_count"] > 0]
        return ordered

    async def conversation_thread(self, conversation_id: str) -> dict[str, Any]:
        cards = await self.conversations()
        card = next((c for c in cards if c["id"] == conversation_id), None)

        all_events = list(
            (
                await self.session.execute(
                    select(DomainEvent)
                    .where(DomainEvent.tenant_id == self.tenant_id)
                    .order_by(DomainEvent.occurred_at.asc())
                )
            ).scalars().all()
        )
        grouped = self._group_events(all_events)
        events = grouped.get(conversation_id) or []

        messages = []
        day_cursor = None
        for e in _sorted_events(events):
            payload = e.payload or {}
            sender = payload.get("sender_name") or e.participant_key or "Unknown"
            is_owner = sender.lower() in {"owner", "me"} or sender == "Owner"
            day = e.occurred_at.date().isoformat() if e.occurred_at else None
            show_day = day != day_cursor
            day_cursor = day

            media = list(
                (await self.session.execute(select(MediaAsset).where(MediaAsset.event_id == e.id))).scalars().all()
            )
            messages.append(
                {
                    "id": str(e.id),
                    "from": sender,
                    "is_mine": is_owner,
                    "text": payload.get("text") or "",
                    "at": e.occurred_at.isoformat() if e.occurred_at else None,
                    "day_separator": _arabic_day(e.occurred_at) if show_day and e.occurred_at else None,
                    "media": [
                        {
                            "id": str(m.id),
                            "kind": m.kind,
                            "insight": _human_media_insight(m.dna or {}) if m.dna else None,
                            "transcript": m.transcript,
                            "swatch": _swatch_from_dna(m.dna or {}),
                        }
                        for m in media
                    ],
                }
            )

        # Related market designs for silent "see also" inside chat (no tech jargon)
        related = []
        if card and (card.get("media_insights") or card.get("stage")):
            feed = await self.market_feed(limit=40)
            related = feed["pins"][:3]

        return {
            "conversation": card
            or {"id": conversation_id, "name": conversation_id, "summary": None, "pending_decisions": []},
            "messages": messages,
            "related_designs": related,
            "composer_hints": _composer_hints(card),
        }

    async def brief(self) -> dict[str, Any]:
        summary = await self.production.hourly_summary(hours=24)
        decisions = await self.production.decisions_inbox(limit=20)
        cards = await self.conversations()
        needs = [c for c in cards if c["pending_count"] > 0]
        return {
            "waiting_on_you": len(needs),
            "open_decisions": len(decisions),
            "active_chats": len(cards),
            "headline": _brief_headline(needs),
            "subline": _brief_subline(cards, summary),
            "focus": [
                {"id": c["id"], "name": c["name"], "reason": c["status_line"] or c["summary"]}
                for c in needs[:3]
            ],
            "tips": (summary.get("production_updates") or [])[:3],
        }

    async def market_feed(self, limit: int = 60, region: str | None = None, q: str | None = None) -> dict[str, Any]:
        media = list(
            (
                await self.session.execute(
                    select(MediaAsset)
                    .where(MediaAsset.tenant_id == self.tenant_id, MediaAsset.kind == "image")
                    .order_by(desc(MediaAsset.created_at))
                    .limit(limit)
                )
            ).scalars().all()
        )
        dna_nodes = await self.graph.find_nodes(node_type="DesignDNA", limit=limit)

        pins: list[dict[str, Any]] = []
        for m in media:
            dna = m.dna or {}
            pins.append(_pin_from_dna(f"media-{m.id}", dna, origin="من إنتاجك", region="مصر", seed=str(m.id)))

        for n in dna_nodes:
            dna = (n.properties or {}).get("dna") or n.properties or {}
            pins.append(
                _pin_from_dna(f"dna-{n.id}", dna, origin="مكتبة التصاميم", region="مصر", seed=str(n.id), title=n.name)
            )

        pins.extend(_demo_market_pins(max(36, limit)))

        # Deduplicate by title+subtitle
        seen = set()
        unique = []
        for p in pins:
            k = (p["title"], p["subtitle"], p["region"])
            if k in seen:
                continue
            seen.add(k)
            unique.append(p)

        if region in {"مصر", "تركيا"}:
            unique = [p for p in unique if p["region"] == region]
        if q:
            ql = q.strip().lower()
            unique = [
                p
                for p in unique
                if ql in p["title"].lower()
                or ql in (p.get("subtitle") or "").lower()
                or any(ql in t.lower() for t in p.get("tags") or [])
            ]

        boards = [
            {"id": "gold", "title": "ذهبي كلاسيك", "count": sum(1 for p in unique if "ذهبي" in p["title"] or "gold" in " ".join(p["tags"]).lower())},
            {"id": "damietta", "title": "دمياطي أصيل", "count": sum(1 for p in unique if p["region"] == "مصر")},
            {"id": "turkish", "title": "تركي فاخر", "count": sum(1 for p in unique if p["region"] == "تركيا")},
            {"id": "bedroom", "title": "غرف نوم", "count": sum(1 for p in unique if "نوم" in p["title"] or "bedroom" in " ".join(p["tags"]).lower())},
        ]

        trend = {
            "whisper": "هذا الأسبوع يزداد التطعيم الذهبي والبيج في غرف النوم — دمياط تقلّد خطوط إسطنبول بهدوء.",
            "rising": ["تطعيم ذهبي", "تنجيد بيج", "كنب منحني", "تاج مكسور"],
            "falling": ["دهانات لامعة ثقيلة"],
            "from": ["دمياط", "إسطنبول", "بورصة"],
            "story": "مصنع في بورصة نشر غرفة نوم منحنية قبل أسبوعين؛ نسخ مشابهة ظهرت في ثلاث ورش دمياطية.",
        }

        return {"pins": unique[:limit], "boards": boards, "trend": trend}

    async def market_pin(self, pin_id: str) -> dict[str, Any]:
        feed = await self.market_feed(limit=80)
        pin = next((p for p in feed["pins"] if p["id"] == pin_id), None)
        if not pin:
            return {"ok": False}
        related = [p for p in feed["pins"] if p["id"] != pin_id and _overlap_tags(pin, p)][:6]
        workshops = await self.graph.find_nodes(node_type="Workshop", limit=10)
        local_match = None
        if workshops:
            local_match = {
                "name": workshops[0].name,
                "note": f"يوجد تنفيذ قريب عند {workshops[0].name} — راجع المحادثة إن أردت نفس الروح.",
            }
        return {"ok": True, "pin": pin, "related": related, "local_match": local_match, "trend": feed["trend"]}

    def _group_events(self, events: list[DomainEvent]) -> dict[str, list[DomainEvent]]:
        by_conv: dict[str, list[DomainEvent]] = defaultdict(list)
        last_other: Optional[str] = None
        for e in _sorted_events(events):
            sender = ((e.payload or {}).get("sender_name") or e.participant_key or "").strip()
            is_owner = sender.lower() in {"owner", "me"} or sender == "Owner"
            if is_owner:
                key = last_other or e.conversation_key or "owner"
            else:
                key = e.participant_key or sender or e.conversation_key or "unknown"
                last_other = key
            by_conv[key].append(e)
        return by_conv

    async def _media_for_events(self, evs: list[DomainEvent]) -> tuple[int, list[str], list[dict[str, Any]]]:
        event_ids = [e.id for e in evs]
        if not event_ids:
            return 0, [], []
        media_rows = list(
            (
                await self.session.execute(
                    select(MediaAsset).where(
                        MediaAsset.tenant_id == self.tenant_id,
                        MediaAsset.event_id.in_(event_ids),
                    )
                )
            ).scalars().all()
        )
        insights = [_human_media_insight(m.dna or {}) for m in media_rows if m.dna][:3]
        previews = [
            {
                "id": str(m.id),
                "kind": m.kind,
                "swatch": _swatch_from_dna(m.dna or {}),
                "insight": _human_media_insight(m.dna or {}) if m.dna else None,
            }
            for m in media_rows[:4]
        ]
        return len(media_rows), insights, previews


def _sorted_events(evs: list[DomainEvent]) -> list[DomainEvent]:
    def key(x: DomainEvent):
        if x.occurred_at and x.occurred_at.tzinfo:
            return x.occurred_at
        if x.occurred_at:
            return x.occurred_at.replace(tzinfo=timezone.utc)
        return datetime(1970, 1, 1, tzinfo=timezone.utc)

    return sorted(evs, key=key)


def _match_decisions(decisions, workshop_id, name, key):
    open_for = []
    for d in decisions:
        if d.get("workshop_id") and d.get("workshop_id") == workshop_id:
            open_for.append(d)
        elif name and name in (d.get("subject") or ""):
            open_for.append(d)
        elif key and key in (d.get("subject") or ""):
            open_for.append(d)
    # unique by id
    seen = set()
    out = []
    for d in open_for:
        if d["id"] in seen:
            continue
        seen.add(d["id"])
        out.append(d)
    return out[:5]


def _infer_role(name: str) -> tuple[str, str]:
    lower = name.lower()
    for needle, pair in ROLE_HINTS.items():
        if needle in lower or needle in name:
            return pair
    return ("شريك إنتاج", "🤝")


def _infer_stage(evs, pieces, name) -> Optional[str]:
    text = " ".join(((e.payload or {}).get("text") or "") for e in evs[-8:])
    mapping = [
        ("تنجيد", "تنجيد"),
        ("دهان", "دهان"),
        ("طلاء", "دهان"),
        ("حفر", "حفر"),
        ("قطع", "نجارة"),
        ("خشب", "نجارة"),
        ("تشطيب", "تشطيب"),
        ("عينة", "مراجعة عينة"),
        ("موافقة", "بانتظار موافقة"),
    ]
    for needle, stage in mapping:
        if needle in text:
            return stage
    for p in pieces:
        if name.split()[0] in (p.name or ""):
            return (p.properties or {}).get("stage") or p.status
    return None


def _progress_steps(stage: Optional[str]) -> list[dict[str, Any]]:
    steps = ["تصميم", "نجارة", "حفر", "دهان", "تنجيد", "تشطيب"]
    current = None
    aliases = {
        "wood": "نجارة",
        "carving": "حفر",
        "painting": "دهان",
        "upholstery": "تنجيد",
        "finishing": "تشطيب",
        "مراجعة عينة": "تصميم",
        "بانتظار موافقة": "تصميم",
    }
    if stage:
        current = aliases.get(stage, stage)
    out = []
    hit = False
    for s in steps:
        active = current == s
        if active:
            hit = True
        out.append({"label": s, "state": "done" if current and not hit and not active else ("current" if active else "todo")})
        if active:
            hit = True
    if current and not any(s["state"] == "current" for s in out):
        # soft mark nearest
        out[0]["state"] = "current"
    return out


def _max_waiting_hours(pending, last_event) -> Optional[float]:
    hours = []
    for p in pending:
        if p.get("delay_hours") is not None:
            hours.append(float(p["delay_hours"]))
    if last_event and last_event.occurred_at:
        occ = last_event.occurred_at
        if occ.tzinfo is None:
            occ = occ.replace(tzinfo=timezone.utc)
        hours.append(round((datetime.now(timezone.utc) - occ).total_seconds() / 3600, 1))
    return max(hours) if hours else None


def _status_line(pending, stage, waiting_hours, media_insights) -> str:
    if pending:
        return _human_decision_label(pending[0])
    if media_insights:
        return f"مرفق مفهوم: {media_insights[0]}"
    if stage:
        wait = f" · منذ {int(waiting_hours)}س" if waiting_hours and waiting_hours >= 1 else ""
        return f"المرحلة الحالية: {stage}{wait}"
    if waiting_hours and waiting_hours >= 6:
        return f"صامت منذ {int(waiting_hours)} ساعة"
    return "محادثة نشطة"


def _conversation_summary(name: str, pending: list[dict], last_text: str, stage: Optional[str]) -> str:
    if pending:
        labels = "، ".join(_human_decision_label(p) for p in pending[:2])
        return f"{labels}."
    if stage:
        return f"يعمل على مرحلة {stage}."
    if last_text:
        return last_text[:110]
    return "لا قرارات معلّقة."


def _human_decision_label(p: dict[str, Any]) -> str:
    t = p.get("type") or "review"
    mapping = {
        "approve": "بانتظار موافقتك",
        "reject": "مرفوض — يحتاج قرار بديل",
        "review": "عينة تحتاج مراجعتك",
        "delay": "تأخير يحتاج تدخلك",
        "start": "جاهز لبدء التنفيذ",
        "confirm": "يحتاج تأكيد المقاسات",
    }
    return mapping.get(t, "يحتاج قرارك")


def _human_media_insight(dna: dict[str, Any]) -> str:
    ft = str(dna.get("furniture_type") or "قطعة").replace("_", " ")
    style = str(dna.get("style_family") or "").replace("_", " ")
    bits = [ft]
    if style and style != "unknown":
        bits.append(style)
    if dna.get("carving_type"):
        bits.append(f"حفر {dna['carving_type']}")
    if dna.get("fabric_family"):
        bits.append(str(dna["fabric_family"]))
    if dna.get("stage") and dna["stage"] != "unknown":
        bits.append(f"مرحلة {str(dna['stage']).replace('_', ' ')}")
    return " · ".join(bits)


def _swatch_from_dna(dna: dict[str, Any]) -> dict[str, str]:
    colors = dna.get("colorway") or dna.get("colors") or ["beige", "walnut"]
    palette = {
        "gold": "#c4a574",
        "beige": "#d9c3a5",
        "white": "#ece4d8",
        "walnut": "#6b4a2e",
        "cream": "#f0e6d4",
        "green": "#3d4a3a",
    }
    c1 = palette.get(str(colors[0]).lower(), "#8a7349") if colors else "#8a7349"
    c2 = palette.get(str(colors[1]).lower(), "#2a2420") if len(colors) > 1 else "#2a2420"
    return {"from": c1, "to": c2}


def _brief_headline(needs: list[dict[str, Any]]) -> str:
    if not needs:
        return "يوم هادئ — لا أحد ينتظر موافقتك الآن"
    if len(needs) == 1:
        return f"{needs[0]['name']} ينتظر قرارك"
    return f"{len(needs)} ورش تنتظر قرارك الآن"


def _brief_subline(cards: list[dict[str, Any]], summary: dict[str, Any]) -> str:
    stages = [c.get("stage") for c in cards if c.get("stage")]
    if stages:
        return f"على الأرض الآن: { '، '.join(list(dict.fromkeys(stages))[:3]) }"
    tips = summary.get("production_updates") or []
    return tips[0] if tips else "تابع المحادثات حسب الأولوية"


def _composer_hints(card: Optional[dict[str, Any]]) -> list[str]:
    if not card:
        return ["تمام، ابعت الصورة", "موافق — كمّل", "عدّل المقاس وراجعني"]
    if card.get("pending_count"):
        return ["موافق على العينة", "مرفوض — غيّر القماش", "ابعت صورة أوضح للتاج"]
    if card.get("stage") == "تنجيد":
        return ["كمّل التنجيد", "راجع الحشو قبل التقفيل", "ابعت فيديو سريع"]
    return ["تمام", "راجعني لما تخلّص", "ابعت صورة المرحلة"]


def _arabic_day(dt: datetime) -> str:
    today = datetime.now(timezone.utc).date()
    d = dt.date() if dt.tzinfo else dt.replace(tzinfo=timezone.utc).date()
    if d == today:
        return "اليوم"
    if (today - d).days == 1:
        return "أمس"
    return dt.strftime("%d/%m/%Y")


def _pin_from_dna(pid, dna, origin, region, seed, title=None):
    h = int(hashlib.md5(seed.encode()).hexdigest()[:6], 16)
    return {
        "id": pid,
        "title": title or _pin_title(dna),
        "subtitle": _pin_subtitle(dna),
        "tags": _pin_tags(dna),
        "origin": origin,
        "region": region,
        "height": 210 + (h % 170),
        "color": _pin_color(dna),
        "color2": _swatch_from_dna(dna)["to"],
        "pattern": ["carved", "tufted", "plain", "floral"][h % 4],
        "insight": _human_media_insight(dna) if dna else None,
        "similar_note": " منتشر هذا الأسبوع في دمياط" if h % 5 == 0 else None,
        "is_new": h % 7 == 0,
        "likes": 12 + (h % 90),
    }


def _pin_title(dna: dict[str, Any]) -> str:
    ft = str(dna.get("furniture_type") or "تصميم أثاث").replace("_", " ")
    style = str(dna.get("style_family") or "").replace("_", " ")
    return f"{ft} {style}".strip().title()


def _pin_subtitle(dna: dict[str, Any]) -> str:
    bits = []
    for k in ("wood_species", "fabric_family", "crown_shape", "carving_type"):
        if dna.get(k):
            bits.append(str(dna[k]).replace("_", " "))
    return " · ".join(bits[:3]) if bits else "تصميم كلاسيكي"


def _pin_tags(dna: dict[str, Any]) -> list[str]:
    tags = []
    for k in ("style_family", "furniture_type", "fabric_family", "wood_species"):
        v = dna.get(k)
        if v and v != "unknown":
            tags.append(str(v).replace("_", " "))
    for c in (dna.get("colorway") or dna.get("colors") or [])[:2]:
        tags.append(str(c))
    return tags[:5]


def _pin_color(dna: dict[str, Any]) -> str:
    return _swatch_from_dna(dna)["from"]


def _overlap_tags(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return bool(set(a.get("tags") or []) & set(b.get("tags") or [])) or a.get("region") == b.get("region")


def _demo_market_pins(n: int) -> list[dict[str, Any]]:
    catalog = [
        ("غرفة نوم دمياطي تاج مكسور", "زان · حفر كثيف · بيج", ["دمياط", "bedroom", "تاج"], "مصر", "#3d4a3a", "carved"),
        ("سفرة تركي فاخر ذهبية", "تطعيم ذهبي · مخمل بيج", ["تركيا", "luxury", "gold"], "تركيا", "#5c3d2e", "tufted"),
        ("كنبة فرنسي كابريول", "أرجل منحنية · حفر ناعم", ["فرنسي", "salon"], "مصر", "#8a7349", "carved"),
        ("صالون ملكي أخضر", "قطيفة · تاج عريض", ["royal", "salon"], "تركيا", "#4a3a5c", "tufted"),
        ("كونسول نيو كلاسيك", "مرآة · ذهب خفيف", ["console"], "مصر", "#6b5a45", "plain"),
        ("غرفة نوم تركي منحنية", "سرير منحني · كتان", ["bedroom"], "تركيا", "#7a5a40", "plain"),
        ("طاولة قهوة محفورة", "بلوط · نقش زهري", ["carving"], "مصر", "#4a3a28", "floral"),
        ("أنتريه حديث كلاسيك", "خطوط ناعمة · كتان رمادي", ["modern classic"], "تركيا", "#5a5648", "plain"),
        ("دولاب دمياطي مذهب", "مقابض ذهبية · تاج", ["wardrobe"], "مصر", "#3a4538", "carved"),
        ("كرسي لويس مخملي", "حفر فرنسي · خمري", ["chair", "french"], "مصر", "#8a6a4a", "tufted"),
        ("سفرة بيضاء ذهبية", "رخام صناعي · تنجيد", ["dining"], "تركيا", "#d4c4a8", "plain"),
        ("مرايا صالون محفورة", "إطار فرنسي", ["mirror"], "مصر", "#6a5a4a", "carved"),
        ("غرفة سفرة دمياط 2026", "كرسي عالي الظهر", ["dining", "دمياط"], "مصر", "#524536", "carved"),
        ("كنب تركي زاوية", "إسفنج كثيف · بيج دافئ", ["sofa"], "تركيا", "#9a7a55", "tufted"),
        ("كومودينو مذهب", "درج مخفي · نقش", ["bedroom"], "مصر", "#7a6248", "floral"),
        ("طقم ملكي كامل", "كنب + شايز · أخضر زيتوني", ["royal"], "تركيا", "#3f4a38", "tufted"),
    ]
    pins = []
    for i in range(n):
        title, subtitle, tags, region, color, pattern = catalog[i % len(catalog)]
        pins.append(
            {
                "id": f"market-demo-{i}-{region}",
                "title": title,
                "subtitle": subtitle,
                "tags": tags,
                "origin": "مصنع في " + ("دمياط" if region == "مصر" else "بورصة"),
                "region": region,
                "height": 200 + ((i * 47) % 180),
                "color": color,
                "color2": "#1a1612",
                "pattern": pattern,
                "insight": f"{title} — {subtitle}",
                "similar_note": "نسخ متعددة ظهرت هذا الشهر" if i % 4 == 0 else None,
                "is_new": i % 6 == 0,
                "likes": 20 + (i * 3) % 100,
            }
        )
    return pins
