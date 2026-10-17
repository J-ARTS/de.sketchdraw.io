"""Regression checks for traceability integrity and conservative effort accounting."""

from copy import deepcopy
from contextlib import redirect_stderr
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("graphify_links", Path(__file__).parents[1] / "graphify-links.py")
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


def ledger_fixture():
    def issue(number):
        return {"number": number, "title": f"Issue {number}", "url": f"https://example.test/issues/{number}",
                "owner": "Codex", "phase": "S0", "status": "in_progress", "dependencies": [],
                "estimatedEffort": {"value": 3, "unit": "story_points", "kind": "planning_estimate"}}

    def run(name, issues, seconds):
        return {"id": name, "tool": "codex", "model": None, "issues": issues, "status": "completed",
                "startedAt": "2026-10-17T12:00:00Z", "endedAt": "2026-10-17T12:02:00Z",
                "observedSeconds": seconds, "tokens": None, "costUsd": None, "artifacts": [], "concerns": []}

    return {"schemaVersion": 1, "repository": "test/repo", "updatedAt": "2026-10-17T12:05:00Z",
            "issues": [issue(7), issue(8)], "runs": [run("shared", [7, 8], 120), run("exclusive", [7], None)]}


class LedgerTests(unittest.TestCase):
    def test_unknown_is_not_zero_or_derived_from_timestamps(self):
        ledger = ledger_fixture()
        summary = adapter.summarize(ledger)
        seconds = summary["observed"]["observedSeconds"]
        self.assertEqual(seconds, {"knownSubtotal": 120, "knownRuns": 1, "unknownRuns": 1, "total": None})
        self.assertIsNone(summary["observed"]["tokens"]["total"])
        self.assertIsNone(summary["observed"]["costUsd"]["total"])
        projection = adapter.build_projection(ledger)
        effort = next(n for n in projection["nodes"] if n["id"] == adapter.node_id("effort", "exclusive"))
        self.assertIsNone(effort["observedSeconds"])
        self.assertIn("unbekannt", effort["label"])

    def test_shared_runs_count_once_and_are_not_allocated_to_issues(self):
        ledger = ledger_fixture()
        ledger["runs"][1]["observedSeconds"] = 30
        summary = adapter.summarize(ledger)
        self.assertEqual(summary["observed"]["observedSeconds"]["total"], 150)
        self.assertEqual(summary["byTool"]["codex"]["observedSeconds"]["total"], 150)
        self.assertEqual(summary["byIssue"]["7"]["exclusiveRuns"]["observedSeconds"]["total"], 30)
        self.assertEqual(summary["byIssue"]["7"]["sharedUnallocatedRunIds"], ["shared"])
        self.assertIsNone(summary["byIssue"]["8"]["exclusiveRuns"]["observedSeconds"]["total"])
        self.assertEqual(summary["planning"]["total"], 6)

    def test_zero_is_known_and_empty_run_set_has_no_measured_total(self):
        ledger = ledger_fixture()
        for run in ledger["runs"]:
            for metric in adapter.METRICS:
                run[metric] = 0
        self.assertEqual(adapter.summarize(ledger)["observed"]["tokens"]["total"], 0)
        self.assertIsNone(adapter.aggregate([])["tokens"]["total"])

    def test_invalid_values_and_references_fail_before_graph_writes(self):
        mutations = [
            lambda d: d["runs"][0]["issues"].append(999),
            lambda d: d["issues"][0]["dependencies"].append(999),
            lambda d: d["issues"].append(deepcopy(d["issues"][0])),
            lambda d: d["runs"].append(deepcopy(d["runs"][0])),
            lambda d: d["runs"][0]["issues"].append(7),
            lambda d: d["runs"][0].update(observedSeconds=-1),
            lambda d: d["runs"][0].update(tokens=True),
            lambda d: d["runs"][0].update(tokens=1.5),
            lambda d: d["runs"][0].update(costUsd=float("nan")),
            lambda d: d["runs"][0].update(endedAt="2020-01-01T00:00:00Z"),
            lambda d: d.update(updatedAt="2026-10-17T00:00:00"),
            lambda d: d["issues"][0]["estimatedEffort"].update(kind="actual"),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                ledger = ledger_fixture()
                mutation(ledger)
                with self.assertRaises(ValueError):
                    adapter.build_projection(ledger)

    def test_duplicate_aggregation_is_rejected(self):
        run = ledger_fixture()["runs"][0]
        with self.assertRaisesRegex(ValueError, "duplicate run"):
            adapter.aggregate([run, run])


class GraphTests(unittest.TestCase):
    def test_ticket_tool_run_effort_and_artifact_concern_links_have_evidence(self):
        ledger = ledger_fixture()
        ledger["runs"][0]["artifacts"] = ["reports/test.txt", {"path": "src/model.ts", "status": "unverified"}]
        ledger["runs"][0]["concerns"] = [{"id": "C1", "summary": "Double counting"}]
        graph = adapter.build_projection(ledger)
        edges = {(e["source"], e["target"], e["relation"]) for e in graph["links"]}
        for source, target, relation in [
            (adapter.node_id("issue", 7), adapter.node_id("tool", "codex"), "uses_tool"),
            (adapter.node_id("tool", "codex"), adapter.node_id("run", "shared"), "executed_run"),
            (adapter.node_id("run", "shared"), adapter.node_id("effort", "shared"), "reports_observed_effort"),
        ]:
            self.assertIn((source, target, relation), edges)
        for record in graph["nodes"] + graph["links"]:
            self.assertEqual(record["provenance"]["timestamp"], ledger["updatedAt"])
            self.assertEqual(record["confidence_score"], 1.0)
            self.assertTrue(record["evidence"])
            self.assertTrue(record["validation_state"])
        self.assertEqual(len([n for n in graph["nodes"] if n["node_type"] == "artifact"]), 2)
        concern = next(n for n in graph["nodes"] if n["node_type"] == "concern")
        self.assertEqual(concern["validation_state"], "recorded_unverified")

    def test_merge_preserves_code_records_and_is_idempotent(self):
        foreign = {"directed": True, "multigraph": False, "graph": {"custom": "keep"},
                   "hyperedges": [{"id": "hyper1", "members": ["code1", "code2"]}],
                   "nodes": [{"id": "code1", "label": "Thing", "custom": {"x": 1}}, {"id": "code2"}],
                   "edges": [{"source": "code1", "target": "code2", "relation": "calls", "custom": 42}]}
        graph = adapter.build_projection(ledger_fixture())
        merged = adapter.merge_graph(foreign, graph)
        self.assertEqual(merged["nodes"][:2], foreign["nodes"])
        self.assertEqual(merged["links"][0], foreign["edges"][0])
        self.assertEqual(merged["hyperedges"], foreign["hyperedges"])
        self.assertEqual(merged["graph"], foreign["graph"])
        self.assertTrue(merged["directed"])
        self.assertEqual(adapter.encoded(merged), adapter.encoded(adapter.merge_graph(merged, graph)))

    def test_update_replaces_old_projection_and_rehydrates_after_rebuild(self):
        ledger = ledger_fixture()
        graph = adapter.build_projection(ledger)
        ledger["runs"] = [ledger["runs"][0]]
        ledger["runs"][0]["observedSeconds"] = 150
        updated = adapter.build_projection(ledger)
        merged = adapter.merge_graph(graph, updated)
        self.assertNotIn(adapter.node_id("run", "exclusive"), {n["id"] for n in merged["nodes"]})
        self.assertEqual(merged, updated)
        rebuilt = {"nodes": [{"id": "fresh_code"}], "links": []}
        rehydrated = adapter.merge_graph(rebuilt, updated)
        self.assertIn(adapter.node_id("run", "shared"), {n["id"] for n in rehydrated["nodes"]})
        self.assertEqual(rehydrated["nodes"][0], {"id": "fresh_code"})

    def test_shared_tool_edges_retain_every_source_without_duplicate_links(self):
        ledger = ledger_fixture()
        graph = adapter.build_projection(ledger)
        edge = next(e for e in graph["links"] if e["source"] == adapter.node_id("issue", 7)
                    and e["relation"] == "uses_tool")
        self.assertEqual(len(edge["evidence"]), 2)
        endpoint_pairs = [(e["source"], e["target"]) for e in graph["links"]]
        self.assertEqual(len(endpoint_pairs), len(set(endpoint_pairs)))

    def test_multigraph_foreign_parallel_edges_survive_merge(self):
        foreign = {"directed": True, "multigraph": True, "nodes": [{"id": "a"}, {"id": "b"}],
                   "links": [{"source": "a", "target": "b", "key": 0, "relation": "calls"},
                             {"source": "a", "target": "b", "key": 1, "relation": "documents"}]}
        graph = adapter.build_projection(ledger_fixture())
        merged = adapter.merge_graph(foreign, graph)
        self.assertEqual(merged["links"][:2], foreign["links"])
        self.assertTrue(all("key" in edge for edge in merged["links"]))
        self.assertEqual(merged, adapter.merge_graph(merged, graph))

    def test_non_multigraph_parallel_edges_are_rejected_in_both_directions(self):
        projection = adapter.build_projection(ledger_fixture())
        for directed, reverse in ((False, False), (False, True), (True, False)):
            with self.subTest(directed=directed, reverse=reverse):
                existing = deepcopy(projection)
                existing["directed"] = directed
                source, target = adapter.node_id("issue", 7), adapter.node_id("tool", "codex")
                existing["links"] = [edge for edge in existing["links"]
                                     if (edge["source"], edge["target"]) != (source, target)]
                if reverse:
                    source, target = target, source
                existing["links"].append({"source": source, "target": target, "relation": "independently_reviewed"})
                adapter.validate_graph(existing)
                before = deepcopy(existing)
                with self.assertRaisesRegex(ValueError, "parallel edges would collapse"):
                    adapter.merge_graph(existing, projection)
                self.assertEqual(existing, before)

    def test_directed_reverse_edges_remain_distinct(self):
        projection = adapter.build_projection(ledger_fixture())
        existing = deepcopy(projection)
        existing["directed"] = True
        reverse = {"source": adapter.node_id("tool", "codex"), "target": adapter.node_id("issue", 7),
                   "relation": "independently_reviewed"}
        existing["links"].append(reverse)
        merged = adapter.merge_graph(existing, projection)
        self.assertEqual(len(merged["links"]), len(projection["links"]) + 1)
        self.assertIn(reverse, merged["links"])

    def test_multigraph_duplicate_explicit_or_automatic_keys_are_rejected(self):
        for first_key in ({"key": 0}, {}):
            with self.subTest(first_key=first_key):
                graph = {"multigraph": True, "nodes": [{"id": "a"}, {"id": "b"}],
                         "links": [{"source": "a", "target": "b", **first_key},
                                   {"source": "b", "target": "a", "key": 0}]}
                with self.assertRaisesRegex(ValueError, "duplicate multigraph key"):
                    adapter.validate_graph(graph)

    def test_retired_hyperedge_members_abort_without_overwriting_files(self):
        for nested in (False, True):
            for field in ("nodes", "members"):
                with self.subTest(nested=nested, field=field), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    ledger = ledger_fixture()
                    graph = adapter.build_projection(ledger)
                    container = graph["graph"] if nested else graph
                    container["hyperedges"] = [{"id": "foreign_hyper", field: [
                        adapter.node_id("run", "exclusive"), adapter.node_id("issue", 7)]}]
                    adapter.validate_graph(graph)
                    ledger["runs"] = ledger["runs"][:1]
                    ledger_path, graph_path = root / "ledger.json", root / "graph.json"
                    ledger_path.write_text(adapter.encoded(ledger))
                    graph_path.write_text(adapter.encoded(graph))
                    before = {path: path.read_bytes() for path in root.iterdir()}
                    with redirect_stderr(io.StringIO()) as diagnostic:
                        self.assertEqual(adapter.main(["--ledger", str(ledger_path), "--graph", str(graph_path)]), 1)
                    self.assertIn("hyperedges." + field + " references an unknown endpoint", diagnostic.getvalue())
                    self.assertEqual(before, {path: path.read_bytes() for path in root.iterdir()})

    def test_cli_rejects_parallel_relations_without_overwriting_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ledger = ledger_fixture()
            graph = adapter.build_projection(ledger)
            graph["links"].append({"source": adapter.node_id("issue", 7),
                                   "target": adapter.node_id("tool", "codex"), "relation": "independently_reviewed"})
            ledger_path, graph_path = root / "ledger.json", root / "graph.json"
            ledger_path.write_text(adapter.encoded(ledger))
            graph_path.write_text(adapter.encoded(graph))
            before = {path: path.read_bytes() for path in root.iterdir()}
            with redirect_stderr(io.StringIO()) as diagnostic:
                self.assertEqual(adapter.main(["--ledger", str(ledger_path), "--graph", str(graph_path)]), 1)
            self.assertIn("parallel edges would collapse", diagnostic.getvalue())
            self.assertEqual(before, {path: path.read_bytes() for path in root.iterdir()})

    def test_valid_nested_hyperedges_are_preserved(self):
        graph = adapter.build_projection(ledger_fixture())
        graph["graph"]["hyperedges"] = [{"id": "h", "nodes": [adapter.node_id("issue", 7)]}]
        merged = adapter.merge_graph(graph, adapter.build_projection(ledger_fixture()))
        self.assertEqual(merged["graph"]["hyperedges"], graph["graph"]["hyperedges"])

    def test_foreign_collision_or_orphan_is_not_silently_destroyed(self):
        graph = adapter.build_projection(ledger_fixture())
        collision = {"nodes": [{"id": adapter.node_id("issue", 7)}], "links": []}
        with self.assertRaisesRegex(ValueError, "collides"):
            adapter.merge_graph(collision, graph)
        graph["nodes"].append({"id": "foreign"})
        graph["links"].append({"source": "foreign", "target": adapter.node_id("run", "exclusive")})
        ledger = ledger_fixture()
        ledger["runs"] = [ledger["runs"][0]]
        with self.assertRaisesRegex(ValueError, "unknown endpoint"):
            adapter.merge_graph(graph, adapter.build_projection(ledger))

    def test_cli_detects_stale_metrics_and_can_refresh(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ledger_path, graph_path = root / "ledger.json", root / "graph.json"
            ledger = ledger_fixture()
            ledger_path.write_text(adapter.encoded(ledger))
            args = ["--ledger", str(ledger_path), "--graph", str(graph_path)]
            self.assertEqual(adapter.main(args), 0)
            before = graph_path.read_bytes()
            self.assertEqual(adapter.main(args + ["--check"]), 0)
            self.assertEqual(adapter.main(args), 0)
            self.assertEqual(before, graph_path.read_bytes())
            ledger["runs"][0]["observedSeconds"] = 200
            ledger_path.write_text(adapter.encoded(ledger))
            with redirect_stderr(io.StringIO()) as diagnostic:
                self.assertEqual(adapter.main(args + ["--check"]), 1)
            self.assertIn("stale", diagnostic.getvalue())
            self.assertEqual(graph_path.read_bytes(), before)
            self.assertEqual(adapter.main(args), 0)
            self.assertEqual(adapter.main(args + ["--check"]), 0)
            self.assertEqual(json.loads((root / "effort-summary.json").read_text())["observed"]["observedSeconds"]["knownSubtotal"], 200)

    def test_invalid_ledger_leaves_existing_outputs_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ledger_path, graph_path = root / "ledger.json", root / "graph.json"
            ledger = ledger_fixture()
            ledger["runs"][0]["issues"] = [999]
            ledger_path.write_text(adapter.encoded(ledger))
            graph_path.write_text('{"nodes": [], "links": []}')
            before = graph_path.read_bytes()
            with redirect_stderr(io.StringIO()) as diagnostic:
                self.assertEqual(adapter.main(["--ledger", str(ledger_path), "--graph", str(graph_path)]), 1)
            self.assertIn("unknown issue", diagnostic.getvalue())
            self.assertEqual(graph_path.read_bytes(), before)
            self.assertFalse((root / "effort-summary.json").exists())


class PathSafetyTests(unittest.TestCase):
    def assert_collision_unchanged(self, root, ledger_path, graph_path):
        before = {path: path.read_bytes() for path in root.iterdir() if path.is_file()}
        for check in ([], ["--check"]):
            with redirect_stderr(io.StringIO()) as diagnostic:
                result = adapter.main(["--ledger", str(ledger_path), "--graph", str(graph_path)] + check)
            self.assertEqual(result, 1)
            self.assertIn("path collision", diagnostic.getvalue())
            self.assertEqual(before, {path: path.read_bytes() for path in root.iterdir() if path.is_file()})

    def test_graph_filename_cannot_shadow_either_side_output(self):
        for filename in ("traceability.json", "effort-summary.json"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                ledger_path, graph_path = root / "ledger.json", root / filename
                ledger_path.write_text(adapter.encoded(ledger_fixture()))
                graph_path.write_text(adapter.encoded({"nodes": [{"id": "foreign"}], "links": []}))
                self.assert_collision_unchanged(root, ledger_path, graph_path)

    def test_ledger_cannot_be_any_output(self):
        for filename in ("graph.json", "traceability.json", "effort-summary.json"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                ledger_path = root / filename
                ledger_path.write_text(adapter.encoded(ledger_fixture()))
                self.assert_collision_unchanged(root, ledger_path, root / "graph.json")

    def test_aliases_are_checked_after_resolving_symlinks_and_hardlinks(self):
        for alias_kind in ("symlink", "hardlink"):
            with self.subTest(alias_kind=alias_kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                ledger_path, graph_path = root / "ledger.json", root / "graph.json"
                ledger_path.write_text(adapter.encoded(ledger_fixture()))
                projection_path = root / "traceability.json"
                projection_path.write_text(adapter.encoded({"nodes": [{"id": "foreign"}], "links": []}))
                if alias_kind == "symlink":
                    graph_path.symlink_to(projection_path)
                else:
                    os.link(projection_path, graph_path)
                self.assert_collision_unchanged(root, ledger_path, graph_path)


if __name__ == "__main__":
    unittest.main()
