"""WhatsApp sensors — Export + Cloud API. Channels are nerves; brain owns meaning."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DomainEvent, MediaAsset, RawPayload
from app.services.storage import storage


class WhatsAppExportAdapter:
    """Parse WhatsApp chat export (.txt + optional media folder) into DomainEvents."""

    LINE_RE = re.compile(
        r"^\[?(\d{1,4}[/-]\d{1,2}[/-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|ص|م)?)\]?\s*[-–]?\s*([^:]+):\s*(.*)$",
        re.IGNORECASE,
    )

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID):
        self.session = session
        self.tenant_id = tenant_id

    async def import_export(
        self,
        text: str,
        *,
        conversation_key: str,
        media_dir: Path | None = None,
        source_name: str = "export",
    ) -> dict[str, Any]:
        raw = RawPayload(
            tenant_id=self.tenant_id,
            source="export",
            payload={"conversation_key": conversation_key, "chars": len(text), "source_name": source_name},
        )
        self.session.add(raw)
        await self.session.flush()

        events_created = 0
        media_created = 0
        current_date = datetime.now(timezone.utc)

        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            m = self.LINE_RE.match(line)
            if not m:
                # Continuation line — attach to previous if any (skip for MVP simplicity)
                continue
            date_s, time_s, sender, body = m.groups()
            occurred = _parse_dt(date_s, time_s) or current_date
            participant = sender.strip()
            body = body.strip()

            media_refs: list[str] = []
            kind = "text"
            if "<attached:" in body.lower() or body.endswith("(file attached)") or "تم إرفاق" in body:
                kind = "media_notice"
                media_refs = _extract_media_names(body)

            event = DomainEvent(
                tenant_id=self.tenant_id,
                source="export",
                event_type="message",
                occurred_at=occurred,
                conversation_key=conversation_key,
                participant_key=participant,
                payload={
                    "text": body,
                    "sender_name": participant,
                    "kind": kind,
                    "media_names": media_refs,
                },
                raw_ref=str(raw.id),
                processed=False,
            )
            self.session.add(event)
            await self.session.flush()
            events_created += 1

            if media_dir and media_refs:
                for name in media_refs:
                    path = media_dir / name
                    if not path.exists():
                        # try fuzzy: any file containing stem
                        matches = list(media_dir.glob(f"*{Path(name).stem}*"))
                        path = matches[0] if matches else path
                    if path.exists() and path.is_file():
                        data = path.read_bytes()
                        media_kind = _media_kind(path.suffix)
                        key = f"exports/{conversation_key}/{path.name}"
                        storage.put_bytes(key, data, content_type=_content_type(path.suffix))
                        asset = MediaAsset(
                            tenant_id=self.tenant_id,
                            kind=media_kind,
                            storage_key=key,
                            content_type=_content_type(path.suffix),
                            sha256=storage.sha256(data),
                            byte_size=len(data),
                            event_id=event.id,
                            provenance={"source": "export", "filename": path.name},
                        )
                        self.session.add(asset)
                        media_created += 1

        await self.session.flush()
        return {"events": events_created, "media": media_created, "raw_id": str(raw.id)}


class WhatsAppCloudAPIAdapter:
    """Official Cloud API webhook → DomainEvents."""

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID):
        self.session = session
        self.tenant_id = tenant_id

    async def receive_webhook(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw = RawPayload(tenant_id=self.tenant_id, source="cloud_api", payload=payload)
        self.session.add(raw)
        await self.session.flush()

        created = 0
        entries = payload.get("entry") or []
        for entry in entries:
            for change in entry.get("changes") or []:
                value = change.get("value") or {}
                contacts = {c.get("wa_id"): c.get("profile", {}).get("name") for c in value.get("contacts") or []}
                for msg in value.get("messages") or []:
                    wa_from = msg.get("from")
                    msg_type = msg.get("type")
                    text = ""
                    if msg_type == "text":
                        text = (msg.get("text") or {}).get("body") or ""
                    elif msg_type == "image":
                        text = (msg.get("image") or {}).get("caption") or ""
                    elif msg_type == "audio":
                        text = ""
                    elif msg_type == "video":
                        text = (msg.get("video") or {}).get("caption") or ""

                    ts = msg.get("timestamp")
                    occurred = (
                        datetime.fromtimestamp(int(ts), tz=timezone.utc)
                        if ts
                        else datetime.now(timezone.utc)
                    )
                    event = DomainEvent(
                        tenant_id=self.tenant_id,
                        source="cloud_api",
                        event_type=msg_type or "message",
                        occurred_at=occurred,
                        conversation_key=wa_from,
                        participant_key=wa_from,
                        payload={
                            "text": text,
                            "sender_name": contacts.get(wa_from) or wa_from,
                            "wa_message_id": msg.get("id"),
                            "raw_message": msg,
                        },
                        raw_ref=str(raw.id),
                        processed=False,
                    )
                    self.session.add(event)
                    created += 1
        await self.session.flush()
        return {"events": created, "raw_id": str(raw.id)}


def _parse_dt(date_s: str, time_s: str) -> datetime | None:
    date_s = date_s.strip().replace("-", "/")
    time_s = time_s.strip()
    # Try common WhatsApp export formats
    candidates = [
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y %I:%M %p",
        "%d/%m/%y %H:%M",
        "%Y/%m/%d %H:%M",
    ]
    combined = f"{date_s} {time_s}"
    # Normalize Arabic am/pm
    combined = combined.replace("ص", "AM").replace("م", "PM")
    for fmt in candidates:
        try:
            dt = datetime.strptime(combined, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _extract_media_names(body: str) -> list[str]:
    names = re.findall(r"<attached:\s*([^>]+)>", body, flags=re.I)
    if names:
        return [n.strip() for n in names]
    # "IMG-2024.jpg (file attached)"
    m = re.search(r"([\w.\-]+\.(?:jpg|jpeg|png|webp|mp4|opus|ogg|mp3|pdf))", body, re.I)
    return [m.group(1)] if m else []


def _media_kind(suffix: str) -> str:
    s = suffix.lower()
    if s in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "image"
    if s in {".mp4", ".mov", ".avi"}:
        return "video"
    if s in {".opus", ".ogg", ".mp3", ".wav", ".m4a"}:
        return "audio"
    return "document"


def _content_type(suffix: str) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".opus": "audio/ogg",
        ".ogg": "audio/ogg",
        ".mp3": "audio/mpeg",
        ".pdf": "application/pdf",
    }.get(suffix.lower(), "application/octet-stream")
