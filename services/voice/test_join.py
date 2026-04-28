"""DoD tests for POST /voice/{channelId}/join (T-42)."""
import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

JWT_SECRET = "test-secret-32-bytes-long-enough!!"
ALGORITHM = "HS256"


def make_token(user_id: str = "user-123", expired: bool = False) -> str:
    import time
    payload = {"sub": user_id, "username": "testuser"}
    if expired:
        payload["exp"] = int(time.time()) - 60
    else:
        payload["exp"] = int(time.time()) + 3600
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def _make_redis_mock(has_existing_session: bool = False):
    r = AsyncMock()
    r.ping = AsyncMock()
    if has_existing_session:
        existing_session_id = str(uuid.uuid4())
        r.hgetall = AsyncMock(return_value={
            "session_id": existing_session_id,
            "joined_at": "2026-01-01T00:00:00+00:00",
        })
        r._existing_session_id = existing_session_id
    else:
        r.hgetall = AsyncMock(return_value={})
    r.hset = AsyncMock()
    r.zadd = AsyncMock()
    r.expire = AsyncMock()
    r.close = AsyncMock()
    return r


@pytest.fixture()
def client_allowed():
    """Client where CheckPerm returns allowed=True."""
    from main import app

    redis_mock = _make_redis_mock()

    grpc_resp = MagicMock()
    grpc_resp.allowed = True

    with patch.dict("os.environ", {"JWT_SECRET": JWT_SECRET}):
        with patch("main.aioredis.from_url", new=AsyncMock(return_value=redis_mock)):
            with patch("main._check_perm", return_value=True):
                with TestClient(app, raise_server_exceptions=True) as c:
                    yield c, redis_mock


@pytest.fixture()
def client_denied():
    """Client where CheckPerm returns allowed=False."""
    from main import app

    redis_mock = _make_redis_mock()

    with patch.dict("os.environ", {"JWT_SECRET": JWT_SECRET}):
        with patch("main.aioredis.from_url", new=AsyncMock(return_value=redis_mock)):
            with patch("main._check_perm", return_value=False):
                with TestClient(app, raise_server_exceptions=True) as c:
                    yield c, redis_mock


@pytest.fixture()
def client_already_joined():
    """Client where user already has a session in Redis."""
    from main import app

    redis_mock = _make_redis_mock(has_existing_session=True)

    with patch.dict("os.environ", {"JWT_SECRET": JWT_SECRET}):
        with patch("main.aioredis.from_url", new=AsyncMock(return_value=redis_mock)):
            with patch("main._check_perm", return_value=True):
                with TestClient(app, raise_server_exceptions=True) as c:
                    yield c, redis_mock


# ── DoD: HTTP 200 with correct response shape ──────────────────────────────

def test_join_returns_200_with_correct_shape(client_allowed):
    c, _ = client_allowed
    token = make_token("user-123")
    resp = c.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["channel_id"] == "chan-abc"
    assert body["user_id"] == "user-123"
    assert "session_id" in body
    uuid.UUID(body["session_id"])  # must be valid UUID
    assert "joined_at" in body


# ── DoD: CheckPerm denied → 403 ────────────────────────────────────────────

def test_join_forbidden_when_perm_denied(client_denied):
    c, _ = client_denied
    token = make_token("user-123")
    resp = c.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


# ── DoD: Unauthenticated → 401 ─────────────────────────────────────────────

def test_join_unauthenticated_no_header(client_allowed):
    c, _ = client_allowed
    resp = c.post("/voice/chan-abc/join")
    assert resp.status_code == 401


def test_join_unauthenticated_bad_token(client_allowed):
    c, _ = client_allowed
    resp = c.post("/voice/chan-abc/join", headers={"Authorization": "Bearer notavalidtoken"})
    assert resp.status_code == 401


def test_join_unauthenticated_expired_token(client_allowed):
    c, _ = client_allowed
    token = make_token("user-123", expired=True)
    resp = c.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


# ── DoD: Redis sorted set written with correct key ─────────────────────────

def test_join_writes_to_redis_sorted_set(client_allowed):
    c, redis_mock = client_allowed
    token = make_token("user-123")
    c.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    redis_mock.zadd.assert_called_once()
    key = redis_mock.zadd.call_args[0][0]
    assert key == "voice:channel:chan-abc:users"
    members = redis_mock.zadd.call_args[0][1]
    assert "user-123" in members


# ── DoD: TTL of 4 hours set on sorted set ─────────────────────────────────

def test_join_sets_ttl_on_sorted_set(client_allowed):
    c, redis_mock = client_allowed
    token = make_token("user-123")
    c.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    expire_calls = redis_mock.expire.call_args_list
    keys = [call[0][0] for call in expire_calls]
    ttls = [call[0][1] for call in expire_calls]
    assert "voice:channel:chan-abc:users" in keys
    idx = keys.index("voice:channel:chan-abc:users")
    assert ttls[idx] == 4 * 60 * 60


# ── DoD: Idempotent re-join refreshes TTL, reuses session_id ──────────────

def test_join_idempotent_returns_200(client_already_joined):
    c, redis_mock = client_already_joined
    token = make_token("user-123")
    resp = c.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_join_idempotent_reuses_session_id(client_already_joined):
    c, redis_mock = client_already_joined
    token = make_token("user-123")
    resp = c.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    body = resp.json()
    assert body["session_id"] == redis_mock._existing_session_id


def test_join_idempotent_refreshes_ttl(client_already_joined):
    c, redis_mock = client_already_joined
    token = make_token("user-123")
    c.post("/voice/chan-abc/join", headers={"Authorization": f"Bearer {token}"})
    redis_mock.expire.assert_called()
    keys = [call[0][0] for call in redis_mock.expire.call_args_list]
    assert "voice:channel:chan-abc:users" in keys
