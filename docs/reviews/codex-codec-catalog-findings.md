# S2-Integrationsbefunde

Issue #11/#15. Der erste Antigravity-Lauf endete nach1803,032s mit leerer Antwort ohne Abschlussbericht. Vorhandene Dateien sind eine Teillieferung, keine bestätigte Fertigstellung.

Codex-Ausführung17.10.2026,15:36 Europe/Berlin, Node22.16/Vitest5.0.5:

`npx vitest run tests/unit/codec-catalog-acceptance.spec.ts tests/unit/codec/ tests/unit/catalog/`:36 bestanden,13 fehlgeschlagen, drei Dateien. Alle15 unabhängigen Abnahmetests bestanden;13 von14 eigenen Katalogtests sind nicht mit dem Vertrags-/APIstand abgestimmt.

Konkrete Testprobleme: erwarten fälschlich `set.id:` statt Provider-Punktnamespace; verwenden unvollständige Domainfixtures ohne metadata/assets/componentSets/rotation; rufen Suchfunktion mit falscher Argumentreihenfolge; erwarten Boolean statt geprüften Widgetstring; erwarten `issue.code` statt `code` und falsche Treefelder/Fehlercodes. Das als erlaubt bezeichnete SVG enthält nach Vertrag verbotene Root-width/height, transparent-Farbe, stroke-dasharray und clip-rule. Diese Annahmen müssen korrigiert werden, nicht die Sicherheitsregeln aufgeweicht. Beabsichtigte Fehlerszenarien durch sonst valide Fixtures isolieren.

`npx tsc -p tsconfig.app.json --noEmit`: fehlgeschlagen. builtin.ts:31 readonlyArray gegen mutable Export; icon.ts:1000/1018–1022 Callback-Narrowing auf never; index.ts:34 ungenutzter FORBIDDEN_KEYS-Import. Compileroptionen und unabhängige Tests bleiben unverändert.

Nächster Schritt: begrenzte Antigravity-Fertigstellung/Reparatur; öffentliche API aus docs/contracts-s2.md beibehalten und dort bestätigte Icon-Ergänzung beachten. Root prüft anschließend erneut.
