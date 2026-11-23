# Azure-DevOps-Plugin: Umsetzung, Feldzuordnung und Server-Kompatibilität

Stand 22.11.2026, Tickets #281 (gemeinsame Schnittstelle) und #284 (Plugin). Umsetzung: Claude Code.

## Was umgesetzt ist

- Plugin „Azure DevOps" im Marketplace des Plugin-Dialogs, nicht vorinstalliert. Einstellungen und Token liegen je Profil; das Token wird wie die Atlassian-Daten verschlüsselt abgelegt und nie an die Oberfläche zurückgegeben.
- Eine Umsetzung für Azure DevOps Services (Cloud) und Azure DevOps Server (`electron/azure-devops.ts`). Beide sprechen dieselbe REST-Schnittstelle; sie unterscheiden sich in der Adresse (Organisation bzw. Sammlung) und in den bekannten API-Versionen. Die API-Version ist deshalb eine Einstellung (Vorgabe Cloud 7.1, Server 6.0). Ein zweites Plugin für den Server ist damit nicht nötig.
- Boards: Work Items über WIQL laden (höchstens 100), lesen, anlegen, ändern, Zustand wechseln. Nur-lesen-Modus.
- Aufgabenboard: Der Store spricht Jira und Azure Boards über einen gemeinsamen Zugang an (`TicketApi` in `src/renderer/state/whiteboard.ts`; Vertrag `WorkItemProvider`/`WorkItemSummary` in `src/domain/plugins.ts`). Eine Aufgabe merkt sich System und Schlüssel (`external.provider`: `jira` oder `azure-devops`).

## Feldzuordnung

| Aufgabe | Azure Boards | Jira | Bemerkung |
| --- | --- | --- | --- |
| Titel | `System.Title` | `summary` | |
| Beschreibung | `System.Description` (HTML) | `description` (ADF) | Wird als reiner Text gelesen und geschrieben; Formatierung im Zielsystem geht beim Schreiben verloren (wie bei Jira, #270). |
| Status | `System.State` | Workflow-Übergang | Azure: Zustand über die Kategorie des Typs (Proposed, InProgress, Resolved, Completed). Hat der Typ keinen Zustand der Kategorie (Agile-Task kennt kein „Resolved"), wird die Änderung abgelehnt und gemeldet. |
| Zuständige | `System.AssignedTo` | `assignee` | Azure löst Namen oder Adresse selbst auf; mehrdeutige Namen lehnt es ab. |
| Fälligkeit | `Microsoft.VSTS.Scheduling.DueDate` | `duedate` | Nicht jeder Prozess hat das Feld auf jedem Typ; dann lehnt Azure das Schreiben ab. |
| Labels | `System.Tags` | `labels` | **Offen** (siehe unten). |
| Komponenten | `System.AreaPath` | `components` | **Offen**. Azure kennt keine Komponenten als eigenes Feld. |
| Schätzung | Story Points, Effort oder Original Estimate je Prozess | Story Points bzw. Zeitschätzung | **Offen**. Das Feld muss je Projekt erkannt werden. |

## Nachtrag 23.11.2026: Felder der Ticket-Karten, Suche, Wiki

**Labels, Komponenten, Schätzung** (#281, #283) werden für beide Systeme gelesen und geschrieben:

| Feld | Azure Boards | Jira |
| --- | --- | --- |
| Labels | `System.Tags` (mit „; " getrennt; ein Label mit Semikolon wird abgelehnt) | `labels` (ein Label mit Leerzeichen wird abgelehnt) |
| Komponenten | `System.AreaPath` (genau ein Pfad; im Dialog „Bereich (Area Path)") | `components` (nach Name) |
| Schätzung | das erste vorhandene Feld aus Story Points, Effort, Original Estimate; nur Zahlen | Story Points, wenn die Site ein solches Feld hat (über die Feldliste erkannt, das erste passende); sonst Zeitschätzung (`timetracking.originalEstimate`) |

**Suchen und Adresse auflösen**: Jira über JQL (`key = …` bzw. `text ~ …`), Azure über WIQL (`[System.Id] = …` bzw. `[System.Title] CONTAINS …`). Eine eingefügte Adresse wird nur unter der Adresse der verbundenen Site bzw. Organisation als Ticket erkannt (`parseTicketUrl`).

**Wiki** (#284, `electron/azure-devops-wiki.ts`): Seiten der Wikis des Projekts finden, eine Seite des Diagramms mit einer Wiki-Seite verknüpfen und dort als Bild zeigen, das jeder Änderung folgt – wie #240 für Confluence, über denselben Zugang im Store (`WikiProvider`).

- Das Bild wird als Anhang des Wikis hochgeladen. Sein Name enthält den Hash des Bildes; dasselbe Bild wird nie zweimal hochgeladen. Frühere Bilder bleiben als Anhänge im Wiki-Repository liegen; das Plugin löscht nichts.
- Die Seite bekommt genau einen Block zwischen zwei Kommentarzeilen (`<!-- sketchdraw:… -->`). Nur dieser Block wird geschrieben; er darf auf der Seite verschoben werden. Text außerhalb bleibt unberührt.
- Geschrieben wird mit der gelesenen Version der Seite (`If-Match`). Hat jemand die Seite inzwischen geändert (412 oder 409), wird nichts überschrieben und die Veröffentlichung wiederholt.
- Eine Seite des Diagramms ist mit höchstens einem Wiki verknüpft (Confluence oder Azure DevOps). Die Verknüpfung liegt im Profil, nicht im Diagramm, und gilt für Organisation und Projekt, für die sie angelegt wurde.
- „Nur lesen" überträgt nichts ins Wiki. Nötiger Token-Umfang zusätzlich: „Wiki: Lesen und Schreiben".

Zusätzliche Aufrufe:

| Aufruf | Zweck |
| --- | --- |
| `GET /{project}/_apis/wiki/wikis` | Wikis des Projekts |
| `GET /{project}/_apis/wiki/wikis/{wiki}/pages?path=/&recursionLevel=full` | Seitenbaum für die Suche |
| `GET /{project}/_apis/wiki/wikis/{wiki}/pages?path=…&includeContent=true` | Seite lesen; Version im Kopf `ETag` |
| `PUT /{project}/_apis/wiki/wikis/{wiki}/attachments?name=…` (Base64, `application/octet-stream`) | Bild hochladen |
| `PUT /{project}/_apis/wiki/wikis/{wiki}/pages?path=…` mit `If-Match` | Seite schreiben |

Annahmen zum Wiki, die ein Test durch den Owner bestätigen muss:

- **Form des Anhangs**: Der Inhalt wird als Base64-Text mit `application/octet-stream` gesendet. Die Seite der Dokumentation zu „Attachments – Create" ließ sich bei der Umsetzung nicht abrufen; belegt sind aus der Dokumentation nur Adresse, Methode und der Parameter `name`.
- **Vorhandener Anhang**: Ein Anhang gleichen Namens gilt als schon hochgeladen, wenn Azure DevOps mit 409 oder mit 400 und „already exists" antwortet. Antwortet ein Server anders, schlägt die zweite Veröffentlichung desselben Bildes fehl und meldet das.
- **Bildgröße**: Die Breite steht in der Schreibweise des Azure-DevOps-Wikis im Bildverweis (`=640x`).
- **API-Version**: Die Wiki-Aufrufe verwenden die eingestellte Version. Für Azure DevOps Server 2019 (5.0/5.1) sind sie möglicherweise nur als Vorschau-Version vorhanden (`5.0-preview.1`); die Einstellung lässt das zu.
- **Wikis aus Code** („publish as code"): Die Suche zeigt sie; ob das Schreiben auf einen geschützten Branch gelingt, hängt von dessen Regeln ab und ist nicht geprüft.

## Offen

1. **Echter Test** gegen eine Organisation und gegen einen Server durch den Owner, für Boards, Ticket-Karten und Wiki.
2. **Beide Systeme eingeschaltet**: Eine neue Aufgabe bekommt ihr Ticket in Jira; eine Aufgabe ohne Ticket lässt sich im Dialog gezielt in Jira oder Azure DevOps anlegen. Eine Vorauswahl je Profil gibt es nicht.
3. **Welche Felder ein Anbieter schreiben kann**, ist nicht als Eigenschaft des Vertrags abfragbar; die Oberfläche bietet alle sieben Felder an und zeigt die Ablehnung des Trackers. Fällig, sobald ein dritter Anbieter dazukommt.
4. **Seiten des Wikis einbetten** (wie eine eingebundene Confluence-Seite als Annotation) gibt es für Azure DevOps nicht; das Wiki ist Markdown, die Annotation folgt dem Confluence-Speicherformat.

## Server-Kompatibilität

Geprüft ist gegen nachgebildete Schnittstellen (`tests/unit/azure-devops.spec.ts`, `tests/unit/azure-devops-wiki.spec.ts`), **nicht gegen einen echten Server und nicht gegen eine echte Organisation**. Verwendete Aufrufe:

| Aufruf | Zweck |
| --- | --- |
| `GET /_apis/projects/{project}` | Verbindungstest |
| `POST /{project}/_apis/wit/wiql?$top=100` | Abfrage |
| `GET /_apis/wit/workitems?ids=…` | Work Items lesen |
| `POST /{project}/_apis/wit/workitems/${type}` (JSON Patch) | Anlegen |
| `PATCH /_apis/wit/workitems/{id}` (JSON Patch) | Ändern, Zustand |
| `GET /{project}/_apis/wit/workitemtypes/{type}/states` | Zustände eines Typs |

Annahmen, die ein Test durch den Owner bestätigen muss:

- **API-Version**: 6.0 für Azure DevOps Server 2020, 7.0/7.1 für 2022, 5.0/5.1 für 2019. Die Zustandsliste eines Typs ist auf älteren Servern möglicherweise nur als Vorschau-Version vorhanden; antwortet der Server darauf mit 400 oder 404, verwendet das Plugin die üblichen Zustandsnamen (New, Active, Resolved, Closed).
- **Anmeldung**: Personal Access Token als Basic-Anmeldung mit leerem Benutzernamen. Server, die nur Windows-Anmeldung (NTLM/Kerberos) zulassen, werden nicht unterstützt.
- **Nur https**: Das Token wird mit jeder Anfrage gesendet; Adressen mit http werden abgelehnt. Server mit einem Zertifikat einer eigenen Zertifizierungsstelle brauchen diese im Zertifikatsspeicher des Systems.
- **Ältere Antwortformen**: „Zugewiesen an" als Text „Name <Adresse>" statt als Objekt wird gelesen.

## Sicherheit

- Netz-Zugriffe nur im Hauptprozess; Weiterleitungen werden nicht verfolgt (`redirect: 'error'`); Antworten über 2 MB werden verworfen.
- Eine Anmeldeseite statt Daten (Status 203 in der Cloud) gilt als abgelehntes Token.
- Aufrufe arbeiten nur für ein gespeichertes lokales Diagramm; Gast- und ungespeicherte Dokumente lösen nichts aus. Eine Antwort, die nach einem Wechsel von Projekt, Profil oder Einstellungen eintrifft, wird verworfen.
- Nötiger Token-Umfang: „Work Items: Lesen und Schreiben" und für das Wiki „Wiki: Lesen und Schreiben"; für Nur-lesen „Work Items: Lesen". Der Dialog nennt das.
- Wiki: Pfade werden vor jedem Aufruf geprüft (keine `..`-Abschnitte, keine Steuerzeichen, kein `?` oder `#`); der Titel des Diagramms wird als reiner Alternativtext geschrieben und kann kein eigenes Markdown bilden.
- Dokumente mit Azure-Tickets (`external.provider: "azure-devops"`) öffnet Version 0.1.8 nicht: Deren Prüfung kennt nur `jira`.
