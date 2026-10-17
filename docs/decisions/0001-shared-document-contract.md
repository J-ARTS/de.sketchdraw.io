# ADR 0001 — Kanonisches Dokument und gemeinsame S1-Verträge

Status: für S1 beschlossen am 17.10.2026, noch zu implementieren und zu prüfen. Ticket #6, Umsetzung #8/#9/#10. Quelle: Antigravity-Review AG-01/02/03/05/06/09/10 und Codex-Research.

Ein validiertes `SketchDocument` bleibt die gemeinsame persistente Repräsentation. Canvas, Code, Agenten und Peers ändern es über atomare Commands und einen revisionsgeprüften Controller. UI-Panels, Pointervorschauen und ungültige Codeentwürfe sind eigenständige kurzlebige Zustände. Die API und Fehlerfälle sind verbindlich in `docs/contracts.md` und `src/domain/types.ts` v2 festgelegt.

JSON-übertragbare Patches müssen optionale Felder ausdrücklich löschen können. Deshalb bedeutet `null` Löschung; Stile und Metadaten werden feldweise gemischt. Weltkoordinaten vermeiden mehrdeutige Containertransformationen. Container bewegen Nachfahren genau einmal, skalieren und rotieren sie zunächst nicht. Connectors behalten beim Abkoppeln ihre sichtbare Geometrie.

Eine Revision ist ein erfolgreicher Command oder Batch. Undo ist eine neue geprüfte Änderung des jeweiligen Actors; es restauriert keinen veralteten Gesamtzustand. Fremde Folgeänderungen bleiben erhalten oder führen zu einem erklärbaren History-Konflikt. Diese konservative Konfliktbehandlung ist der stillen Datenvernichtung vorzuziehen.

Dateipfade liegen ausschließlich im Electron-Main-Prozess. Der Renderer verwendet opake Handles, erwartete Dateiversionen und strukturierte Resultate. Atomarer Rename verhindert halbe Dateien; externe Konflikte werden durch Versionsvergleich geprüft, ohne einen plattformunabhängigen atomaren Dateisystem-CAS zu behaupten.

Konsequenzen: Alle implementierenden Agenten verwenden dieselben Typen und Exporte. Entwurfsänderungen benötigen einen gemeinsamen Abgleich. Die Entscheidungen gelten erst als bewiesen, wenn die in `docs/contracts.md` beschriebenen Unit-, UI- und Persistenzfehlerfälle ausgeführt wurden.
