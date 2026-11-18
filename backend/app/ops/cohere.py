"""Cohere access for the agents (optional: without a key every agent uses its deterministic analysis)."""

import os


def _key() -> str | None:
    return os.environ.get("COHERE_API_KEY") or os.environ.get("CO_API_KEY")


def llm_available() -> bool:
    return bool(_key())


def _cohere_client():
    from cohere import ClientV2

    return ClientV2(api_key=_key())
