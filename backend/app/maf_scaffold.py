"""Generates the real Microsoft Agent Framework (MAF) YAML config for a
blueprint -- the same file shapes the real AURA-Agent-Orchestrator produces
(see aura-agent-builder-orchestrator-azure/app/core/yaml_config_generator.py
and app/services/scaffold_pipeline.py, which this deliberately mirrors field
-for-field so the output is genuinely MAF-shaped, not just plausible-looking)
-- written to a local folder instead of pushed to a new GitHub repo and
deployed to Azure Container Apps, since this app has no GitHub/Azure access.

This is the concrete answer to "create a MAF-like Aura scaffold so we don't
need that access": you get real root-agent-config.yaml + participants/*.yaml
files on disk, in the shape the real orchestrator's runtime expects, with
the handful of values only a live Azure/Foundry project can supply (project
endpoint, container registry, model deployment name) left as clearly marked
placeholders -- fill those in and this is what you'd hand to the real
pipeline, or run directly with `pip install agent-framework`.
"""

from pathlib import Path

import yaml

_SCAFFOLD_ROOT = Path(__file__).parent.parent / "generated_scaffolds"

_PLACEHOLDER_MODEL = "<your-azure-ai-foundry-model-deployment-name>"
_PLACEHOLDER_FOUNDRY = "<your-azure-ai-foundry-project-endpoint>"
_PLACEHOLDER_ACR = "<your-acr-name>.azurecr.io"


class _ADKDumper(yaml.SafeDumper):
    """Matches the real orchestrator's dumper: no YAML aliases, multi-line
    strings written as literal blocks."""

    def ignore_aliases(self, data) -> bool:
        return True

    def represent_str(self, data):
        style = "|" if "\n" in data else None
        return self.represent_scalar("tag:yaml.org,2002:str", data, style=style)


_ADKDumper.add_representer(dict, lambda dumper, data: dumper.represent_mapping("tag:yaml.org,2002:map", data.items()))
_ADKDumper.add_representer(str, _ADKDumper.represent_str)


def _create_agent_yaml(agent: dict) -> dict:
    """Same field selection/ordering rules as the real orchestrator's
    create_agent_yaml() -- a Handoff root writes orchestrator fields (name,
    orchestration_agent, handoff_rules, ...) and never participant-level
    ones (instruction/tools); an Agent participant writes the reverse."""
    raw_class = agent.get("orchestration_class")
    out: dict = {}

    if raw_class == "Handoff":
        fixed = {
            "orchestration_class", "name", "description", "orchestration_agent",
            "model", "termination_keyword", "autonomous_mode", "handoff_rules",
        }
        excluded = {"tools", "instruction", "participants"}
        for k, v in agent.items():
            if k not in fixed and k not in excluded and v is not None:
                out[k] = v
        out["orchestration_class"] = "Handoff"
        out["name"] = agent.get("name", "")
        if agent.get("description"):
            out["description"] = agent["description"]
        if agent.get("orchestration_agent"):
            out["orchestration_agent"] = agent["orchestration_agent"]
        if agent.get("model"):
            out["model"] = agent["model"]
        if agent.get("handoff_rules"):
            out["handoff_rules"] = agent["handoff_rules"]
        return out

    out["name"] = agent.get("name", "")
    out["orchestration_class"] = raw_class or "Agent"
    if agent.get("model"):
        out["model"] = agent["model"]
    if agent.get("description"):
        out["description"] = agent["description"]
    if agent.get("instruction"):
        out["instruction"] = agent["instruction"]
    if agent.get("tools"):
        out["tools"] = agent["tools"]
    return out


def _slug(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")


def _participant_agent_dict(p: dict) -> dict:
    # Read/write actions become MCP tool references -- Agent Framework's own
    # documented mechanism for connecting an agent to external systems. No
    # MCP servers actually exist for these yet; that's the real remaining
    # work (see the generated README) once real access is available.
    tools = [
        {"type": "mcp", "name": f"{p['platform']}_{_slug(a)}", "description": f"Read: {a}"}
        for a in p.get("read_actions", [])
    ] + [
        {"type": "mcp", "name": f"{p['platform']}_{_slug(a)}", "description": f"Write: {a}"}
        for a in p.get("write_actions", [])
    ]
    instruction = p.get("role", "")
    if p.get("routing_rules"):
        instruction = f"{instruction}\nHandoff rules: {'; '.join(p['routing_rules'])}".strip()
    return {
        "name": _slug(p["name"]),
        "orchestration_class": "Agent",
        "model": _PLACEHOLDER_MODEL,
        "description": p.get("role", ""),
        "instruction": instruction,
        "tools": tools,
    }


def write_scaffold(blueprint: dict) -> Path:
    """Writes config/root-agent-config.yaml + config/participants/*.yaml for
    this blueprint, in the real MAF shape, to a local folder. Returns that
    folder's path (the repo root, one level above config/)."""
    root = blueprint["root_agent"]
    repo_name = blueprint.get("repo_name", "aura-agent")
    repo_dir = _SCAFFOLD_ROOT / repo_name
    config_dir = repo_dir / "config"
    participants_dir = config_dir / "participants"
    participants_dir.mkdir(parents=True, exist_ok=True)

    specialists = [p for p in root["participants"] if p["platform"] != "human"]
    escalations = [p for p in root["participants"] if p["platform"] == "human"]

    root_agent_dict = {
        "foundry_project_endpoint": _PLACEHOLDER_FOUNDRY,
        "azure_container_registry": _PLACEHOLDER_ACR,
        "orchestration_class": "Handoff",
        "name": _slug(root["name"]),
        "description": blueprint.get("description", ""),
        "orchestration_agent": specialists[0]["name"] and _slug(specialists[0]["name"]) if specialists else "",
        "model": _PLACEHOLDER_MODEL,
    }
    handoff_rules = [
        {"to": "human_escalation", "when": rule}
        for p in escalations for rule in p.get("routing_rules", [])
    ]
    if handoff_rules:
        root_agent_dict["handoff_rules"] = handoff_rules
    if blueprint.get("Observability"):
        root_agent_dict["Observability"] = blueprint["Observability"]
    rai_policy = blueprint.get("Guardrail", {}).get("rai_policy_resource_id")
    if rai_policy:
        root_agent_dict["azure_rai_policy_id"] = rai_policy

    root_yaml = _create_agent_yaml(root_agent_dict)
    root_yaml["participants"] = [{"config_path": f"participants/{_slug(p['name'])}.yaml"} for p in specialists]

    _dump(config_dir / "root-agent-config.yaml", {"root_agent": root_yaml})
    for p in specialists:
        _dump(participants_dir / f"{_slug(p['name'])}.yaml", _create_agent_yaml(_participant_agent_dict(p)))

    (repo_dir / "README.md").write_text(_readme(repo_name, specialists, escalations), encoding="utf-8")
    return repo_dir


def _dump(path: Path, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write("# Generated by Tachyon Aura Agent Factory -- MAF-format config, no Azure/GitHub access used.\n")
        f.write("# See ../README.md for what's a real value vs. a placeholder you must fill in.\n")
        yaml.dump(data, f, Dumper=_ADKDumper, sort_keys=False, default_flow_style=False, allow_unicode=True)


def _readme(repo_name: str, specialists: list[dict], escalations: list[dict]) -> str:
    specialist_lines = "\n".join(f"- `{_slug(p['name'])}.yaml` -- {p['name']} ({p['platform']})" for p in specialists)
    escalation_note = (
        "\nHuman escalation (" + ", ".join(p["name"] for p in escalations) + ") is represented only as "
        "`handoff_rules` on the root -- this MAF schema has no native \"human\" agent type, so there's no "
        "participants/*.yaml for it.\n"
        if escalations else ""
    )
    return f"""# {repo_name} -- MAF scaffold (generated locally, not deployed)

This is the real Microsoft Agent Framework config shape -- the same files
`aura-agent-builder-orchestrator-azure` would generate and push to a new
GitHub repo for Azure deployment. Generated here instead, since this app
has no GitHub App or Azure credentials.

## Files

- `config/root-agent-config.yaml` -- the Handoff root orchestrator.
{specialist_lines}
{escalation_note}
## Placeholders you must fill in before this can run for real

- `foundry_project_endpoint` / `model` -- an Azure AI Foundry project + model deployment.
- `azure_container_registry` -- only needed if you go through the real orchestrator's
  container build/deploy pipeline.
- Every `tools` entry is a placeholder MCP (Model Context Protocol) tool reference --
  Agent Framework's own documented mechanism for connecting an agent to external systems.
  No MCP server exists yet for Salesforce/Databricks/etc.; implementing and hosting those
  (or pointing at ones that already expose these operations) is the real remaining work.

## To actually run this

- Locally: `pip install agent-framework`, then load these YAML files (or hand-port them
  into Python `agent_framework` code) against a real Foundry project.
- On Azure, for real: push this folder into a repo and run it through
  `aura-agent-builder-orchestrator-azure`'s `/scaffold` pipeline, or deploy it to Azure
  Container Apps by hand.
"""
