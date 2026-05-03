import time
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from fakeredis import FakeAsyncRedis

import check_perm_pb2

JWT_SECRET = "test-secret-32-bytes-long-enough!!"
ALGORITHM = "HS256"


def make_token(user_id: str = "user-123", expired: bool = False) -> str:
    payload = {"sub": user_id, "username": "testuser"}
    if expired:
        payload["exp"] = int(time.time()) - 60
    else:
        payload["exp"] = int(time.time()) + 3600
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


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


# ── DoD: HTTP 200 with correct response shape ──────────────────────────────

def test_join_returns_200_with_correct_shape(client, mock_grpc_stub):
    mock_grpc_stub.CheckPerm.return_value = MagicMock(allowed=True)
    token = make_token("user-123")
    resp = client.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["channel_id"] == "chan-abc"
    assert body["user_id"] == "user-123"
    assert "session_id" in body
    uuid.UUID(body["session_id"])  # must be valid UUID
    assert "joined_at" in body


# ── DoD: CheckPerm denied → 403 ────────────────────────────────────────────

def test_join_forbidden_when_perm_denied(client, mock_grpc_stub):
    mock_grpc_stub.CheckPerm.return_value = MagicMock(allowed=False)
    token = make_token("user-123")
    resp = client.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


# ── DoD: Unauthenticated → 401 ─────────────────────────────────────────────

def test_join_unauthenticated_no_header(client):
    resp = client.post("/voice/chan-abc/join")
    assert resp.status_code == 401


def test_join_unauthenticated_bad_token(client):
    resp = client.post("/voice/chan-abc/join", headers={"Authorization": "Bearer notavalidtoken"})
    assert resp.status_code == 401


def test_join_unauthenticated_expired_token(client):
    token = make_token("user-123", expired=True)
    resp = client.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


# ── DoD: Redis sorted set written with correct key ─────────────────────────

@pytest.mark.asyncio
async def test_join_writes_to_redis_sorted_set(client, redis_client, mock_grpc_stub):
    mock_grpc_stub.CheckPerm.return_value = MagicMock(allowed=True)
    token = make_token("user-123")
    client.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    
    # Check redis content directly
    members = await redis_client.zrange("voice:channel:chan-abc:users", 0, -1)
    assert "user-123" in members


# ── DoD: TTL of 4 hours set on sorted set ─────────────────────────────────

@pytest.mark.asyncio
async def test_join_sets_ttl_on_sorted_set(client, redis_client, mock_grpc_stub):
    mock_grpc_stub.CheckPerm.return_value = MagicMock(allowed=True)
    token = make_token("user-123")
    client.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    
    ttl = await redis_client.ttl("voice:channel:chan-abc:users")
    assert 0 < ttl <= 4 * 60 * 60


# ── DoD: Idempotent re-join refreshes TTL, reuses session_id ──────────────

@pytest.mark.asyncio
async def test_join_idempotent_returns_200(client, redis_client, mock_grpc_stub):
    mock_grpc_stub.CheckPerm.return_value = MagicMock(allowed=True)
    
    # Setup existing session
    session_key = "voice:session:chan-abc:user-123"
    existing_session_id = str(uuid.uuid4())
    await redis_client.hset(session_key, mapping={
        "session_id": existing_session_id,
        "joined_at": "2026-01-01T00:00:00+00:00"
    })

    token = make_token("user-123")
    resp = client.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["session_id"] == existing_session_id


@pytest.mark.asyncio
async def test_join_idempotent_refreshes_ttl(client, redis_client, mock_grpc_stub):
    mock_grpc_stub.CheckPerm.return_value = MagicMock(allowed=True)
    
    session_key = "voice:session:chan-abc:user-123"
    await redis_client.hset(session_key, mapping={
        "session_id": str(uuid.uuid4()),
        "joined_at": "2026-01-01T00:00:00+00:00"
    })
    # Set a low TTL to check if it gets refreshed
    await redis_client.expire(session_key, 100)

    token = make_token("user-123")
    client.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    
    ttl = await redis_client.ttl(session_key)
    assert ttl > 100
    assert ttl <= 4 * 60 * 60
