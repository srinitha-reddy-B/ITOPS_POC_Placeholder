"""Knowledge-base ingestion: fetch a webpage or parse an uploaded document,
extract plain text, and store it per session so agent_runtime can ground an
otherwise-unrouted question in it (see llm.answer_from_knowledge).

Demo-grade like the rest of this app's persistence story (see trace_store.py
and state_store.py): in-memory per session, persisted verbatim through
state_store.py, capped in size so a runaway upload can't blow up future
Cohere prompt sizes.
"""

import io
import re
import uuid
from html.parser import HTMLParser

import httpx

_MAX_CHARS_PER_SESSION = 20_000

# session_id -> list of {"id", "source", "text", "char_count", "stored_chars", "truncated"}
_sources: dict[str, list[dict]] = {}


class _TextExtractor(HTMLParser):
    """Strips tags/scripts/styles down to visible text -- good enough for
    "train from a webpage" without pulling in a full HTML-parsing library
    (BeautifulSoup) for what the stdlib already does adequately."""

    _SKIP_TAGS = {"script", "style", "noscript", "template"}

    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self.chunks: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in self._SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if not self._skip_depth:
            text = data.strip()
            if text:
                self.chunks.append(text)


def _html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return re.sub(r"\s+", " ", " ".join(parser.chunks)).strip()


def fetch_webpage_text(url: str) -> str:
    resp = httpx.get(
        url, timeout=15.0, follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; AuraKnowledgeBot/1.0)"},
    )
    resp.raise_for_status()
    content_type = resp.headers.get("content-type", "")
    if "text/html" in content_type or "<html" in resp.text[:500].lower():
        return _html_to_text(resp.text)
    return resp.text


def extract_document_text(filename: str, content: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if lower.endswith(".docx"):
        import docx

        document = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs)
    if lower.endswith((".txt", ".md")):
        return content.decode("utf-8", errors="replace")
    raise ValueError(f"Unsupported file type: {filename} — use .txt, .md, .pdf, or .docx")


def add_source(session_id: str, source: str, text: str) -> dict:
    text = text.strip()
    if not text:
        raise ValueError("No text could be extracted from that source.")
    existing_total = sum(len(s["text"]) for s in _sources.get(session_id, []))
    remaining = max(_MAX_CHARS_PER_SESSION - existing_total, 0)
    stored_text = text[:remaining]
    entry = {
        "id": uuid.uuid4().hex[:10],
        "source": source,
        "text": stored_text,
        "char_count": len(text),
        "stored_chars": len(stored_text),
        "truncated": len(stored_text) < len(text),
    }
    _sources.setdefault(session_id, []).append(entry)
    return entry


def list_sources(session_id: str) -> list[dict]:
    """Metadata only -- never ships the extracted text back to the browser,
    it's only needed server-side for grounding answers."""
    return [{k: v for k, v in s.items() if k != "text"} for s in _sources.get(session_id, [])]


def remove_source(session_id: str, source_id: str) -> bool:
    sources = _sources.get(session_id, [])
    kept = [s for s in sources if s["id"] != source_id]
    _sources[session_id] = kept
    return len(kept) != len(sources)


def has_knowledge(session_id: str) -> bool:
    return bool(_sources.get(session_id))


def get_text(session_id: str) -> str:
    return "\n\n".join(s["text"] for s in _sources.get(session_id, []))
