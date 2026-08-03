"""Object storage helper — S3/MinIO with local filesystem fallback."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

from app.core.config import settings


class Storage:
    def __init__(self) -> None:
        self.local = bool(getattr(settings, "storage_local", False)) or settings.app_env == "development"
        # Prefer explicit flag
        self.local = str(getattr(settings, "storage_local", "true")).lower() in {"1", "true", "yes"}
        self.local_dir = Path(getattr(settings, "local_media_dir", "./data/media"))
        self.bucket = settings.s3_bucket
        self.client = None
        if not self.local:
            import boto3
            from botocore.client import Config

            self.client = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
                region_name=settings.s3_region,
                config=Config(signature_version="s3v4"),
                use_ssl=settings.s3_use_ssl,
            )

    def ensure_bucket(self) -> None:
        if self.local:
            self.local_dir.mkdir(parents=True, exist_ok=True)
            return
        assert self.client is not None
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            try:
                self.client.create_bucket(Bucket=self.bucket)
            except Exception:
                # Fall back to local if MinIO unreachable
                self.local = True
                self.local_dir.mkdir(parents=True, exist_ok=True)

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        if self.local:
            path = self.local_dir / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return key
        assert self.client is not None
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
            return key
        except Exception:
            self.local = True
            return self.put_bytes(key, data, content_type)

    async def get_bytes(self, key: str) -> bytes:
        if self.local:
            return (self.local_dir / key).read_bytes()
        assert self.client is not None
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        return obj["Body"].read()

    @staticmethod
    def sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()


@lru_cache
def get_storage() -> Storage:
    return Storage()


storage = get_storage()
