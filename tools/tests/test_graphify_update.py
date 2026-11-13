"""Keep generated ledger records out of Graphify's entity deduplication (#145)."""

from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
from subprocess import CompletedProcess
import sys
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("graphify_update", Path(__file__).parents[1] / "graphify-update.py")
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)
links = updater.links


def fixture(root):
    ledger = {"schemaVersion": 1, "repository": "test/repo", "updatedAt": "2026-11-13T09:00:00Z",
              "issues": [{"number": 145, "title": "Graph update", "url": "https://example.test/145",
                          "owner": "Codex", "phase": "audit", "status": "in_progress", "dependencies": [],
                          "estimatedEffort": {"kind": "planning_estimate", "unit": "story_points", "value": None}}],
              "runs": []}
    (root / "agent-state").mkdir()
    (root / "agent-state/work-ledger.json").write_text(links.encoded(ledger))
    out = root / "graphify-out"
    out.mkdir()
    source = {"nodes": [{"id": "code:a", "source_file": "src/a.ts", "_origin": "ast"}],
              "links": [], "directed": False, "multigraph": False, "graph": {}}
    projection = links.build_projection(ledger)
    (out / "graph.json").write_text(links.encoded(links.merge_graph(source, projection)))
    (out / "manifest.json").write_text('{}\n')
    return source


def contents(root):
    return {p.name: p.read_bytes() for p in (root / "graphify-out").iterdir() if p.is_file()}


class GraphifyUpdateTests(unittest.TestCase):
    def test_removes_only_owned_projection_and_preserves_foreign_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = fixture(root)
            graph = json.loads((root / "graphify-out/graph.json").read_bytes())
            graph["custom"] = {"value": 42}
            stripped = updater.source_graph(graph)
            self.assertEqual(stripped["nodes"], source["nodes"])
            self.assertEqual(stripped["custom"], {"value": 42})
            self.assertTrue(any(n.get("_traceability_owner") for n in graph["nodes"]))

    def test_foreign_cross_links_and_hyperedges_are_not_silently_discarded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            graph = json.loads((root / "graphify-out/graph.json").read_bytes())
            owned = next(n["id"] for n in graph["nodes"] if n.get("_traceability_owner"))
            for mutation in [lambda g: g["links"].append({"source": "code:a", "target": owned}),
                             lambda g: g.update(hyperedges=[{"nodes": ["code:a", owned]}])]:
                candidate = deepcopy(graph)
                mutation(candidate)
                with self.assertRaisesRegex(ValueError, "unknown endpoint"):
                    updater.source_graph(candidate)

    def test_growth_cannot_hide_a_missing_source_node(self):
        with self.assertRaisesRegex(ValueError, "code:a.*src/a.ts"):
            updater.verify_preserved({"nodes": [{"id": "code:a", "source_file": "src/a.ts"}]},
                                     {"nodes": [{"id": "code:b"}, {"id": "code:c"}], "links": []})

    def test_stages_both_cwd_and_outputs_and_restores_projection_without_force(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = fixture(root)
            def run(command, **kwargs):
                self.assertEqual(command, [sys.executable, "update", str(root.resolve())])
                self.assertNotIn("GRAPHIFY_FORCE", kwargs["env"])
                stage = Path(kwargs["env"]["GRAPHIFY_OUT"])
                self.assertEqual(stage, kwargs["cwd"] / "graphify-out")
                self.assertNotEqual(stage, root / "graphify-out")
                candidate = json.loads((stage / "graph.json").read_bytes())
                self.assertEqual(candidate["nodes"], source["nodes"])
                candidate["nodes"].append({"id": "code:b", "source_file": "src/b.ts"})
                (stage / "graph.json").write_text(links.encoded(candidate))
                return CompletedProcess(command, 0, "", "")
            with patch.dict(os.environ, {"GRAPHIFY_FORCE": "1"}):
                self.assertEqual(updater.update(root, sys.executable, runner=run, snapshotter=lambda root: {}), 0)
            result = json.loads((root / "graphify-out/graph.json").read_bytes())
            self.assertTrue(any(n.get("_traceability_owner") == links.OWNER for n in result["nodes"]))
            self.assertIn("code:b", {n["id"] for n in result["nodes"]})
            self.assertEqual(links.main(["--ledger", str(root / "agent-state/work-ledger.json"),
                                         "--graph", str(root / "graphify-out/graph.json")]), 0)
            self.assertEqual(links.main(["--ledger", str(root / "agent-state/work-ledger.json"),
                                         "--graph", str(root / "graphify-out/graph.json"), "--check"]), 0)

    def test_failed_extraction_and_check_mode_leave_outputs_byte_identical(self):
        for code, check in [(1, False), (0, True)]:
            with self.subTest(code=code, check=check), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                fixture(root)
                before = contents(root)
                run = lambda command, **kwargs: CompletedProcess(command, code, "", "")
                if code:
                    with self.assertRaisesRegex(ValueError, "rebuild failed"):
                        updater.update(root, sys.executable, runner=run, snapshotter=lambda root: {})
                else:
                    updater.update(root, sys.executable, check=check, runner=run, snapshotter=lambda root: {})
                self.assertEqual(contents(root), before)

    def test_source_ledger_and_output_races_abort_before_publishing(self):
        for target in ["source", "ledger", "graph"]:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                fixture(root)
                before = contents(root)
                calls = 0
                def snapshot(root):
                    nonlocal calls
                    calls += 1
                    return {"src/a.ts": calls if target == "source" else 0}
                def run(command, **kwargs):
                    if target == "ledger":
                        with (root / "agent-state/work-ledger.json").open('a') as file:
                            file.write('\n')
                    if target == "graph":
                        (root / "graphify-out/graph.json").write_text('{"concurrent": true}')
                    return CompletedProcess(command, 0, "", "")
                with self.assertRaisesRegex(ValueError, "changed during extraction"):
                    updater.update(root, sys.executable, runner=run, snapshotter=snapshot)
                after = contents(root)
                if target == "graph":
                    self.assertEqual(after.pop("graph.json"), b'{"concurrent": true}')
                    before.pop("graph.json")
                self.assertEqual(after, before)

    def test_change_between_initial_graph_read_and_output_snapshot_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            read_optional = updater.read_optional
            def racing_read(path):
                if path.name == "graph.json":
                    path.write_text('{"concurrent": true}')
                return read_optional(path)
            run = lambda command, **kwargs: CompletedProcess(command, 0, "", "")
            with patch.object(updater, "read_optional", racing_read):
                with self.assertRaisesRegex(ValueError, "graph outputs changed"):
                    updater.update(root, sys.executable, runner=run, snapshotter=lambda root: {})
            self.assertEqual((root / "graphify-out/graph.json").read_bytes(), b'{"concurrent": true}')

    def test_invalid_staged_text_is_rejected_before_any_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            before = contents(root)
            def run(command, **kwargs):
                stage = Path(kwargs["env"]["GRAPHIFY_OUT"])
                (stage / "GRAPH_REPORT.md").write_bytes(b'\xff')
                return CompletedProcess(command, 0, "", "")
            with self.assertRaises(UnicodeDecodeError):
                updater.update(root, sys.executable, runner=run, snapshotter=lambda root: {})
            self.assertEqual(contents(root), before)


if __name__ == "__main__":
    unittest.main()
