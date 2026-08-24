"""FastAPI app entrypoint. No auth middleware — internal tool, open CORS."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.db import init_db
from backend.nodes_api import router as nodes_router
from backend.voice_api import router as voice_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Call Router", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(nodes_router)
app.include_router(voice_router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}
