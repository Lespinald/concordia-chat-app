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
import signaling

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
    await app.state.redis.aclose()


app = FastAPI(lifespan=lifespan)
app.include_router(signaling.router)


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


def _check_perm(user_id: str, channel_id: str, action: int = check_perm_pb2.VOICE_JOIN) -> bool:
    addr = os.getenv("GRPC_ADDR", "servers:50051")
    with grpc.insecure_channel(addr) as channel:
        stub = check_perm_pb2_grpc.PermServiceStub(channel)
        req = check_perm_pb2.CheckPermRequest(
            user_id=user_id,
            server_id="",
            channel_id=channel_id,
            action=action,
        )
        try:
            resp = stub.CheckPerm(req, timeout=5)
            return resp.allowed
        except grpc.RpcError:
            return False


class ParticipantEntry(BaseModel):
    user_id: str
    joined_at: str


class ParticipantsResponse(BaseModel):
    channel_id: str
    participants: list[ParticipantEntry]


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

    # DoD T-46: Notificar a los clientes conectados en el WebRTC que alguien entró
    await signaling.manager.broadcast({
        "type": "participant_joined",
        "user_id": user_id
    }, channel_id, exclude_user_id=user_id)

    return JoinResponse(
        session_id=session_id,
        channel_id=channel_id,
        user_id=user_id,
        joined_at=joined_at,
    )


@app.post("/voice/{channel_id}/leave", status_code=204)
async def leave_voice_channel(channel_id: str, request: Request):
    user_id = _get_user_id(request)
    redis = request.app.state.redis
    await redis.zrem(f"voice:channel:{channel_id}:users", user_id)
    await redis.delete(f"voice:session:{channel_id}:{user_id}")

    # DoD T-46: Notificar a los clientes restantes en el WebRTC que alguien salió
    await signaling.manager.broadcast({
        "type": "participant_left",
        "user_id": user_id
    }, channel_id, exclude_user_id=user_id)


@app.get("/voice/{channel_id}/participants", response_model=ParticipantsResponse)
async def get_participants(channel_id: str, request: Request):
    user_id = _get_user_id(request)

    if not await asyncio.to_thread(_check_perm, user_id, channel_id, check_perm_pb2.READ):
        raise HTTPException(status_code=403, detail="forbidden")

    redis = request.app.state.redis
    rows = await redis.zrange(f"voice:channel:{channel_id}:users", 0, -1, withscores=True)
    participants = [
        ParticipantEntry(
            user_id=member,
            joined_at=datetime.fromtimestamp(score, tz=timezone.utc).isoformat(),
        )
        for member, score in rows
    ]
    return ParticipantsResponse(channel_id=channel_id, participants=participants)
