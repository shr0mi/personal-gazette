"""FastAPI routes for the local sidecar."""

import hmac
import logging
import os
from copy import deepcopy

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, HttpUrl
from trafilatura import extract, fetch_url
from trafilatura.settings import DEFAULT_CONFIG

from backend.llm import (
    LLMSettings,
    ModelList,
    SummarizeRequest,
    SummaryResponse,
    discover_models,
    summarize_article,
)

logger = logging.getLogger(__name__)
extraction_config = deepcopy(DEFAULT_CONFIG)
extraction_config["DEFAULT"]["DOWNLOAD_TIMEOUT"] = "15"

app = FastAPI(
    title="Local Summarizer API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


class ExtractRequest(BaseModel):
    url: HttpUrl


class ExtractResponse(BaseModel):
    url: str
    text: str


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, error: RequestValidationError) -> JSONResponse:
    # FastAPI's default errors include the input, which can contain API keys.
    messages = [
        f"{'.'.join(str(part) for part in item['loc'] if part != 'body')}: {item['msg']}"
        for item in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": " ".join(messages)})


def require_desktop_token(x_backend_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("DEEP_WEBSEARCH_TOKEN", "")
    if not expected or not x_backend_token or not hmac.compare_digest(
        x_backend_token, expected
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health", dependencies=[Depends(require_desktop_token)])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "deep-websearch-api"}


@app.post(
    "/extract",
    response_model=ExtractResponse,
    dependencies=[Depends(require_desktop_token)],
)
def extract_website(request: ExtractRequest) -> ExtractResponse:
    # A synchronous route keeps downloading/extraction off the API event loop.
    url = str(request.url)
    download_error = (
        "Could not fetch this website. Check the link and your internet connection; "
        "the website may also block automated downloads."
    )
    try:
        html = fetch_url(url, config=extraction_config)
    except Exception as error:
        logger.exception("Website download failed")
        raise HTTPException(status_code=502, detail=download_error) from error

    if not html:
        raise HTTPException(status_code=502, detail=download_error)

    try:
        text = extract(
            html,
            url=url,
            output_format="txt",
            include_comments=False,
            include_tables=True,
            config=extraction_config,
        )
    except Exception as error:
        logger.exception("Website text extraction failed")
        raise HTTPException(
            status_code=500,
            detail="Could not extract text from this page. Try another article.",
        ) from error

    if not text or not text.strip():
        raise HTTPException(
            status_code=422,
            detail=(
                "No readable article text was found. This page may require "
                "JavaScript or a login. Try a direct link to an article."
            ),
        )

    return ExtractResponse(url=url, text=text.strip())


@app.post("/llm/models", response_model=ModelList, dependencies=[Depends(require_desktop_token)])
def local_models(settings: LLMSettings) -> ModelList:
    return discover_models(settings)


@app.post("/summarize", response_model=SummaryResponse, dependencies=[Depends(require_desktop_token)])
def summarize(request: SummarizeRequest) -> SummaryResponse:
    return summarize_article(request)
