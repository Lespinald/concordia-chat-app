import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Integer, String, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://discord:discord@localhost:5432/tips_db")
JWT_SECRET = os.getenv("JWT_SECRET", "changeme-32-byte-dev-secret!!!")

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Tip(Base):
    __tablename__ = "tips"
    tip_id = Column(String, primary_key=True)
    sender_id = Column(String, nullable=False, index=True)
    recipient_id = Column(String, nullable=False, index=True)
    amount_cents = Column(Integer, nullable=False)
    currency = Column(String(8), nullable=False, default="USD")
    message = Column(String(500), nullable=False, default="")
    created_at = Column(DateTime(timezone=True), nullable=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


def _get_user_id(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    token = auth[len("Bearer "):]
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="unauthorized")
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="unauthorized")
    return user_id


class TipCreate(BaseModel):
    recipient_id: str
    amount_cents: int
    currency: str = "USD"
    message: str = ""


class TipOut(BaseModel):
    tip_id: str
    sender_id: str
    recipient_id: str
    amount_cents: int
    currency: str
    message: str
    created_at: str


def _to_out(t: Tip) -> TipOut:
    return TipOut(
        tip_id=t.tip_id,
        sender_id=t.sender_id,
        recipient_id=t.recipient_id,
        amount_cents=t.amount_cents,
        currency=t.currency,
        message=t.message,
        created_at=t.created_at.isoformat(),
    )


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/tips", status_code=201)
async def send_tip(body: TipCreate, request: Request) -> TipOut:
    sender_id = _get_user_id(request)

    if sender_id == body.recipient_id:
        raise HTTPException(status_code=400, detail="cannot tip yourself")
    if body.amount_cents <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")

    tip = Tip(
        tip_id=str(uuid.uuid4()),
        sender_id=sender_id,
        recipient_id=body.recipient_id,
        amount_cents=body.amount_cents,
        currency=body.currency,
        message=body.message,
        created_at=datetime.now(timezone.utc),
    )
    async with async_session() as session:
        session.add(tip)
        await session.commit()
        await session.refresh(tip)

    return _to_out(tip)


@app.get("/tips/{tip_id}")
async def get_tip(tip_id: str, request: Request) -> TipOut:
    user_id = _get_user_id(request)
    async with async_session() as session:
        result = await session.get(Tip, tip_id)
    if result is None or (result.sender_id != user_id and result.recipient_id != user_id):
        raise HTTPException(status_code=404, detail="not found")
    return _to_out(result)


@app.get("/tips")
async def list_tips(
    request: Request,
    direction: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[TipOut]:
    user_id = _get_user_id(request)

    stmt = select(Tip)
    if direction == "sent":
        stmt = stmt.where(Tip.sender_id == user_id)
    elif direction == "received":
        stmt = stmt.where(Tip.recipient_id == user_id)
    else:
        stmt = stmt.where(or_(Tip.sender_id == user_id, Tip.recipient_id == user_id))

    stmt = stmt.order_by(Tip.created_at.desc()).limit(limit).offset(offset)

    async with async_session() as session:
        rows = await session.execute(stmt)
        tips = rows.scalars().all()

    return [_to_out(t) for t in tips]
