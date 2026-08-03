#!/usr/bin/env python3
"""Initialize database tables and seed subscription plans."""

import asyncio

from app.db.session import Base, SessionLocal, engine
from app.services.subscriptions import seed_plans
from app.services.storage import storage


async def main() -> None:
    storage.ensure_bucket()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as session:
        await seed_plans(session)
        await session.commit()
    print("Database initialized and plans seeded.")


if __name__ == "__main__":
    asyncio.run(main())
