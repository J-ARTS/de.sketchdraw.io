# Claude-Code-Review zu Tabellen (#58)

Datum: 18.10.2026
Art: echter lokaler, auf Lesen begrenzter Claude-Code-Lauf
Tatsächliches Tool: Claude Code; Umsetzung und Abnahme: Codex im autorisierten Vertretungsmodus

Claude Code prüfte Domainmodell, `WhiteboardCanvas`, `ElementView`, `AnnotationEditor`, `SelectionToolbar`, Store-Vertrag und vorhandene Tests. Das Review empfahl eine Tabelle als einzelnes Canvas-Element mit interner, versionierter Struktur statt vieler verschachtelter Canvas-Elemente. Genannte Schwerpunkte waren eine einzige aktive Zellbearbeitung, `Tab`-/`Umschalt+Tab`-Navigation, klare Ebenen für Tabellen-, Zeilen-, Spalten- und Zellselektion, ARIA-Grid-Semantik sowie atomare Zell- und Strukturänderungen.

Als Risiken wurden elementgranulare P2P-Konflikte, viele `foreignObject`-Instanzen, Fokusverlust durch `Tab`, eine überladene kontextbezogene Werkzeugleiste sowie fehlende SVG-, draw.io- und Diagram-as-Code-Pfade genannt. Die Entscheidungen stehen als TB-01 bis TB-06 in `docs/concerns.md`. Die Umsetzung verwendet native SVG-Primitiven für die Lesedarstellung, ein einzelnes Textarea für die aktive Zelle und ein strukturiertes `TableDocument` mit höchstens 500 Zellen.

Claude Code konnte das GitHub-Issue wegen seines begrenzten lokalen Toolmodus nicht selbst lesen; Codex glich das Review anschließend gegen Issue #58 ab. Antigravity lieferte wegen des sichtbaren Quotenlimits kein Arbeitsergebnis.
