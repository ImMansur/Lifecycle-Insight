"""OpenAI-based extractor for Excel-only CoC fields.

Only extracts fields that genuinely don't exist anywhere else in the
structured pipeline (issuer/contact details from the certificate header).
Do NOT add fields here that mix distinct concepts into one free-text string
(e.g. a combined "serialization" bucket smashing true serials + lot/batch +
cure date + expiry together) — those belong as separate, properly attributed
fields on the main `Recommendation`/`LineItem` models (see docLotBatchNumber/
docExpirationDate/docCureDate and per-lineItem lotBatchNumbers/expirationDate/
soLotBatchExp), not as a single guessed string here.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_EXTRA_SYSTEM_PROMPT = """
You are an expert data-extraction assistant for an oilfield equipment company.
You receive text from a Certificate of Conformance (CoC) document.
Extract the following fields and return a single JSON object (use null if not found):

- documentType: type of certificate (e.g. "Certificate of Conformance", "Material Test Report", "Inspection Certificate")
- issuer: full name of the company or lab that issued this certificate
- address: issuing company's address (street, city, country)
- phone: issuing company's main phone number
- fax: issuing company's fax number

RULES:
1. Return ONLY the JSON object, no markdown fences, no explanation.
2. All fields are strings.
3. Do not invent data — use null if genuinely absent.
""".strip()


def _build_client():
    from services.openai_service import build_openai_client
    return build_openai_client()



def extract_extra_fields_sync(text: str | None) -> dict[str, Any]:
    """Synchronous call to Azure OpenAI to extract extra Excel fields."""
    empty: dict[str, Any] = {
        "documentType": None,
        "issuer": None,
        "address": None,
        "phone": None,
        "fax": None,
    }
    if not text:
        return empty

    try:
        client, deployment = _build_client()
        response = client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": _EXTRA_SYSTEM_PROMPT},
                {"role": "user", "content": f"---BEGIN DOCUMENT TEXT---\n{text[:4000]}\n---END DOCUMENT TEXT---"},
            ],
            temperature=0,
            max_tokens=800,
        )
        raw = response.choices[0].message.content or "{}"
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        data = json.loads(raw)
        # Merge with empty to ensure all keys present
        return {**empty, **{k: v for k, v in data.items() if k in empty}}
    except Exception as exc:
        logger.warning("Extra-field extraction failed: %s", exc)
        return empty


async def extract_extra_fields(text: str | None) -> dict[str, Any]:
    """Async wrapper — runs the sync call in a thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, extract_extra_fields_sync, text)
