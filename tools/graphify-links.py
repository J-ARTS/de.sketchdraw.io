#!/usr/bin/env python3
"""Project the work ledger into Graphify without inferring measurements (issue #7)."""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import quote


OWNER = "sketchdraw-work-ledger-v1"
PREFIX = "traceability:"
METRICS = ("observedSeconds", "tokens", "costUsd")


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text_value(value, field):
    require(isinstance(value, str) and bool(value.strip()), f"{field} must be a nonempty string")
    return value


def number(value, field):
    require(value is None or (type(value) in (int, float) and math.isfinite(value) and value >= 0),
            f"{field} must be a finite nonnegative number or null")


def timestamp(value, field, nullable=False):
    if value is None and nullable:
        return None
    text_value(value, field)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO timestamp") from exc
    require(parsed.utcoffset() is not None, f"{field} must include a timezone")
    return parsed


def ref_value(value, field):
    if isinstance(value, str):
        return text_value(value, field)
    require(isinstance(value, dict), f"{field} must be a string or object")
    for key in ("path", "url", "id", "summary", "title", "description"):
        if value.get(key):
            return text_value(value[key], field + "." + key)
    raise ValueError(f"{field} needs a path, url, id, summary, title or description")


def validate_ledger(ledger):
    require(isinstance(ledger, dict), "ledger must be an object")
    require(ledger.get("schemaVersion") == 1, "unsupported ledger schemaVersion")
    text_value(ledger.get("repository"), "repository")
    timestamp(ledger.get("updatedAt"), "updatedAt")
    require(isinstance(ledger.get("issues"), list), "issues must be an array")
    require(isinstance(ledger.get("runs"), list), "runs must be an array")
    issue_ids = set()
    for issue in ledger["issues"]:
        require(isinstance(issue, dict), "issue must be an object")
        num = issue.get("number")
        require(type(num) is int and num > 0, "issue number must be a positive integer")
        require(num not in issue_ids, f"duplicate issue #{num}")
        issue_ids.add(num)
        for field in ("title", "url", "owner", "phase", "status"):
            text_value(issue.get(field), f"issue #{num}.{field}")
        effort = issue.get("estimatedEffort")
        require(isinstance(effort, dict), f"issue #{num}.estimatedEffort must be an object")
        require(effort.get("kind") == "planning_estimate" and effort.get("unit") == "story_points",
                f"issue #{num} effort must be a planning_estimate in story_points")
        require("value" in effort, f"issue #{num}.estimatedEffort.value is required (null if unknown)")
        number(effort["value"], f"issue #{num}.estimatedEffort.value")
    for issue in ledger["issues"]:
        dependencies = issue.get("dependencies")
        require(isinstance(dependencies, list), "dependencies must be an array")
        require(all(type(n) is int and n in issue_ids for n in dependencies),
                f"issue #{issue['number']} has an unknown dependency")
        require(len(dependencies) == len(set(dependencies)), "duplicate dependency")
        require(issue["number"] not in dependencies, "issue cannot depend on itself")
    run_ids = set()
    for run in ledger["runs"]:
        require(isinstance(run, dict), "run must be an object")
        run_id = text_value(run.get("id"), "run.id")
        require(run_id not in run_ids, f"duplicate run {run_id}")
        run_ids.add(run_id)
        for field in ("tool", "status"):
            text_value(run.get(field), f"run {run_id}.{field}")
        require(run.get("model") is None or isinstance(run["model"], str), "model must be a string or null")
        issues = run.get("issues")
        require(isinstance(issues, list) and issues, f"run {run_id}.issues must be nonempty")
        require(all(type(n) is int and n in issue_ids for n in issues), f"run {run_id} references an unknown issue")
        require(len(issues) == len(set(issues)), f"run {run_id} has duplicate issue references")
        start = timestamp(run.get("startedAt"), f"run {run_id}.startedAt", nullable=True)
        end = timestamp(run.get("endedAt"), f"run {run_id}.endedAt", nullable=True)
        require(end is None or (start is not None and end >= start), f"run {run_id} has invalid time order")
        for metric in METRICS:
            require(metric in run, f"run {run_id}.{metric} is required (null if unknown)")
            number(run[metric], f"run {run_id}.{metric}")
        require(run["tokens"] is None or type(run["tokens"]) is int, "tokens must be an integer or null")
        for field in ("artifacts", "concerns"):
            require(isinstance(run.get(field), list), f"run {run_id}.{field} must be an array")
            for value in run[field]:
                ref_value(value, f"run {run_id}.{field}")


def aggregate(runs):
    """Only complete coverage produces a total; a known subtotal is never a total."""
    unique = {run["id"]: run for run in runs}
    require(len(unique) == len(runs), "duplicate run in aggregation")
    result = {"runIds": sorted(unique), "runCount": len(unique)}
    for metric in METRICS:
        known = [run[metric] for run in unique.values() if run[metric] is not None]
        subtotal = sum(known)
        result[metric] = {"knownSubtotal": subtotal, "knownRuns": len(known),
                          "unknownRuns": len(unique) - len(known),
                          "total": subtotal if unique and len(known) == len(unique) else None}
    return result


def summarize(ledger):
    runs = ledger["runs"]
    estimates = [issue["estimatedEffort"]["value"] for issue in ledger["issues"]]
    known_estimates = [value for value in estimates if value is not None]
    return {
        "repository": ledger["repository"], "updatedAt": ledger["updatedAt"],
        "operationalOnly": True, "officialScoreClaimReady": False,
        "policy": "Global/tool totals count each run once. Issue totals use exclusive runs only. Shared runs are unallocated. Elapsed run seconds are not human work hours or project elapsed time.",
        "planning": {"kind": "planning_estimate", "unit": "story_points",
                     "knownSubtotal": sum(known_estimates), "unknownIssues": len(estimates) - len(known_estimates),
                     "total": sum(known_estimates) if estimates and len(known_estimates) == len(estimates) else None},
        "observed": aggregate(runs),
        "byTool": {tool: aggregate([run for run in runs if run["tool"] == tool])
                   for tool in sorted({run["tool"] for run in runs})},
        "byIssue": {str(issue["number"]): {
            "planning": issue["estimatedEffort"],
            "exclusiveRuns": aggregate([run for run in runs if run["issues"] == [issue["number"]]]),
            "sharedUnallocatedRunIds": sorted(run["id"] for run in runs
                                              if issue["number"] in run["issues"] and len(run["issues"]) > 1),
        } for issue in sorted(ledger["issues"], key=lambda value: value["number"])},
    }


def node_id(kind, value):
    return PREFIX + kind + ":" + quote(str(value), safe="")


def build_projection(ledger, source="agent-state/work-ledger.json", source_hash=None):
    validate_ledger(ledger)
    source_hash = source_hash or hashlib.sha256(encoded(ledger).encode()).hexdigest()
    nodes, edges = {}, {}

    def evidence(pointer):
        return {"source_file": source, "source_location": pointer, "source_sha256": source_hash,
                "extractor": OWNER, "timestamp": ledger["updatedAt"]}

    def metadata(pointer):
        return {"_traceability_owner": OWNER, "source_file": source, "source_location": pointer,
                "provenance": evidence(pointer), "timestamp": ledger["updatedAt"],
                "confidence": "EXTRACTED", "confidence_score": 1.0,
                "validation_state": "schema_validated", "review_status": "not_independently_reviewed",
                "operational_only": True}

    def node(kind, value, label, subgraph, pointer, /, **attrs):
        nid = node_id(kind, value)
        if nid not in nodes:
            nodes[nid] = {**metadata(pointer), "id": nid, "label": label, "file_type": "concept",
                          "node_type": kind, "subgraph": subgraph, "evidence": [], **attrs}
        proof = evidence(pointer)
        if proof not in nodes[nid]["evidence"]:
            nodes[nid]["evidence"].append(proof)
        return nid

    def edge(source_id, target_id, relation, pointer):
        key = (source_id, target_id, relation)
        if key not in edges:
            edges[key] = {**metadata(pointer), "source": source_id, "target": target_id,
                          "relation": relation, "context": "traceability", "weight": 1.0,
                          "from_subgraph": nodes[source_id]["subgraph"],
                          "to_subgraph": nodes[target_id]["subgraph"], "evidence": []}
        proof = evidence(pointer)
        if proof not in edges[key]["evidence"]:
            edges[key]["evidence"].append(proof)

    for index, issue in enumerate(ledger["issues"]):
        pointer = f"/issues/{index}"
        issue_id = node("issue", issue["number"], f"Ticket #{issue['number']}: {issue['title']}",
                        "task-plan", pointer, **issue)
        owner_id = node("agent", issue["owner"], "Verantwortung: " + issue["owner"],
                        "agent-tool-capability", pointer + "/owner", assignment=issue["owner"])
        edge(issue_id, owner_id, "assigned_to", pointer + "/owner")
        estimate = issue["estimatedEffort"]
        plan_id = node("plan", issue["number"],
                       f"Planaufwand #{issue['number']}: {estimate['value'] if estimate['value'] is not None else 'unbekannt'} Story Points",
                       "task-plan", pointer + "/estimatedEffort", **estimate)
        edge(issue_id, plan_id, "has_planning_estimate", pointer + "/estimatedEffort")
    for index, issue in enumerate(ledger["issues"]):
        for dependency in issue["dependencies"]:
            edge(node_id("issue", issue["number"]), node_id("issue", dependency), "depends_on", f"/issues/{index}/dependencies")
    for index, run in enumerate(ledger["runs"]):
        pointer = f"/runs/{index}"
        run_id = node("run", run["id"], "Run " + run["id"], "resource-operational", pointer,
                      run_id=run["id"], data=deepcopy(run))
        tool_id = node("tool", run["tool"], "Tool " + run["tool"], "agent-tool-capability", pointer + "/tool",
                       tool=run["tool"])
        edge(tool_id, run_id, "executed_run", pointer)
        for issue_number in run["issues"]:
            issue_id = node_id("issue", issue_number)
            edge(issue_id, tool_id, "uses_tool", pointer)
            edge(issue_id, run_id, "has_run", pointer + "/issues")
        values = {metric: run[metric] for metric in METRICS}
        metric_label = ", ".join(f"{name}={value if value is not None else 'unbekannt'}" for name, value in values.items())
        effort_id = node("effort", run["id"], "Ist-Aufwand " + run["id"] + ": " + metric_label,
                         "evaluation-feedback", pointer, measurement_kind="reported_observation", **values)
        edge(run_id, effort_id, "reports_observed_effort", pointer)
        for field, kind, subgraph, relation in (("artifacts", "artifact", "artifact-traceability", "produced_artifact"),
                                                ("concerns", "concern", "claim", "raised_concern")):
            for item_index, value in enumerate(run[field]):
                ref = ref_value(value, field)
                # Run-scoped claims/outputs prevent conflicting records from being silently merged.
                identity = run["id"] + ":" + hashlib.sha256(encoded(value).encode()).hexdigest()[:16]
                item_id = node(kind, identity, kind.capitalize() + ": " + ref, subgraph,
                               pointer + f"/{field}/{item_index}", value=deepcopy(value),
                               validation_state="recorded_unverified")
                edge(run_id, item_id, relation, pointer + f"/{field}/{item_index}")
    graph = {"directed": False, "multigraph": False, "graph": {},
             "nodes": sorted(nodes.values(), key=lambda value: value["id"]),
             "links": [edges[key] for key in sorted(edges)],
             "traceability": {"owner": OWNER, "source": source, "source_sha256": source_hash,
                              "timestamp": ledger["updatedAt"], "validation_state": "schema_validated",
                              "operational_only": True, "official_score_claim_ready": False}}
    validate_graph(graph)
    return graph


def validate_graph(graph):
    require(isinstance(graph, dict), "graph must be an object")
    require(isinstance(graph.get("nodes"), list), "graph.nodes must be an array")
    require(not ("links" in graph and "edges" in graph), "graph cannot have both links and edges")
    links = graph.get("links", graph.get("edges", []))
    require(isinstance(links, list), "graph links/edges must be an array")
    ids = []
    for node in graph["nodes"]:
        require(isinstance(node, dict), "graph node must be an object")
        ids.append(text_value(node.get("id"), "graph node id"))
    require(len(ids) == len(set(ids)), "duplicate graph node id")
    ids = set(ids)
    for field in ("directed", "multigraph"):
        require(type(graph.get(field, False)) is bool, f"graph.{field} must be a boolean")
    endpoint_keys = {}
    for edge in links:
        require(isinstance(edge, dict)
                and isinstance(edge.get("source"), str) and edge["source"] in ids
                and isinstance(edge.get("target"), str) and edge["target"] in ids,
                "graph edge references an unknown endpoint")
        pair = (edge["source"], edge["target"])
        if not graph.get("directed", False):
            pair = tuple(sorted(pair))
        if not graph.get("multigraph", False):
            require(pair not in endpoint_keys, "parallel edges would collapse in a non-multigraph: " + repr(pair))
            endpoint_keys[pair] = set()
        else:
            keys = endpoint_keys.setdefault(pair, set())
            key = edge.get("key")
            if key is None:
                # Match NetworkX's automatic keys, including later explicit-key collisions.
                key = len(keys)
                while key in keys:
                    key += 1
            require(isinstance(key, (str, int, float)), "multigraph edge key must be a string or number")
            require(key not in keys, "parallel edges would collapse under a duplicate multigraph key: " + repr(pair))
            keys.add(key)
    graph_metadata = graph.get("graph", {})
    require(isinstance(graph_metadata, dict), "graph.graph must be an object")
    for location, container in (("hyperedges", graph), ("graph.hyperedges", graph_metadata)):
        hyperedges = container.get("hyperedges", [])
        require(isinstance(hyperedges, list), location + " must be an array")
        for hyperedge in hyperedges:
            require(isinstance(hyperedge, dict), location + " entries must be objects")
            fields = [field for field in ("nodes", "members") if field in hyperedge]
            require(bool(fields), location + " entries need a nodes or members array")
            for field in fields:
                members = hyperedge[field]
                require(isinstance(members, list), location + "." + field + " must be an array")
                require(all(isinstance(member, str) and member in ids for member in members),
                        location + "." + field + " references an unknown endpoint")


def merge_graph(existing, projection):
    """Replace only this adapter's projection; preserve every foreign record and metadata."""
    validate_graph(existing)
    validate_graph(projection)
    merged = deepcopy(existing)
    foreign_nodes = [node for node in merged["nodes"] if node.get("_traceability_owner") != OWNER]
    reserved = {node["id"] for node in projection["nodes"]}
    require(not any(node["id"] in reserved for node in foreign_nodes), "foreign node collides with traceability namespace")
    foreign_edges = [edge for edge in merged.get("links", merged.get("edges", []))
                     if edge.get("_traceability_owner") != OWNER]
    merged.pop("edges", None)
    merged["nodes"] = foreign_nodes + deepcopy(projection["nodes"])
    merged["links"] = foreign_edges + deepcopy(projection["links"])
    merged.setdefault("directed", False)
    merged.setdefault("multigraph", False)
    merged.setdefault("graph", {})
    if merged["multigraph"]:
        for index, edge in enumerate(merged["links"][len(foreign_edges):]):
            edge["key"] = OWNER + ":" + str(index)
    merged["traceability"] = deepcopy(projection["traceability"])
    # Foreign links to retired owned nodes must be reconciled explicitly, never discarded.
    validate_graph(merged)
    return merged


def write_atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_paths(paths):
    """Reject aliased input/output roles before reads, serialization or writes."""
    resolved = []
    for role, path in paths:
        canonical = path.resolve()
        for previous_role, previous in resolved:
            same_file = canonical == previous
            if not same_file and canonical.exists() and previous.exists():
                same_file = canonical.samefile(previous)
            require(not same_file, f"path collision between {previous_role} and {role}: {canonical}")
        resolved.append((role, canonical))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=Path("agent-state/work-ledger.json"))
    parser.add_argument("--graph", type=Path, default=Path("graphify-out/graph.json"))
    parser.add_argument("--check", action="store_true", help="validate input and verify generated files are current, without writing")
    args = parser.parse_args(argv)
    try:
        projection_path = args.graph.parent / "traceability.json"
        summary_path = args.graph.parent / "effort-summary.json"
        validate_paths((("ledger input", args.ledger), ("graph input/output", args.graph),
                        ("traceability output", projection_path), ("effort summary output", summary_path)))
        ledger_bytes = args.ledger.read_bytes()
        ledger = json.loads(ledger_bytes)
        projection = build_projection(ledger, args.ledger.as_posix(), hashlib.sha256(ledger_bytes).hexdigest())
        previous = args.graph.read_bytes() if args.graph.exists() else None
        existing = json.loads(previous) if previous is not None else {"nodes": [], "links": []}
        merged = merge_graph(existing, projection)
        outputs = {args.graph: encoded(merged),
                   projection_path: encoded(projection), summary_path: encoded(summarize(ledger))}
        if args.check:
            stale = [str(path) for path, content in outputs.items() if not path.exists() or path.read_text() != content]
            require(not stale, "generated files are stale: " + ", ".join(stale))
            print("Ledger references, metrics and generated Graphify projection are valid and current.")
            return 0
        require(args.ledger.read_bytes() == ledger_bytes, "ledger changed during generation; rerun")
        require((args.graph.read_bytes() if args.graph.exists() else None) == previous,
                "graph changed during generation; rerun")
        for path, content in outputs.items():
            write_atomic(path, content)
        print(f"Merged {len(projection['nodes'])} traceability nodes and {len(projection['links'])} links; unknown metrics remain null.")
        return 0
    except (ValueError, OSError) as exc:
        print(f"graphify-links: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
