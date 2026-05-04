import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from fakeredis import FakeAsyncRedis

import check_perm_pb2

JWT_SECRET = "test-secret-32-bytes-long-enough!!"
ALGORITHM = "HS256"


def make_token(user_id: str = "user-123") -> str:
    return jwt.encode(
        {"sub": user_id, "username": "testuser", "exp": int(time.time()) + 3600},
        JWT_SECRET,
        algorithm=ALGORITHM,
    )


import pytest_asyncio

@pytest_asyncio.fixture()
async def redis_client():
    client = FakeAsyncRedis(decode_responses=True)
    yield client
    await client.flushall()
    await client.aclose()


@pytest.fixture()
def mock_grpc_stub():
    with patch("check_perm_pb2_grpc.PermServiceStub") as mock_stub_cls:
        mock_stub = MagicMock()
        mock_stub_cls.return_value = mock_stub
        yield mock_stub


@pytest.fixture()
def client(redis_client, mock_grpc_stub):
    from main import app
    with patch.dict("os.environ", {"JWT_SECRET": JWT_SECRET}):
        with patch("main.aioredis.from_url", return_value=redis_client):
            with patch("grpc.insecure_channel"):
                with TestClient(app, raise_server_exceptions=True) as c:
                    yield c


# ── DoD: POST /leave with valid JWT → 204 ────────────────────────────────

@pytest.mark.asyncio
async def test_leave_returns_204(client, redis_client):
    # Setup: user is in channel
    await redis_client.zadd("voice:channel:chan-abc:users", {"user-123": time.time()})
    await redis_client.hset("voice:session:chan-abc:user-123", mapping={"session_id": "123"})

    resp = client.post("/voice/chan-abc/leave", headers={"Authorization": f"Bearer {make_token()}"})
    assert resp.status_code == 204
    assert resp.content == b""


# ── DoD: User removed from Redis sorted set ──────────────────────────────

@pytest.mark.asyncio
async def test_leave_removes_from_redis(client, redis_client):
    # Setup
    await redis_client.zadd("voice:channel:chan-abc:users", {"user-123": time.time()})
    await redis_client.hset("voice:session:chan-abc:user-123", mapping={"session_id": "123"})

    client.post("/voice/chan-abc/leave", headers={"Authorization": f"Bearer {make_token()}"})
    
    # Check
    assert not await redis_client.exists("voice:session:chan-abc:user-123")
    members = await redis_client.zrange("voice:channel:chan-abc:users", 0, -1)
    assert "user-123" not in members


# ── DoD: Idempotent — not in channel → still 204 ─────────────────────────

def test_leave_idempotent_when_not_in_channel(client):
    resp = client.post("/voice/chan-abc/leave", headers={"Authorization": f"Bearer {make_token()}"})
    assert resp.status_code == 204


# ── DoD: Unauthenticated → 401 ────────────────────────────────────────────

def test_leave_unauthenticated(client):
    resp = client.post("/voice/chan-abc/leave")
    assert resp.status_code == 401
