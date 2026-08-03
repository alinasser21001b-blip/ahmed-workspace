import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.client import Config

from app.core.config import settings


class StorageService:
    def __init__(self) -> None:
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=Config(signature_version="s3v4"),
            use_ssl=settings.s3_use_ssl,
        )
        self.bucket = settings.s3_bucket

    def ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            self.client.create_bucket(Bucket=self.bucket)

    def upload_bytes(self, key: str, data: bytes, content_type: str) -> str:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        return key

    def upload_file(self, key: str, path: Path, content_type: str) -> str:
        return self.upload_bytes(key, path.read_bytes(), content_type)

    def download_bytes(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read()

    def presigned_url(self, key: str, expires_in: int = 900) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def pack_prefix(self, user_id: uuid.UUID, pack_id: uuid.UUID) -> str:
        return f"packs/{user_id}/{pack_id}"

    def input_key(self, user_id: uuid.UUID, pack_id: uuid.UUID, filename: str = "original.pdf") -> str:
        return f"inputs/{user_id}/{pack_id}/{filename}"


storage = StorageService()
