#!/usr/bin/env python3
"""Rebuild source graphs separately from the owned ledger projection (#145)."""

from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


SPEC = importlib.util.spec_from_file_location("graphify_links", Path(__file__).with_name("graphify-links.py"))
links = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(links)


def source_graph(graph):
    """Remove only owned records; reject foreign references to the removed nodes."""
    links.validate_graph(graph)
    result = deepcopy(graph)
    result["nodes"] = [n for n in result["nodes"] if n.get("_traceability_owner") != links.OWNER]
    result["links"] = [e for e in result.get("links", result.get("edges", []))
                       if e.get("_traceability_owner") != links.OWNER]
    result.pop("edges", None)
    result.pop("traceability", None)
    links.validate_graph(result)
    return result


def verify_preserved(previous, candidate):
    """Node-count growth must not hide an unrelated missing source/semantic node."""
    links.validate_graph(candidate)
    links.require(all(candidate.get(key, False) == previous.get(key, False) for key in ("directed", "multigraph")),
                  "Graphify changed the graph type; reconcile directed/multigraph semantics explicitly")
    ids = {n["id"] for n in candidate["nodes"]}
    missing = [n for n in previous["nodes"] if n["id"] not in ids]
    if missing:
        examples = "; ".join(f"{n['id']} ({n.get('source_file', 'unknown source')})" for n in missing[:10])
        raise ValueError(f"{len(missing)} non-ledger nodes disappeared; review source deletions separately: {examples}")


def read_optional(path):
    return path.read_bytes() if path.exists() else None


def source_snapshot(root):
    """Track repository inputs across extraction; generated graph files are separate."""
    result = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                            cwd=root, capture_output=True, check=True)
    snapshot = {}
    for name in sorted(set(os.fsdecode(value) for value in result.stdout.split(b"\0") if value)):
        if name.startswith("graphify-out/"):
            continue
        path = root / name
        snapshot[name] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    return snapshot


def update(root, graphify="graphify", check=False, runner=subprocess.run, snapshotter=source_snapshot):
    root = root.resolve()
    out = root / "graphify-out"
    ledger_path = root / "agent-state/work-ledger.json"
    ledger_bytes = ledger_path.read_bytes()
    ledger = json.loads(ledger_bytes)
    projection = links.build_projection(ledger, "agent-state/work-ledger.json", hashlib.sha256(ledger_bytes).hexdigest())
    graph_path = out / "graph.json"
    original = graph_path.read_bytes()
    previous = source_graph(json.loads(original))
    # Graphify writes manifest.json relative to CWD even when GRAPHIFY_OUT is set.
    # Both the subprocess CWD and GRAPHIFY_OUT therefore belong to the scratch area.
    names = ("graph.json", "manifest.json", "GRAPH_REPORT.md", ".graphify_labels.json", ".graphify_root",
             "traceability.json", "effort-summary.json")
    before = {name: read_optional(out / name) for name in names}
    before["graph.json"] = original
    inputs = snapshotter(root)
    with tempfile.TemporaryDirectory(prefix="sketchdraw-graphify-") as directory:
        stage = Path(directory)
        staged_out = stage / "graphify-out"
        staged_out.mkdir()
        (staged_out / "graph.json").write_text(links.encoded(previous), encoding="utf-8")
        for name in ("manifest.json", ".graphify_labels.json"):
            if before[name] is not None:
                (staged_out / name).write_bytes(before[name])
        executable = shutil.which(graphify)
        links.require(executable is not None, f"Graphify executable not found: {graphify}")
        executable = str(Path(executable).absolute())
        env = {**os.environ, "GRAPHIFY_OUT": str(staged_out), "GRAPHIFY_NO_TIPS": "1"}
        env.pop("GRAPHIFY_FORCE", None)
        completed = runner([executable, "update", str(root)], cwd=stage, env=env,
                           text=True, capture_output=True, check=False)
        if completed.stdout:
            print(completed.stdout, end="")
        if completed.stderr:
            print(completed.stderr, file=sys.stderr, end="")
        links.require(completed.returncode == 0, "Graphify rebuild failed; live graph files were not changed")
        candidate = json.loads((staged_out / "graph.json").read_bytes())
        verify_preserved(previous, candidate)
        # The source rebuild owns its topology and clustering, not unrelated
        # graph-level extension metadata supplied by another adapter.
        candidate = {**previous, **candidate,
                     "graph": {**previous.get("graph", {}), **candidate.get("graph", {})}}
        revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, text=True, capture_output=True)
        candidate.pop("built_at_commit", None)
        if revision.returncode == 0:
            candidate["built_at_commit"] = revision.stdout.strip()
        merged = links.merge_graph(candidate, projection)
        outputs = {name: (staged_out / name).read_bytes() for name in names
                   if (staged_out / name).is_file()}
        outputs.update({"graph.json": links.encoded(merged).encode(),
                        "traceability.json": links.encoded(projection).encode(),
                        "effort-summary.json": links.encoded(links.summarize(ledger)).encode(),
                        ".graphify_root": b"."})
        links.require("manifest.json" in outputs, "Graphify did not produce its source manifest")
        decoded_outputs = {name: data.decode("utf-8") for name, data in outputs.items()}
        links.require(ledger_path.read_bytes() == ledger_bytes, "ledger changed during extraction; rerun")
        links.require(snapshotter(root) == inputs, "repository inputs changed during extraction; rerun")
        links.require(all(read_optional(out / name) == data for name, data in before.items()),
                      "graph outputs changed during extraction; rerun")
        if not check:
            # As for graphify-links, each replacement is atomic; the group is not.
            # No other graph writer may run concurrently. Re-run after interruption.
            for name, data in decoded_outputs.items():
                links.write_atomic(out / name, data)
        print(f"{'Validated' if check else 'Updated'} {len(candidate['nodes'])} source nodes + "
              f"{len(projection['nodes'])} owned ledger nodes; no non-ledger node lost; no force override.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--graphify", default="graphify", help="Graphify executable path")
    parser.add_argument("--check", action="store_true", help="extract and validate in scratch storage without publishing")
    args = parser.parse_args(argv)
    try:
        return update(args.root, args.graphify, args.check)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"graphify-update: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
