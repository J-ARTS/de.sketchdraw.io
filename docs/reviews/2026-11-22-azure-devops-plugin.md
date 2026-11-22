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

## Offen

1. **Labels, Komponenten, Schätzung** lesen und schreiben, für Jira und Azure (Rest von #281). Die Aufgabe im Dokument hat diese Felder noch nicht; sie kommen mit den Ticket-Karten (#283).
2. **Wiki**: Seiten lesen und Diagrammseiten als Bild veröffentlichen (Rest von #284).
3. **Beide Systeme eingeschaltet**: Eine neue Aufgabe bekommt ihr Ticket in Jira; eine Aufgabe ohne Ticket lässt sich im Dialog gezielt in Jira oder Azure DevOps anlegen. Eine Vorauswahl je Profil gibt es nicht.
4. **Tickets suchen und Adresse auflösen** (für #283) fehlen in beiden Anbietern.

## Server-Kompatibilität

Geprüft ist gegen eine nachgebildete Schnittstelle (`tests/unit/azure-devops.spec.ts`), **nicht gegen einen echten Server und nicht gegen eine echte Organisation**. Verwendete Aufrufe:

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
- Nötiger Token-Umfang: „Work Items: Lesen und Schreiben", für Nur-lesen „Work Items: Lesen". Der Dialog nennt das.
- Dokumente mit Azure-Tickets (`external.provider: "azure-devops"`) öffnet Version 0.1.8 nicht: Deren Prüfung kennt nur `jira`.
