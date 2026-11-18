"""Deploys an approved blueprint.

This does NOT call the real AURA-Agent-Orchestrator -- there's no GitHub App
or Azure credentials in this environment, and more importantly this app
isn't meant to depend on that service. It borrows Aura's underlying idea
(a root orchestrator handing off to platform-specific specialist agents,
built from a reviewable blueprint) and implements "build and deploy" as a
self-contained step: each participant is activated directly against its own
target platform connector (mocked -- see mock_platforms.py), gets its own
deployment record, and is immediately reachable through the root
orchestrator's handoff.
"""

import uuid

from . import trace_store


def deploy_blueprint(session_id: str, blueprint: dict) -> list[dict]:
    deployments = []
    for p in blueprint["root_agent"]["participants"]:
        platform = p["platform"]
        deployment_id = f"{platform}-{uuid.uuid4().hex[:8]}"
        endpoint = "human-queue" if platform == "human" else f"aura://{platform}/{deployment_id}"
        record = {
            "agent": p["name"],
            "platform": platform,
            "deployment_id": deployment_id,
            "endpoint": endpoint,
        }
        deployments.append(record)
        trace_store.record(
            session_id,
            trace_store.new_event(
                "build", p["name"], f"deployed to {platform} ({endpoint})", 60,
                decision=f"activated against the {platform} connector" if platform != "human" else "activated as the escalation queue",
                platform=platform,
            ),
        )

    trace_store.record(
        session_id,
        trace_store.new_event(
            "build", blueprint["root_agent"]["name"],
            f"{len(deployments)} specialist(s) online, Handoff routing active", 20,
            decision="root orchestrator now routes live traffic to the deployed specialists",
        ),
    )
    return deployments
