import json
import os
from typing import Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from jose import JWTError, jwt
from redis import asyncio as aioredis

# Variables de entorno
JWT_SECRET = os.getenv("JWT_SECRET", "default_secret")
ALGORITHM = "HS256"
REDIS_ADDR = os.getenv("REDIS_ADDR", "redis://redis:6379")

router = APIRouter()


class ConnectionManager:
    """Gestiona las conexiones WebSocket activas para la señalización WebRTC."""

    def __init__(self):
        # Mapeo: channel_id -> { user_id -> WebSocket }
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, channel_id: str, user_id: str):
        """Acepta una nueva conexión y la añade al pool."""
        await websocket.accept()
        if channel_id not in self.active_connections:
            self.active_connections[channel_id] = {}
        self.active_connections[channel_id][user_id] = websocket

    def disconnect(self, channel_id: str, user_id: str):
        """Elimina una conexión del pool."""
        if channel_id in self.active_connections:
            self.active_connections[channel_id].pop(user_id, None)
            if not self.active_connections[channel_id]:
                del self.active_connections[channel_id]

    async def send_to_peer(self, message: dict, channel_id: str, target_user_id: str) -> bool:
        """Envía un mensaje JSON a un peer específico en un canal."""
        channel_conns = self.active_connections.get(channel_id, {})
        if target_user_id in channel_conns:
            await channel_conns[target_user_id].send_json(message)
            return True
        return False

    async def broadcast(self, message: dict, channel_id: str, exclude_user_id: str = None):
        """Envía un mensaje JSON a todos los participantes del canal, excepto a uno."""
        channel_conns = self.active_connections.get(channel_id, {})
        for uid, ws in channel_conns.items():
            if uid != exclude_user_id:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass # Ignorar si hay problemas de red con el socket de este cliente

manager = ConnectionManager()


@router.websocket("/voice/{channel_id}/signal")
async def signaling_endpoint(websocket: WebSocket, channel_id: str):
    """Endpoint WebSocket para la señalización WebRTC (offer/answer/ICE)."""
    auth_header = websocket.headers.get("authorization")
    token = None
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    else:
        token = websocket.query_params.get("token")

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise JWTError("Missing sub in token")
    except JWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, channel_id, user_id)

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                # Ignorar mensajes malformados y continuar escuchando
                continue

            target_user_id = message.get("target_user_id")
            if target_user_id:
                message["sender_user_id"] = user_id
                success = await manager.send_to_peer(message, channel_id, target_user_id)
                if not success:
                    await websocket.send_json({"type": "error", "reason": "peer not connected"})

    except WebSocketDisconnect:
        manager.disconnect(channel_id, user_id)
        redis = await aioredis.from_url(REDIS_ADDR)
        await redis.zrem(f"voice:channel:{channel_id}:users", user_id)
        await redis.aclose()