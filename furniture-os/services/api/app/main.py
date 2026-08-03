from contextlib import asynccontextmanager
import hashlib
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.routes.brain import router as brain_router
from app.core.config import settings
from app.db.models import User
from app.db.session import SessionLocal, engine, Base
from app.services.storage import storage


def _hash_password(password: str) -> str:
    return hashlib.sha256(f"{settings.jwt_secret}:{password}".encode()).hexdigest()


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as session:
        existing = (
            await session.execute(select(User).where(User.email == settings.owner_email))
        ).scalar_one_or_none()
        if not existing:
            session.add(
                User(
                    tenant_id=uuid.UUID(settings.tenant_id),
                    email=settings.owner_email,
                    password_hash=_hash_password(settings.owner_password),
                    display_name="Owner",
                    role="owner",
                )
            )
            await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage.ensure_bucket()
    await init_db()
    yield
    await engine.dispose()


app = FastAPI(
    title="Furniture Intelligence OS",
    description="The AI Brain of the Furniture Business",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(brain_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "product": "Furniture Intelligence OS",
        "philosophy": "Channels are sensors. The product is the Brain.",
        "docs": "/docs",
        "api": "/api/v1/health",
    }
