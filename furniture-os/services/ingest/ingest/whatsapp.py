"""WhatsApp sensors — Export + Cloud API. Channels are nerves; brain owns meaning."""

from __future__ import annotations

import hashlib
import hmac
import io
import re
import zipfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import DomainEvent, MediaAsset, RawPayload
from app.services.storage import storage


class WhatsAppExportAdapter:
    """Parse WhatsApp chat export (.txt + optional media folder/zip) into DomainEvents."""

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

    async def import_zip(
        self,
        zip_bytes: bytes,
        *,
        conversation_key: str,
        source_name: str = "export.zip",
    ) -> dict[str, Any]:
        """Import a WhatsApp export zip (chat.txt + media files)."""
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            chat_name = next(
                (n for n in names if n.lower().endswith(".txt") and not n.startswith("__")),
                None,
            )
            if not chat_name:
                return {"events": 0, "media": 0, "error": "no_chat_txt"}
            text = zf.read(chat_name).decode("utf-8", errors="replace")

            # Extract media into a temp-like local dir under data/exports
            out_dir = Path(settings.export_upload_dir) / conversation_key / "media"
            out_dir.mkdir(parents=True, exist_ok=True)
            for n in names:
                if n == chat_name or n.endswith("/"):
                    continue
                target = out_dir / Path(n).name
                target.write_bytes(zf.read(n))

            return await self.import_export(
                text,
                conversation_key=conversation_key,
                media_dir=out_dir,
                source_name=source_name,
            )


class WhatsAppCloudAPIAdapter:
    """Official Cloud API webhook → DomainEvents (+ media download)."""

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID):
        self.session = session
        self.tenant_id = tenant_id

    @staticmethod
    def verify_signature(raw_body: bytes, signature_header: str | None) -> bool:
        secret = settings.whatsapp_app_secret
        if not secret:
            return True  # allow in local/dev when secret unset
        if not signature_header or not signature_header.startswith("sha256="):
            return False
        expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature_header.removeprefix("sha256="), expected)

    async def receive_webhook(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw = RawPayload(tenant_id=self.tenant_id, source="cloud_api", payload=payload)
        self.session.add(raw)
        await self.session.flush()

        created = 0
        media_created = 0
        entries = payload.get("entry") or []
        for entry in entries:
            for change in entry.get("changes") or []:
                value = change.get("value") or {}
                contacts = {
                    c.get("wa_id"): c.get("profile", {}).get("name") for c in value.get("contacts") or []
                }
                for msg in value.get("messages") or []:
                    wa_id = msg.get("id")
                    if wa_id and await self._already_ingested(wa_id):
                        continue

                    wa_from = msg.get("from")
                    msg_type = msg.get("type")
                    text = ""
                    media_info: dict[str, Any] | None = None
                    if msg_type == "text":
                        text = (msg.get("text") or {}).get("body") or ""
                    elif msg_type == "image":
                        media_info = msg.get("image") or {}
                        text = media_info.get("caption") or ""
                    elif msg_type == "audio":
                        media_info = msg.get("audio") or {}
                    elif msg_type == "video":
                        media_info = msg.get("video") or {}
                        text = media_info.get("caption") or ""
                    elif msg_type == "document":
                        media_info = msg.get("document") or {}
                        text = media_info.get("caption") or media_info.get("filename") or ""

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
                            "wa_message_id": wa_id,
                            "raw_message": msg,
                        },
                        raw_ref=str(raw.id),
                        processed=False,
                    )
                    self.session.add(event)
                    await self.session.flush()
                    created += 1

                    if media_info and media_info.get("id"):
                        asset = await self._download_media(
                            media_id=media_info["id"],
                            mime=media_info.get("mime_type"),
                            event=event,
                            msg_type=msg_type or "document",
                        )
                        if asset:
                            media_created += 1

        await self.session.flush()
        return {"events": created, "media": media_created, "raw_id": str(raw.id)}

    async def _already_ingested(self, wa_message_id: str) -> bool:
        # SQLite-friendly: scan recent cloud events for matching wa_message_id
        q = await self.session.execute(
            select(DomainEvent)
            .where(DomainEvent.tenant_id == self.tenant_id, DomainEvent.source == "cloud_api")
            .order_by(DomainEvent.created_at.desc())
            .limit(200)
        )
        for ev in q.scalars().all():
            if (ev.payload or {}).get("wa_message_id") == wa_message_id:
                return True
        return False

    async def _download_media(
        self,
        *,
        media_id: str,
        mime: str | None,
        event: DomainEvent,
        msg_type: str,
    ) -> MediaAsset | None:
        token = settings.whatsapp_access_token
        if not token:
            return None
        try:
            import httpx

            async with httpx.AsyncClient(timeout=60) as client:
                meta = await client.get(
                    f"https://graph.facebook.com/v21.0/{media_id}",
                    headers={"Authorization": f"Bearer {token}"},
                )
                meta.raise_for_status()
                url = meta.json().get("url")
                if not url:
                    return None
                blob = await client.get(url, headers={"Authorization": f"Bearer {token}"})
                blob.raise_for_status()
                data = blob.content
        except Exception:
            return None

        mime = mime or "application/octet-stream"
        kind = {
            "image": "image",
            "audio": "audio",
            "video": "video",
            "document": "document",
        }.get(msg_type, _media_kind_from_mime(mime))
        ext = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "audio/ogg": "ogg",
            "audio/mpeg": "mp3",
            "video/mp4": "mp4",
        }.get(mime, "bin")
        key = f"cloud/{event.conversation_key}/{media_id}.{ext}"
        storage.put_bytes(key, data, content_type=mime)
        asset = MediaAsset(
            tenant_id=self.tenant_id,
            kind=kind,
            storage_key=key,
            content_type=mime,
            sha256=storage.sha256(data),
            byte_size=len(data),
            event_id=event.id,
            provenance={"source": "cloud_api", "media_id": media_id},
        )
        self.session.add(asset)
        await self.session.flush()
        return asset


def _parse_dt(date_s: str, time_s: str) -> datetime | None:
    date_s = date_s.strip().replace("-", "/")
    time_s = time_s.strip()
    candidates = [
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y %I:%M %p",
        "%d/%m/%y %H:%M",
        "%Y/%m/%d %H:%M",
    ]
    combined = f"{date_s} {time_s}"
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


def _media_kind_from_mime(mime: str) -> str:
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("audio/"):
        return "audio"
    if mime.startswith("video/"):
        return "video"
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
