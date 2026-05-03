import time
from unittest.mock import patch

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from jose import jwt
from fakeredis import FakeAsyncRedis

JWT_SECRET = "test-secret-32-bytes-long-enough!!"
ALGORITHM = "HS256"


def make_token(user_id: str) -> str:
    """Genera un token de prueba válido para el usuario dado."""
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
def app_client(redis_client):
    """Fixture que inyecta la app de FastAPI con mocks de Redis e variables de entorno."""
    from main import app
    with patch.dict("os.environ", {"JWT_SECRET": JWT_SECRET}):
        with patch("main.aioredis.from_url", return_value=redis_client):
            with patch("signaling.aioredis.from_url", return_value=redis_client):
                with patch("signaling.JWT_SECRET", JWT_SECRET):
                    with TestClient(app) as c:
                        yield c


# ── DoD: 1. Rechazar peticiones sin token o con token inválido ─────────────

def test_signaling_rejects_missing_token(app_client):
    client = app_client
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/voice/chan-abc/signal"):
            pass
    # Validar que se cierra con el código de error correspondiente
    assert exc_info.value.code == 1008


def test_signaling_rejects_invalid_token(app_client):
    client = app_client
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/voice/chan-abc/signal?token=invalid.token.here"):
            pass
    assert exc_info.value.code == 1008


# ── DoD: 2 y 3. Retransmisión de mensajes a peers conectados ───────────────

def test_signaling_relays_message_between_peers(app_client):
    client = app_client
    token_a = make_token("user-A")
    token_b = make_token("user-B")

    # Conectar al usuario B
    with client.websocket_connect(f"/voice/chan-1/signal?token={token_b}") as ws_b:
        # Conectar al usuario A
        with client.websocket_connect(f"/voice/chan-1/signal?token={token_a}") as ws_a:

            # Usuario A envía una oferta a Usuario B
            offer_payload = {
                "type": "offer",
                "target_user_id": "user-B",
                "sdp": "v=0\r\no=alice..."
            }
            ws_a.send_json(offer_payload)

            # Usuario B recibe la oferta con el `sender_user_id` adjunto
            received = ws_b.receive_json()
            assert received["type"] == "offer"
            assert received["sender_user_id"] == "user-A"
            assert received["sdp"] == "v=0\r\no=alice..."


# ── DoD: 4. Si el peer no está, retorna error al emisor ────────────────────

def test_signaling_returns_error_if_peer_not_connected(app_client):
    client = app_client
    token_a = make_token("user-A")

    with client.websocket_connect(f"/voice/chan-1/signal?token={token_a}") as ws_a:
        ws_a.send_json({
            "type": "offer",
            "target_user_id": "user-GHOST",
            "sdp": "dummy"
        })

        error_response = ws_a.receive_json()
        assert error_response == {"type": "error", "reason": "peer not connected"}


# ── DoD: 5. Cleanup: limpia de Redis (zrem) al desconectarse ───────────────

@pytest.mark.asyncio
async def test_signaling_disconnect_cleans_up_redis(app_client, redis_client):
    client = app_client
    token_a = make_token("user-A")

    with client.websocket_connect(f"/voice/chan-1/signal?token={token_a}") as ws_a:
        pass # Se conecta y se desconecta inmediatamente al salir del contexto

    members = await redis_client.zrange("voice:channel:chan-1:users", 0, -1)
    assert "user-A" not in members