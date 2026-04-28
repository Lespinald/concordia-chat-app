import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import grpc
from fastapi import FastAPI, HTTPException, Request
from jose import JWTError, jwt
from pydantic import BaseModel
from redis import asyncio as aioredis

import check_perm_pb2
import check_perm_pb2_grpc

REDIS_URL = os.getenv("REDIS_ADDR", "redis://localhost:6379")
GRPC_ADDR = os.getenv("GRPC_ADDR", "servers:50051")
SESSION_TTL = 4 * 60 * 60  # 4 hours in seconds


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        app.state.redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
        await app.state.redis.ping()
    except Exception as e:
        raise RuntimeError(f"Could not connect to Redis at {REDIS_URL}: {e}")
    yield
    await app.state.redis.close()


app = FastAPI(lifespan=lifespan)


class JoinResponse(BaseModel):
    session_id: str
    channel_id: str
    user_id: str
    joined_at: str


def _get_user_id(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    token = auth[len("Bearer "):]
    secret = os.getenv("JWT_SECRET", "")
    if not secret:
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="unauthorized")
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="unauthorized")
    return user_id


def _check_perm(user_id: str, channel_id: str) -> bool:
    addr = os.getenv("GRPC_ADDR", "servers:50051")
    with grpc.insecure_channel(addr) as channel:
        stub = check_perm_pb2_grpc.PermServiceStub(channel)
        req = check_perm_pb2.CheckPermRequest(
            user_id=user_id,
            server_id="",
            channel_id=channel_id,
            action=check_perm_pb2.VOICE_JOIN,
        )
        try:
            resp = stub.CheckPerm(req, timeout=5)
            return resp.allowed
        except grpc.RpcError:
            return False


@app.get("/health")
async def health():
    await app.state.redis.ping()
    return {"status": "ok"}


@app.post("/voice/{channel_id}/join", response_model=JoinResponse)
async def join_voice_channel(channel_id: str, request: Request):
    user_id = _get_user_id(request)

    if not await asyncio.to_thread(_check_perm, user_id, channel_id):
        raise HTTPException(status_code=403, detail="forbidden")

    redis = request.app.state.redis
    members_key = f"voice:channel:{channel_id}:users"
    session_key = f"voice:session:{channel_id}:{user_id}"

    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    now_iso = now.isoformat()

    existing = await redis.hgetall(session_key)
    if existing:
        session_id = existing["session_id"]
        joined_at = existing["joined_at"]
    else:
        session_id = str(uuid.uuid4())
        joined_at = now_iso
        await redis.hset(session_key, mapping={"session_id": session_id, "joined_at": joined_at})

    await redis.zadd(members_key, {user_id: now_ts})
    await redis.expire(members_key, SESSION_TTL)
    await redis.expire(session_key, SESSION_TTL)

    return JoinResponse(
        session_id=session_id,
        channel_id=channel_id,
        user_id=user_id,
        joined_at=joined_at,
    )
