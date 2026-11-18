"""LLM reasoning for the agents (the existing Cohere integration), always grounded and always optional.

The model only ever sees evidence collected from the integrations, must cite evidence ids, and its output is
checked: citations to evidence that does not exist are removed and the agent is marked as such. When no
LLM is configured, or the call fails or is rate-limited, the agent falls back to the deterministic analysis
its playbook produced, and the UI shows which engine was used.
"""

import json
import os
import re
import threading
import time

from . import cohere as llm

MODEL = os.getenv("CC_AGENT_MODEL") or "command-a-03-2025"
TIMEOUT = float(os.getenv("CC_AGENT_TIMEOUT", "30"))
_GAP = 3.2  # seconds between calls: stays inside the free trial key's rate limit
_lock = threading.Lock()
_last = {"t": 0.0}

RULES = ("You are one agent in Crystal Clean's IT operations platform. Use ONLY the evidence given. Never invent hosts, numbers, "
         "people, commands or events. Cite evidence by its id (e.g. E3). Be concise and factual. Reply with JSON only.")


def available() -> bool:
    return llm.llm_available()


def ask(role: str, task: str, evidence: list[dict], context: dict, schema_hint: str) -> tuple[dict | None, str]:
    """Returns (json, error). The prompt carries the evidence compactly; the model must answer in the given shape."""
    if not available():
        return None, "no LLM configured"
    ev = [{"id": e["id"], "source": e["source"], "title": e["title"], "data": e["data"]} for e in evidence]
    prompt = (f"{RULES}\n\nRole: {role}\nTask: {task}\n\nContext:\n{json.dumps(context, default=str)[:3000]}\n\n"
              f"Evidence:\n{json.dumps(ev, default=str)[:9000]}\n\nAnswer as JSON: {schema_hint}")
    with _lock:
        wait = _GAP - (time.time() - _last["t"])
        if wait > 0:
            time.sleep(wait)
        _last["t"] = time.time()
    try:
        resp = llm._cohere_client().chat(model=MODEL, temperature=0, response_format={"type": "json_object"},
                                         messages=[{"role": "user", "content": prompt}],
                                         request_options={"timeout_in_seconds": TIMEOUT})
        raw = next(i.text for i in resp.message.content if getattr(i, "text", None)).strip()
        out = json.loads(re.sub(r"^```(json)?|```$", "", raw, flags=re.MULTILINE).strip())
        return (out, "") if isinstance(out, dict) else (None, "model returned non-object JSON")
    except Exception as exc:  # network, auth, quota, timeout, bad JSON
        return None, f"{type(exc).__name__}: {str(exc)[:140]}"


def grounded_refs(text_or_list, evidence_ids: set[str]) -> tuple[list[str], list[str]]:
    """Evidence ids cited in a model answer, split into (valid, invalid)."""
    s = json.dumps(text_or_list, default=str)
    cited = sorted(set(re.findall(r"\bE\d{1,3}\b", s)))
    return [c for c in cited if c in evidence_ids], [c for c in cited if c not in evidence_ids]
