import os
from fastapi import FastAPI
from redis import asyncio as aioredis
from contextlib import asynccontextmanager

REDIS_URL = os.getenv("REDIS_ADDR", "redis://localhost:6379")

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        app.state.redis = await aioredis.from_url(
            REDIS_URL,
            decode_responses=True
        )
        await app.state.redis.ping()
    except Exception as e:
        raise RuntimeError(f"Could not connect to Redis at {REDIS_URL}: {e}")
    yield
    await app.state.redis.close()

app = FastAPI(lifespan=lifespan)

@app.get("/health")
async def health():
    await app.state.redis.ping()
    return {"status": "ok"}
