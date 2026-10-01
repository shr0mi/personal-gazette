"""FastAPI routes for the local sidecar."""

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

app = FastAPI(
    title="Deep Websearch Agent API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def require_desktop_token(x_backend_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("DEEP_WEBSEARCH_TOKEN", "")
    if not expected or not x_backend_token or not hmac.compare_digest(
        x_backend_token, expected
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health", dependencies=[Depends(require_desktop_token)])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "deep-websearch-api"}
