import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from fakeredis import FakeAsyncRedis

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


# ── DoD: GET /voice/{channelId}/participants ──────────────────────────────

@pytest.mark.asyncio
async def test_participants_returns_200_with_correct_shape(client, redis_client, mock_grpc_stub):
    mock_grpc_stub.CheckPerm.return_value = MagicMock(allowed=True)
    
    # Setup: 2 members
    ts1 = time.time() - 60
    ts2 = time.time()
    await redis_client.zadd("voice:channel:chan-abc:users", {"user-456": ts1, "user-789": ts2})

    resp = client.get("/voice/chan-abc/participants", headers={"Authorization": f"Bearer {make_token()}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["channel_id"] == "chan-abc"
    assert len(body["participants"]) == 2
    
    user_ids = [p["user_id"] for p in body["participants"]]
    assert "user-456" in user_ids
    assert "user-789" in user_ids


def test_participants_forbidden_when_perm_denied(client, mock_grpc_stub):
    mock_grpc_stub.CheckPerm.return_value = MagicMock(allowed=False)
    resp = client.get("/voice/chan-abc/participants", headers={"Authorization": f"Bearer {make_token()}"})
    assert resp.status_code == 403


def test_participants_unauthenticated(client):
    resp = client.get("/voice/chan-abc/participants")
    assert resp.status_code == 401
