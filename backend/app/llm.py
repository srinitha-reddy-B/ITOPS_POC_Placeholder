"""Turns free text (a typed process description, or an SOP dropped into chat)
into an agent blueprint, and turns a live chat message into a routing
decision once agents are built.

Uses the Cohere API when COHERE_API_KEY is set (real language
understanding). Falls back to a keyword heuristic when it isn't, so the demo
still runs end to end without an API key -- see the BRD's honesty principle:
say plainly which mode produced a given proposal.
"""

import json
import os
import re

_PLATFORM_KEYWORDS = {
    "salesforce": ["salesforce", "opportunity", "opportunities", "crm", "account owner"],
    "databricks": ["databricks", "churn", "delta table", "unity catalog"],
    "snowflake": ["snowflake", "order activity", "warehouse"],
    "oracle": ["oracle", "oracle db", "pl/sql", "plsql", "tnsnames"],
    "servicenow": ["servicenow", "ticket", "incident", "support case"],
    "m365": ["sharepoint", "microsoft 365", "m365", "office 365", "proposal doc"],
}

# Generic customer-support vocabulary -> which mocked platform it maps onto,
# used when the SOP talks about the business process rather than naming a
# specific platform (e.g. "order status" implies a CRM/Salesforce lookup).
_SUPPORT_TOPIC_KEYWORDS = {
    "salesforce": ["order status", "order", "shipping", "tracking", "delivery"],
    "servicenow": ["return", "refund", "replacement", "escalation", "escalate"],
    "databricks": ["risk", "loyalty", "repeat issue"],
}

_ESCALATION_KEYWORDS = ["escalat", "human agent", "supervisor", "manager", "sentiment"]

_WRITE_VERBS = [
    "create", "open a", "update", "set ", "add a credit", "issue a refund",
    "cancel", "reassign", "assign", "close the ticket", "close", "resolve", "delete", "remove", "merge", "insert",
]
# Word-boundary versions so "create" doesn't match inside "created" --
# without this, "have u created the lead" (a question about the past) was
# misread as a brand-new write request. Same reasoning covers "close"/
# "closed" and "resolve"/"resolved": the word-boundary match requires the
# verb to be its own whole word, so it won't fire inside the past-tense
# form -- "how many incidents are closed" stays a read.
_WRITE_VERB_PATTERNS = [re.compile(r"\b" + re.escape(v.strip()) + r"\b", re.I) for v in _WRITE_VERBS]
# "change" is handled separately from the list above: it's also the noun
# in "change request" (a ServiceNow table name), so "how many change
# requests are open" would otherwise misfire as a write. The negative
# lookahead only excludes that specific noun phrase -- "change the
# priority" still counts as a write.
_WRITE_VERB_PATTERNS.append(re.compile(r"\bchange\b(?!\s+request)", re.I))

# Single-word verbs worth a typo-tolerant check ("cretae" for "create") --
# multi-word phrases are left to the exact patterns above since fuzzy-
# matching a phrase is more error-prone than fuzzy-matching one word.
# "change" is left out entirely -- its collision is with a following
# NOUN ("change request"), not its own past tense, and fuzzy matching
# only ever looks at one word at a time, so it can't apply the same
# negative-lookahead trick the exact-match pattern above uses.
_FUZZY_WRITE_VERBS = ["create", "update", "cancel", "reassign", "assign", "merge", "insert", "close", "resolve", "delete", "remove"]

# CRITICAL: every one of these verbs' ordinary past tense/participle/
# plural forms lands within the same edit-distance-1-or-2 tolerance as an
# actual typo of the verb itself ("create"->"created" is 1 insertion,
# same as "create"->"creat" would be) -- found the hard way when "how
# many incidents created regarding DB issue" (obviously a READ) matched
# "create" as a typo and silently created a brand-new real incident.
# These forms must NEVER count as a fuzzy match, no matter how close the
# edit distance looks, or every single one of these verbs reopens that
# exact hole.
_REGULAR_INFLECTIONS = {
    "create": {"created", "creates", "creating"},
    "update": {"updated", "updates", "updating"},
    "cancel": {"canceled", "cancelled", "cancels", "canceling", "cancelling"},
    "reassign": {"reassigned", "reassigns", "reassigning"},
    "assign": {"assigned", "assigns", "assigning"},
    "merge": {"merged", "merges", "merging"},
    "insert": {"inserted", "inserts", "inserting"},
    "close": {"closed", "closes", "closing"},
    "resolve": {"resolved", "resolves", "resolving"},
    "delete": {"deleted", "deletes", "deleting"},
    "remove": {"removed", "removes", "removing"},
}


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1))
        prev = curr
    return prev[len(b)]


def _has_fuzzy_write_verb(text: str) -> bool:
    for word in re.findall(r"[a-z]+", text.lower()):
        if len(word) < 5:
            continue
        for verb in _FUZZY_WRITE_VERBS:
            if word in _REGULAR_INFLECTIONS.get(verb, ()):
                continue  # a real grammatical form, not a typo -- never a match
            max_dist = 2 if len(verb) >= 6 else 1
            if abs(len(word) - len(verb)) <= max_dist and _levenshtein(word, verb) <= max_dist:
                return True
    return False

# A message that's asking ABOUT a past action ("have you created...",
# "did it update...", "was the lead created?") is a status question, not a
# new write, even though it contains a write verb.
_QUESTION_PATTERNS = [
    re.compile(r"^\s*(have|has|had)\s+\w+\s+", re.I),
    re.compile(r"^\s*(did|does|do|is|are|was|were)\s+\w+\s+", re.I),
    re.compile(r"\?\s*$"),
]


def _is_status_question(message: str) -> bool:
    return any(p.search(message) for p in _QUESTION_PATTERNS)

_ROUTING_STOPWORDS = {"agent", "the", "and", "for", "with", "that", "this", "specialist", "handler"}

# Typo-tolerant patterns for "did the user explicitly name a platform" --
# separate from _PLATFORM_KEYWORDS, which is about topic-scoring against
# EXISTING participants. This is used to catch "I need to edit in the
# databricks" when there's no Databricks agent in the blueprint at all, so
# that case gets an honest "I don't have that agent yet" instead of being
# silently misrouted to whichever agent happens to be first.
_PLATFORM_PATTERNS = {
    "salesforce": re.compile(r"sales\s*force", re.I),
    "databricks": re.compile(r"data\s*bric\w*", re.I),
    "snowflake": re.compile(r"snow\s*flake", re.I),
    "oracle": re.compile(r"\boracle\s*(db)?\b", re.I),
    "servicenow": re.compile(r"service\s*now", re.I),
    "m365": re.compile(r"share\s*point|microsoft\s*365|\bm365\b|office\s*365", re.I),
}


def detect_mentioned_platform(message: str) -> str | None:
    for platform, pattern in _PLATFORM_PATTERNS.items():
        if pattern.search(message):
            return platform
    return None


def _stem(word: str) -> str:
    """Crude prefix stemmer so 'return' / 'returns' / 'returned' compare equal."""
    return word[:5] if len(word) >= 5 else word


def _content_words(text: str) -> set[str]:
    """Lowercase, underscore/space-split tokens of length >= 4, minus stopwords, stemmed."""
    tokens = re.split(r"[^a-zA-Z]+", text.lower())
    return {_stem(t) for t in tokens if len(t) >= 4 and t not in _ROUTING_STOPWORDS}


_COHERE_MODEL = os.environ.get("COHERE_MODEL") or "command-a-03-2025"


def _cohere_api_key() -> str | None:
    # COHERE_API_KEY is what we document; CO_API_KEY is Cohere's own (undocumented) convention.
    return os.environ.get("COHERE_API_KEY") or os.environ.get("CO_API_KEY")


def llm_available() -> bool:
    return bool(_cohere_api_key())


def _cohere_client():
    from cohere import ClientV2

    return ClientV2(api_key=_cohere_api_key())


def _participant(name: str, platform: str, role: str) -> dict:
    return {
        "name": name,
        "platform": platform,
        "role": role,
        "read_actions": [f"{platform}_read"],
        "write_actions": [f"{platform}_write"],
        "routing_rules": [],
    }


def _escalation_participant(rule: str = "") -> dict:
    return {
        "name": "Human Escalation Agent",
        "platform": "human",
        "role": "Hands off to a human agent when a business rule requires it",
        "read_actions": [],
        "write_actions": ["notify_human"],
        "routing_rules": [rule] if rule else [],
    }


def _heuristic_blueprint(context: str, prior: dict | None, change_request: str | None) -> dict:
    text = f"{context}\n{change_request or ''}".lower()
    participants: dict[str, dict] = {}

    if prior:
        for p in prior["root_agent"]["participants"]:
            participants[p["platform"]] = p

    for platform, kws in _PLATFORM_KEYWORDS.items():
        if any(kw in text for kw in kws) and platform not in participants:
            participants[platform] = _participant(f"{platform.capitalize()} Agent", platform, f"Reads and writes {platform} records")

    if not participants:
        for platform, kws in _SUPPORT_TOPIC_KEYWORDS.items():
            if any(kw in text for kw in kws) and platform not in participants:
                participants[platform] = _participant(
                    f"{platform.capitalize()} Agent", platform, f"Handles the parts of this process that live in {platform}"
                )

    if not participants:
        participants["salesforce"] = _participant("Salesforce Agent", "salesforce", "Default specialist when no platform is named")

    needs_escalation = any(kw in text for kw in _ESCALATION_KEYWORDS)
    if needs_escalation:
        rule = ""
        if "sentiment" in text:
            rule = "Hand off to a human when the customer's sentiment is negative."
        elif "repeat" in text:
            rule = "Hand off to a human when this is a repeat issue for the same account."
        else:
            rule = "Hand off to a human when the SOP's stated escalation condition is met."
        if "human" in participants:
            existing = participants["human"]["routing_rules"]
            if rule not in existing:
                existing.append(rule)
        else:
            participants["human"] = _escalation_participant(rule)

    return {
        "scaffold_type": "multiagent_orchestrator",
        "repo_name": prior["repo_name"] if prior else "aura-showcase-agent",
        "description": context.strip()[:280] or "Agent topology proposed from chat context.",
        "root_agent": {
            "orchestration_class": "Handoff",
            "name": "Root Orchestrator",
            "orchestration_agent": "supervisor",
            "participants": list(participants.values()),
        },
        "Observability": {"Platform_Name": "fiddler"},
        "Guardrail": {"rai_policy_resource_id": "local-mock-rai-policy"},
        "generated_by": "heuristic",
    }


_BLUEPRINT_PROMPT = """You design multi-agent support topologies for the Aura platform.
Given business context (a process description or an SOP excerpt) and an optional prior \
blueprint plus a change request, output ONLY a JSON object with this exact shape:

{{
  "scaffold_type": "multiagent_orchestrator",
  "repo_name": "kebab-case-name",
  "description": "one sentence",
  "root_agent": {{
    "orchestration_class": "Handoff",
    "name": "Root Orchestrator",
    "orchestration_agent": "supervisor",
    "participants": [
      {{"name": "...", "platform": "salesforce|databricks|snowflake|oracle|servicenow|m365|human", \
"role": "...", "read_actions": ["..."], "write_actions": ["..."], "routing_rules": ["..."]}}
    ]
  }},
  "Observability": {{"Platform_Name": "fiddler"}},
  "Guardrail": {{"rai_policy_resource_id": "local-mock-rai-policy"}}
}}

Only use the platform values salesforce, databricks, snowflake, oracle, servicenow, m365, or human \
(for escalation). Add a "human" participant with a routing_rules entry only if the context \
states an escalation condition.

If a prior blueprint is given, this is an INCREMENTAL change to an already-running system, not a \
redesign: include every one of the prior blueprint's participants in your output, unchanged, \
UNLESS the change request explicitly asks to remove or replace that specific one. Only add new \
participants, or modify the ones the change request actually names. Context:
---
{context}
---
Prior blueprint (JSON, or "none"): {prior}
Change request (or "none"): {change_request}

Respond with the JSON object only, no prose, no markdown fences.
"""


def _cohere_json(prompt: str) -> dict | None:
    """Runs one Cohere chat call and parses a JSON object back out of it.
    Returns None on any failure so callers can fall back to a heuristic."""
    try:
        client = _cohere_client()
        resp = client.chat(
            model=_COHERE_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        raw = next(item.text for item in resp.message.content if getattr(item, "text", None)).strip()
        raw = re.sub(r"^```(json)?|```$", "", raw, flags=re.MULTILINE).strip()
        return json.loads(raw)
    except Exception:
        return None


_REMOVAL_HINTS = ["remove", "delete", "get rid of", "replace"]


def _preserve_prior_participants(blueprint: dict, prior: dict | None, change_request: str | None) -> dict:
    """Guarantees an incremental change never silently drops an already-live
    agent, regardless of what the LLM (or the heuristic) actually returned --
    a prompt instruction is a request, not a guarantee. If the change
    request explicitly asks to remove/replace something, trust the model's
    output as-is instead of fighting it."""
    if not prior or any(h in (change_request or "").lower() for h in _REMOVAL_HINTS):
        return blueprint
    existing_names = {p["name"] for p in blueprint["root_agent"]["participants"]}
    for p in prior["root_agent"]["participants"]:
        if p["name"] not in existing_names:
            blueprint["root_agent"]["participants"].append(p)
    return blueprint


def generate_blueprint(context: str, prior: dict | None, change_request: str | None) -> dict:
    if not llm_available():
        blueprint = _heuristic_blueprint(context, prior, change_request)
        return _preserve_prior_participants(blueprint, prior, change_request)

    prompt = _BLUEPRINT_PROMPT.format(
        context=context,
        prior=json.dumps(prior) if prior else "none",
        change_request=change_request or "none",
    )
    blueprint = _cohere_json(prompt)
    if blueprint is not None:
        blueprint["generated_by"] = "llm (cohere)"
        blueprint.setdefault("repo_name", "aura-showcase-agent")
        return _preserve_prior_participants(blueprint, prior, change_request)
    blueprint = _heuristic_blueprint(context, prior, change_request)
    blueprint["generated_by"] = "heuristic-fallback (cohere call failed)"
    return _preserve_prior_participants(blueprint, prior, change_request)


_WRITE_INTENT_PROMPT = """A user asked a Salesforce agent to perform a write action. Identify which \
standard Salesforce object this maps to and what field values you can confidently infer.

Message: "{message}"

Respond with ONLY a JSON object of this exact shape:
{{"sobject": "Lead|Account|Contact|Opportunity|Case|Task", "fields": {{"FieldApiName": "value"}}, \
"missing_required": ["FieldApiName", ...]}}

Rules:
- Lead requires LastName and Company. Account requires Name. Contact requires LastName.
- Opportunity requires Name, StageName, CloseDate (YYYY-MM-DD). Case and Task require Subject.
- Only put a field in "fields" if you can confidently infer its value from the message. List any of
  that object's required fields you could NOT infer in "missing_required" -- never invent a value.
- If nothing in the message maps to a specific business object, use "Task" with Subject set to a
  short summary of the request, and "missing_required": [].
Respond with the JSON object only, no prose, no markdown fences.
"""

_SOBJECT_REQUIRED_FIELDS = {
    "Lead": ["LastName", "Company"],
    "Account": ["Name"],
    "Contact": ["LastName"],
    "Opportunity": ["Name", "StageName", "CloseDate"],
    "Case": ["Subject"],
    "Task": ["Subject"],
}

_NAME_PATTERN = re.compile(r"(?:named?|called)\s+([A-Za-z0-9][A-Za-z0-9 _.'-]{0,60})", re.I)


def parse_write_intent(message: str) -> dict:
    """Maps a write request onto a real Salesforce object + fields, instead
    of always creating a generic Task regardless of what was asked.
    Returns {"sobject": str, "fields": dict, "missing_required": list[str]}.
    """
    if llm_available():
        parsed = _cohere_json(_WRITE_INTENT_PROMPT.format(message=message))
        if parsed and parsed.get("sobject") in _SOBJECT_REQUIRED_FIELDS:
            parsed.setdefault("fields", {})
            parsed.setdefault("missing_required", [])
            return parsed
    return _heuristic_write_intent(message)


def _heuristic_write_intent(message: str) -> dict:
    text = message.lower()
    name_match = _NAME_PATTERN.search(message)
    name = name_match.group(1).strip() if name_match else None

    def result(sobject: str, fields: dict) -> dict:
        required = _SOBJECT_REQUIRED_FIELDS[sobject]
        missing = [f for f in required if f not in fields]
        return {"sobject": sobject, "fields": fields, "missing_required": missing}

    if "lead" in text:
        return result("Lead", {"LastName": name} if name else {})
    if "account" in text:
        return result("Account", {"Name": name} if name else {})
    if "contact" in text:
        return result("Contact", {"LastName": name} if name else {})
    if "opportunity" in text or "deal" in text:
        return result("Opportunity", {"Name": name, "StageName": "Prospecting"} if name else {"StageName": "Prospecting"})
    if "case" in text:
        return result("Case", {"Subject": message[:255]})
    return result("Task", {"Subject": message[:255]})


_READ_INTENT_PROMPT = """A user asked a Salesforce agent to look something up. Identify which standard \
Salesforce object they're asking about, and whether they only want a count.

Message: "{message}"

Respond with ONLY a JSON object of this exact shape:
{{"sobject": "Account|Opportunity|Lead|Contact|Case|Task", "count_only": true|false}}

Rules:
- "how many X" / "count of X" / "number of X" -> count_only: true, otherwise false.
- If the message doesn't clearly name one of those objects, use "Opportunity" as the default.
Respond with the JSON object only, no prose, no markdown fences.
"""

_READ_SOBJECT_KEYWORDS = {
    "Account": ["account", "accounts"],
    "Opportunity": ["opportunity", "opportunities", "deal", "deals"],
    "Lead": ["lead", "leads"],
    "Contact": ["contact", "contacts"],
    "Case": ["case", "cases", "ticket", "tickets"],
    "Task": ["task", "tasks"],
}


def parse_read_intent(message: str) -> dict:
    """Maps a read request onto a real Salesforce object, instead of always
    querying Opportunity regardless of what was actually asked.
    Returns {"sobject": str, "count_only": bool}.
    """
    if llm_available():
        parsed = _cohere_json(_READ_INTENT_PROMPT.format(message=message))
        if parsed and parsed.get("sobject") in _READ_SOBJECT_KEYWORDS:
            parsed.setdefault("count_only", False)
            return parsed
    return _heuristic_read_intent(message)


def _heuristic_read_intent(message: str) -> dict:
    text = message.lower()
    count_only = bool(re.search(r"\bhow many\b|\bcount of\b|\bnumber of\b", text))
    for sobject, kws in _READ_SOBJECT_KEYWORDS.items():
        if any(kw in text for kw in kws):
            return {"sobject": sobject, "count_only": count_only}
    return {"sobject": "Opportunity", "count_only": count_only}


_CLOSED_STATUS_KEYWORDS = ["closed", "resolved", "complete", "completed", "done"]
_ALL_STATUS_KEYWORDS = ["all incidents", "every incident", "total incidents", "all tickets"]


_ATTACHMENT_KEYWORDS = ["attachment", "attached file", "files attached", "attach"]

# Requires an explicit CI-indicating keyword right before the name, rather
# than a bare "related to X"/"for X" -- those are too generic (a create
# request like "an incident for a broken printer" would false-positive)
# to safely treat as "filter incidents by this Configuration Item".
_CI_NAME_PATTERN = re.compile(
    r"\b(?:ci\s*item|configuration\s*item|business\s*service|\bci\b)\s*[:\s]\s*([A-Za-z0-9][\w:\-. ]{1,60})", re.I
)


def _extract_ci_name(message: str) -> str | None:
    match = _CI_NAME_PATTERN.search(message)
    if not match:
        return None
    return re.split(r"\?|\.\s|\band\b", match.group(1).strip(), maxsplit=1)[0].strip().rstrip(".,!? ")


# Only checked once a CI-name match has already failed (see
# parse_servicenow_read_intent) -- "related to"/"regarding"/etc. is too
# generic to check first (it would also match "incidents related to ci
# item X"), but once that specific case is ruled out, treating the rest
# of the phrase as a free-text search over short_description is exactly
# what "incidents related to DB issues" or "incidents regarding login
# failures" are actually asking for.
_TOPIC_PATTERN = re.compile(r"\b(?:regarding|about|related to|concerning)\s+([A-Za-z0-9][\w .'\-/]{1,60})", re.I)


def _extract_keyword(message: str) -> str | None:
    match = _TOPIC_PATTERN.search(message)
    if not match:
        return None
    return re.split(r"\?|\.\s", match.group(1).strip(), maxsplit=1)[0].strip().rstrip(".,!? ")


def parse_servicenow_read_intent(message: str) -> dict:
    """What kind of ServiceNow read this is, and which table (Incident,
    Problem, Change Request, Request Item, Knowledge Article) it's
    against -- a list by status (open/closed/all) optionally scoped to
    one Configuration Item, a lookup of one specific record's details, or
    a check of what's attached to one specific record. Recognizing a
    record number in the message (INC0010158, PRB0010001, ...) is what
    tells "how many are open" (a list) apart from "is INC0010158 open" or
    "what's attached to PRB0010001" (both about one specific record) --
    and its prefix is also what tells the table apart when the message
    doesn't spell out the word "problem"/"change"/etc.

    Returns {"table": str, "query_type": "list"|"detail"|"attachments",
    "incident_number": str|None, "status": "open"|"closed"|"all",
    "ci_name": str|None, "keyword": str|None}.
    "detail" and "attachments" need an incident_number to act on -- the
    caller is responsible for asking for one if it's missing here.
    """
    text = message.lower()
    table = detect_servicenow_table(message)
    record_number = _extract_record_number(message)

    if any(kw in text for kw in _ATTACHMENT_KEYWORDS):
        return {"table": table, "query_type": "attachments", "incident_number": record_number, "status": "all", "ci_name": None, "keyword": None}
    if record_number:
        return {"table": table, "query_type": "detail", "incident_number": record_number, "status": "all", "ci_name": None, "keyword": None}

    ci_name = _extract_ci_name(message)
    keyword = None if ci_name else _extract_keyword(message)
    if any(kw in text for kw in _ALL_STATUS_KEYWORDS):
        status = "all"
    elif any(kw in text for kw in _CLOSED_STATUS_KEYWORDS):
        status = "closed"
    else:
        status = "open"
    return {
        "table": table, "query_type": "list", "incident_number": None,
        "status": status, "ci_name": ci_name, "keyword": keyword,
    }


# ServiceNow record types the agent understands, beyond Incident. Table
# names and number prefixes are stable, documented ServiceNow schema --
# safe to hardcode. State/choice VALUES are deliberately NOT hardcoded
# here (see platform_connect._resolve_state_value): those vary by table
# and can be customized per instance, so they're looked up live from the
# instance's own sys_choice metadata instead of guessed.
#
# Scoped to number-bearing ITSM record types where "detail"/"attachments"/
# lifecycle actions make sense the same way they do for Incident.
# Configuration Items and User Groups are deliberately left out as
# standalone tables here -- they're identified by name, not a number, and
# don't have the same open/closed lifecycle, so folding them into this
# same model would mean guessing at a different shape. cmdb_ci still works
# today as a *filter* on an incident list ("incidents related to CI X").
SERVICENOW_TABLES = {
    "incident": {"aliases": ["incident", "incidents", "ticket", "tickets"], "prefix": "INC", "label": "incident", "creatable": True},
    "problem": {"aliases": ["problem", "problems"], "prefix": "PRB", "label": "problem", "creatable": True},
    "change_request": {"aliases": ["change request", "change requests", "change", "changes"], "prefix": "CHG", "label": "change request", "creatable": True},
    "sc_req_item": {"aliases": ["requested item", "request item", "catalog request", "catalog item request"], "prefix": "RITM", "label": "request item", "creatable": True},
    "kb_knowledge": {"aliases": ["knowledge article", "kb article", "knowledge base article"], "prefix": "KB", "label": "knowledge article", "creatable": False},
}
_DEFAULT_SERVICENOW_TABLE = "incident"

_SERVICENOW_TABLE_ALIASES = sorted(
    ((alias, table) for table, meta in SERVICENOW_TABLES.items() for alias in meta["aliases"]),
    key=lambda pair: -len(pair[0]),
)
_SERVICENOW_PREFIX_TO_TABLE = {meta["prefix"]: table for table, meta in SERVICENOW_TABLES.items()}
_RECORD_NUMBER_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(p) for p in _SERVICENOW_PREFIX_TO_TABLE) + r")\d{4,}\b", re.I
)


def detect_servicenow_table(message: str) -> str:
    """Which ServiceNow table this message is about. A record number's
    prefix is the most reliable signal -- "PRB0010001" unambiguously means
    Problem even if the word "problem" never appears -- checked before
    falling back to keyword aliases, then to Incident as the default
    (matching the original, Incident-only behavior when nothing else is
    named)."""
    number_match = _RECORD_NUMBER_PATTERN.search(message)
    if number_match:
        return _SERVICENOW_PREFIX_TO_TABLE[number_match.group(1).upper()]
    text = message.lower()
    for alias, table in _SERVICENOW_TABLE_ALIASES:
        if alias in text:
            return table
    return _DEFAULT_SERVICENOW_TABLE


def _extract_record_number(message: str) -> str | None:
    match = _RECORD_NUMBER_PATTERN.search(message)
    return match.group(0).upper() if match else None


_SERVICENOW_DELETE_KEYWORDS = ["delete", "remove", "get rid of"]
_SERVICENOW_ASSIGN_PATTERN = re.compile(
    r"\bassign(?:ed)?\b.{0,40}?\bto\s+([A-Za-z][A-Za-z .'-]{1,40})", re.I
)

# A create request is typically phrased as an instruction to the agent --
# "go and create an incident for the issue of X" -- not as the incident
# text itself. Without stripping that wrapper, X was never separated from
# the "go and create a ticket for..." framing around it, so the ticket's
# short_description ended up being the whole chat message, framing and all.
_INCIDENT_LEAD_IN_PATTERN = re.compile(
    r"^\s*(?:hey[,]?\s+)?(?:(?:can|could)\s+you\s+|please\s+|go\s+(?:ahead\s+)?(?:and\s+)?|i\s+need\s+(?:you\s+)?to\s+)+",
    re.I,
)
_INCIDENT_VERB_NOUN_PATTERN = re.compile(
    r"^(?:create|open|log|raise|file|submit|start)\s+(?:an?\s+|new\s+)*"
    r"(?:incident|ticket|case|request|ir)\b\s*"
    r"(?:for|about|regarding|on|to\s+report)?\s*"
    r"(?:the\s+(?:issue|problem|fact)\s+(?:of|that|where))?\s*",
    re.I,
)

# What's left after the request wrapper is stripped is often still a
# narrated symptom -- "the proble i am facing is X" or "i am having an
# issue where X" -- rather than X itself. "probl\w*" (not a fixed
# "problem") tolerates the common "proble"/"problum" typos. Applied after
# the two patterns above, so a message with no create-verb wrapper at all
# (someone just describing the problem) still gets this pass.
_INCIDENT_NARRATIVE_PATTERN = re.compile(
    r"^\s*(?:the\s+)?(?:probl\w*|issue)\s+i(?:'m| am)\s+facing\s+is\s+(?:that\s+)?"
    r"|^\s*(?:the\s+|my\s+)?(?:probl\w*|issue)\s+is\s+(?:that\s+)?"
    r"|^\s*i(?:'m| am)\s+(?:facing|having|getting)\s+(?:an?\s+)?(?:probl\w*|issue)\s*(?:where|that|:|-)?\s*"
    r"|^\s*i\s+have\s+(?:an?\s+)?(?:probl\w*|issue)\s*(?:where|that|:|-)?\s*",
    re.I,
)
# One more level down: "the problem i am facing is I am unable to connect"
# strips to "I am unable to connect" above -- still reads better as
# "Unable to connect" for a ticket title.
_INCIDENT_SELF_REFERENCE_PATTERN = re.compile(r"^\s*i(?:'m| am)\s+", re.I)


def _clean_incident_summary(message: str) -> str:
    """Strip the "go and create a ticket for the issue of ..." request
    wrapper, and the "the problem i am facing is ..." narration underneath
    it, so a new incident's short_description reads like a ticket title
    instead of a transcript of the chat message. Only strips phrasing it
    actually recognizes -- a message that already states the problem
    directly passes through unchanged."""
    stripped = _INCIDENT_LEAD_IN_PATTERN.sub("", message, count=1)
    stripped = _INCIDENT_VERB_NOUN_PATTERN.sub("", stripped, count=1).lstrip(" :-–—")
    stripped = _INCIDENT_NARRATIVE_PATTERN.sub("", stripped, count=1).lstrip(" :-–—")
    stripped = _INCIDENT_SELF_REFERENCE_PATTERN.sub("", stripped, count=1)
    stripped = stripped.strip(" :-–—").strip()
    if not stripped:
        return message.strip()[:160]
    return (stripped[:1].upper() + stripped[1:])[:160]


def resolve_incident_summary(intent: dict, message: str) -> str:
    """The one place that decides a new incident's short_description --
    the already-cleaned summary parse_servicenow_write_intent computed, or
    a raw fallback if some caller built its own intent dict without one.
    Used identically by the Basic-Auth, OAuth/MCP, and mock write paths so
    none of them can drift from the others."""
    return intent.get("fields", {}).get("short_description") or message[:160]


_SERVICENOW_CANCEL_KEYWORDS = ["cancel", "cancelled", "canceled"]
_SERVICENOW_CLOSE_KEYWORDS = ["close", "closed"]
_SERVICENOW_RESOLVE_KEYWORDS = ["resolve", "resolved", "mark as done", "mark as complete", "mark complete"]
# "update"/"edit" are unambiguous enough to mean update even with no
# incident number yet (the caller then asks which one). "change"/"modify"/
# "set " are common enough in a fresh incident's own description ("need to
# change the toner") that they only count as update intent once a number
# is already in the message -- otherwise they'd hijack ordinary creates.
_SERVICENOW_UPDATE_STRONG_KEYWORDS = ["update", "edit"]
_SERVICENOW_UPDATE_WEAK_KEYWORDS = ["change", "modify", "set "]

# Free-text fields get written as-is. Priority/urgency/impact are choice
# fields -- ServiceNow stores a coded value, not the label a person would
# type ("high"), and that coding varies by instance, so the label is
# resolved live via sys_choice at write time (see
# platform_connect._resolve_choice_value) instead of guessed here.
_SERVICENOW_TEXT_FIELDS = {"description": "short_description", "short description": "short_description", "title": "short_description"}
_SERVICENOW_CHOICE_FIELDS = {"priority": "priority", "urgency": "urgency", "impact": "impact"}
# The bounded lazy wildcard tolerates filler between the field name and
# "to"/"as" -- real phrasing is "change the priority *on INC0012345* to
# high", not just "priority to high".
_SERVICENOW_FIELD_UPDATE_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(f) for f in [*_SERVICENOW_TEXT_FIELDS, *_SERVICENOW_CHOICE_FIELDS]) +
    r")\b.{0,40}?\b(?:to|as)\s+(.+)$", re.I
)


def parse_servicenow_write_intent(message: str) -> dict:
    """Which lifecycle action this write maps to, and which table -- not
    just "create a new incident" every time. Recognizes create/update/
    assign/resolve/close/cancel/delete against Incident, Problem, Change
    Request, or Request Item (Knowledge Articles are read-only here --
    see SERVICENOW_TABLES).

    Returns {"table": str, "action": "create"|"update"|"assign"|"resolve"|"close"|"cancel"|"delete",
    "incident_number": str|None, "fields": dict, "assignee": str|None}.
    Every action except "create" needs a record number to act on -- the
    caller is responsible for asking for one if it's missing here,
    rather than guessing which record "it" refers to.
    """
    text = message.lower()
    table = detect_servicenow_table(message)
    incident_number = _extract_record_number(message)

    assignee = None
    assign_match = _SERVICENOW_ASSIGN_PATTERN.search(message)
    if assign_match:
        assignee = assign_match.group(1).strip().rstrip(".!?")

    if any(kw in text for kw in _SERVICENOW_DELETE_KEYWORDS):
        action = "delete"
    elif assignee:
        action = "assign"
    elif any(kw in text for kw in _SERVICENOW_CANCEL_KEYWORDS):
        action = "cancel"
    elif any(kw in text for kw in _SERVICENOW_RESOLVE_KEYWORDS):
        action = "resolve"
    elif any(kw in text for kw in _SERVICENOW_CLOSE_KEYWORDS):
        action = "close"
    elif any(kw in text for kw in _SERVICENOW_UPDATE_STRONG_KEYWORDS):
        action = "update"
    elif incident_number and any(kw in text for kw in _SERVICENOW_UPDATE_WEAK_KEYWORDS):
        action = "update"
    else:
        action = "create"

    fields, choice_updates = {}, {}
    if action == "create":
        fields["short_description"] = _clean_incident_summary(message)
    elif action == "update":
        field_match = _SERVICENOW_FIELD_UPDATE_PATTERN.search(message)
        if field_match:
            field_word, value = field_match.group(1).lower(), field_match.group(2).strip().rstrip(".,!?")
            if field_word in _SERVICENOW_TEXT_FIELDS:
                fields[_SERVICENOW_TEXT_FIELDS[field_word]] = value
            else:
                choice_updates[_SERVICENOW_CHOICE_FIELDS[field_word]] = value
        else:
            fields["short_description"] = message[:160]

    return {
        "table": table, "action": action, "incident_number": incident_number,
        "fields": fields, "choice_updates": choice_updates, "assignee": assignee,
    }


def analyze_message(message: str) -> dict:
    """The parts of routing that don't depend on which agents exist: is this
    a write, is it unsafe, does it mention an escalation condition. Used by
    route_message() for auto-routing, and directly when the user has opened
    a specific agent's own chat and bypassed routing entirely."""
    text = message.lower()
    guardrail_blocked, guardrail_reason = _guardrail_check(text)
    is_write = not _is_status_question(message) and (
        any(p.search(text) for p in _WRITE_VERB_PATTERNS) or _has_fuzzy_write_verb(text)
    )
    return {
        "action": "write" if is_write else "read",
        "guardrail_blocked": guardrail_blocked,
        "guardrail_reason": guardrail_reason,
        "escalate": any(kw in text for kw in _ESCALATION_KEYWORDS),
    }


def route_message(message: str, participants: list[dict], last_agent: str | None = None) -> dict:
    """Decide which participant handles this chat message, and whether it's a read or write.

    `last_agent` is whichever specialist handled the previous turn in this
    session (if any) -- a natural follow-up ("what are those", "give me
    the details") won't re-mention the platform by name, so when nothing
    scores a match, falling back to the same agent beats asking the user
    to disambiguate again on every single follow-up.

    Returns {"platform": str|None, "agent": str|None, "action": "read"|"write",
    "decision": str, "guardrail_blocked": bool, "guardrail_reason": str}.
    """
    text = message.lower()
    message_words = _content_words(text)

    analysis = analyze_message(message)
    action = analysis["action"]
    guardrail_blocked, guardrail_reason = analysis["guardrail_blocked"], analysis["guardrail_reason"]

    covered_platforms = {p["platform"] for p in participants}
    mentioned = detect_mentioned_platform(message)
    if mentioned and mentioned not in covered_platforms:
        # The user explicitly named a platform this blueprint has no agent
        # for -- surface that honestly instead of silently routing to
        # whichever unrelated agent happens to exist.
        return {
            "platform": None,
            "agent": None,
            "action": action,
            "decision": f"user asked for '{mentioned}', which has no agent in this blueprint",
            "escalate": False,
            "guardrail_blocked": guardrail_blocked,
            "guardrail_reason": guardrail_reason,
            "uncovered_platform": mentioned,
            "matched_by_score": False,
        }

    best = None
    best_score = 0
    for p in participants:
        platform = p["platform"]
        if platform == "human":
            continue
        score = 0
        if platform in text:
            score += 3
        for kw in _PLATFORM_KEYWORDS.get(platform, []):
            if kw in text:
                score += 2
        for kw in _SUPPORT_TOPIC_KEYWORDS.get(platform, []):
            if kw in text:
                score += 1
        # Agent-specific name/role words outweigh generic platform matches --
        # this is what tells two specialists on the same platform apart
        # (e.g. "Order Status Agent" vs "Returns Agent", both on Salesforce).
        agent_words = _content_words(p["name"]) | _content_words(p.get("role", ""))
        score += 4 * len(agent_words & message_words)
        if score > best_score:
            best_score = score
            best = p

    ambiguous_candidates = None
    stuck_to_last = False
    if best is None and participants:
        # Nothing scored, and the user didn't name an uncovered platform
        # either (handled above) -- genuinely ambiguous on its own. Only
        # safe to guess when there's exactly one real specialist, OR the
        # previous turn in this session was handled by one of them: a
        # follow-up ("what are those") never re-names the platform, so
        # falling back to that same agent beats re-asking every time.
        specialists = [p for p in participants if p["platform"] != "human"]
        if len(specialists) == 1:
            best = specialists[0]
        elif last_agent and any(p["name"] == last_agent for p in specialists):
            best = next(p for p in specialists if p["name"] == last_agent)
            stuck_to_last = True
        else:
            ambiguous_candidates = [p["name"] for p in specialists]

    escalate = False
    if best and any(kw in text for kw in _ESCALATION_KEYWORDS):
        escalate = True

    if stuck_to_last:
        decision = f"nothing new named; continuing with '{best['name']}' from the previous turn"
    else:
        decision = (
            f"matched keyword(s) to '{best['platform']}' (score {best_score})"
            if best
            else "no participant matched confidently; asking rather than guessing"
        )

    return {
        "platform": best["platform"] if best else None,
        "agent": best["name"] if best else None,
        "action": action,
        "decision": decision,
        "escalate": escalate,
        "ambiguous_candidates": ambiguous_candidates,
        "guardrail_blocked": guardrail_blocked,
        "guardrail_reason": guardrail_reason,
        # False for the "only one specialist, so guess them" and "stuck to
        # last agent" fallbacks -- a real keyword/name match, not evidence
        # this message is actually about that platform. Lets a session with
        # trained knowledge try answering from it before blindly routing an
        # unrelated question at whatever specialist happens to exist.
        "matched_by_score": best_score > 0,
    }


_PII_PATTERN = re.compile(r"\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b")
_UNSAFE_KEYWORDS = ["ignore previous instructions", "delete all records", "drop table"]


def _guardrail_check(text: str) -> tuple[bool, str]:
    if _PII_PATTERN.search(text):
        return True, "message appears to contain a card/account number (PII) — blocked by RAI-equivalent guardrail"
    for kw in _UNSAFE_KEYWORDS:
        if kw in text:
            return True, f"message matched an unsafe-action pattern ('{kw}') — blocked by guardrail"
    return False, ""


# ---------------------------------------------------------------- onboarding

_NAME_SUGGESTION_PROMPT = """Suggest 5 short, friendly product names for a company's AI support chatbot \
built on the Aura platform. Output ONLY a JSON object: {"names": ["...", "...", "...", "...", "..."]}. \
Each name should be 1-3 words, no generic words like "Chatbot" or "Assistant" used alone, and no quotes \
or punctuation inside the name itself. Respond with the JSON object only, no prose, no markdown fences.
"""

_FALLBACK_NAME_SUGGESTIONS = ["Aura Assistant", "Helix", "Nova Support", "Pathfinder", "Sage"]


def suggest_chatbot_names() -> tuple[list[str], str]:
    """Returns (names, generated_by) -- same honesty convention as
    generate_blueprint: the caller can tell the user whether these came
    from Cohere or the hardcoded fallback list."""
    if not llm_available():
        return _FALLBACK_NAME_SUGGESTIONS, "heuristic"
    result = _cohere_json(_NAME_SUGGESTION_PROMPT)
    names = result.get("names") if result else None
    if not isinstance(names, list) or not names:
        return _FALLBACK_NAME_SUGGESTIONS, "heuristic-fallback (cohere call failed)"
    cleaned = [str(n).strip() for n in names if str(n).strip()][:5]
    return cleaned or _FALLBACK_NAME_SUGGESTIONS, "llm (cohere)"


# ---------------------------------------------------------------- marketplace

_MARKETPLACE_PROMPT = """You curate a marketplace of pre-built AI agent templates for the Aura platform.
Given a search query, output ONLY a JSON object with this exact shape:

{{
  "overview": "one short paragraph (2-3 sentences) summarizing what kinds of templates match this query",
  "templates": [
    {{
      "id": "kebab-case-id",
      "name": "Short template name",
      "description": "one sentence describing what this template does",
      "blueprint": {{
        "scaffold_type": "multiagent_orchestrator",
        "repo_name": "kebab-case-name",
        "description": "one sentence",
        "root_agent": {{
          "orchestration_class": "Handoff",
          "name": "Root Orchestrator",
          "orchestration_agent": "supervisor",
          "participants": [
            {{"name": "...", "platform": "salesforce|databricks|snowflake|oracle|servicenow|m365|human", \
"role": "...", "read_actions": ["..."], "write_actions": ["..."], "routing_rules": ["..."]}}
          ]
        }},
        "Observability": {{"Platform_Name": "fiddler"}},
        "Guardrail": {{"rai_policy_resource_id": "local-mock-rai-policy"}}
      }}
    }}
  ]
}}

Only use the platform values salesforce, databricks, snowflake, oracle, servicenow, m365, or human. \
Produce between 2 and 4 templates that plausibly match the search query below -- if the query names a \
platform (e.g. "salesforce"), every template's blueprint should use that platform as its primary \
participant. If the query is vague or generic, propose a spread of genuinely different, useful \
templates rather than near-duplicates.

Search query: {query}

Respond with the JSON object only, no prose, no markdown fences.
"""


def _heuristic_marketplace_templates(query: str) -> dict:
    text = query.lower()
    matched = [p for p, kws in _PLATFORM_KEYWORDS.items() if any(kw in text for kw in kws)]
    if not matched:
        matched = [p for p, kws in _SUPPORT_TOPIC_KEYWORDS.items() if any(kw in text for kw in kws)]
    if not matched:
        matched = ["salesforce", "servicenow"]

    templates = []
    for platform in matched[:3]:
        label = platform.capitalize()
        templates.append({
            "id": f"{platform}-starter",
            "name": f"{label} Support Agent",
            "description": f"Reads and writes {label} records to handle day-to-day {label} requests.",
            "blueprint": {
                "scaffold_type": "multiagent_orchestrator",
                "repo_name": f"{platform}-starter-agent",
                "description": f"Starter template for a {label}-backed support agent.",
                "root_agent": {
                    "orchestration_class": "Handoff",
                    "name": "Root Orchestrator",
                    "orchestration_agent": "supervisor",
                    "participants": [_participant(f"{label} Agent", platform, f"Reads and writes {label} records")],
                },
                "Observability": {"Platform_Name": "fiddler"},
                "Guardrail": {"rai_policy_resource_id": "local-mock-rai-policy"},
            },
        })
    overview = (
        f"Keyword match for \"{query}\" — showing starter templates for "
        f"{', '.join(p.capitalize() for p in matched[:3])}. Set COHERE_API_KEY for richer, query-specific "
        "suggestions."
    )
    return {"overview": overview, "templates": templates, "generated_by": "heuristic"}


def generate_marketplace_templates(query: str) -> dict:
    if not llm_available():
        return _heuristic_marketplace_templates(query)
    result = _cohere_json(_MARKETPLACE_PROMPT.format(query=query))
    if not result or not result.get("templates"):
        fallback = _heuristic_marketplace_templates(query)
        fallback["generated_by"] = "heuristic-fallback (cohere call failed)"
        return fallback
    result["generated_by"] = "llm (cohere)"
    return result


# ------------------------------------------------------------- knowledge base

_KNOWLEDGE_ANSWER_PROMPT = """Answer the user's question using ONLY the context below. If the context \
doesn't contain enough information to answer, say plainly that you don't have that information -- never \
guess or use outside knowledge.

Context:
---
{context}
---

Question: {question}

Answer in 2-4 sentences, plain text, no markdown.
"""


def _cohere_text(prompt: str) -> str | None:
    """Like _cohere_json, but for a free-text answer -- no response_format
    constraint, since forcing JSON onto a prose answer would just add noise
    the caller has to strip back out."""
    try:
        client = _cohere_client()
        resp = client.chat(model=_COHERE_MODEL, messages=[{"role": "user", "content": prompt}])
        return next(item.text for item in resp.message.content if getattr(item, "text", None)).strip()
    except Exception:
        return None


def answer_from_knowledge(question: str, knowledge_text: str) -> str | None:
    """None means "couldn't ground an answer" -- either no Cohere key, no
    stored knowledge, or the call itself failed. Callers should fall back to
    whatever they'd have said anyway, never invent an answer on None."""
    if not llm_available() or not knowledge_text.strip():
        return None
    prompt = _KNOWLEDGE_ANSWER_PROMPT.format(context=knowledge_text[:8000], question=question)
    return _cohere_text(prompt)
