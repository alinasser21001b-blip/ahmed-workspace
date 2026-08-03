from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.api.routes.internal import router as internal_router
from app.db.session import engine
from app.services.storage import storage
from app.services.subscriptions import seed_plans
from app.db.session import SessionLocal


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage.ensure_bucket()
    async with SessionLocal() as session:
        await seed_plans(session)
        await session.commit()
    yield
    await engine.dispose()


app = FastAPI(title="MedMind IQ API", version="1.0.0", lifespan=lifespan)
app.include_router(internal_router)


@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    if hasattr(exc, "status_code"):
        raise exc
    return JSONResponse(status_code=500, content={"error_code": "INTERNAL_ERROR", "message": str(exc)})


@app.get("/")
async def root():
    return {"service": "MedMind IQ", "docs": "/docs"}
