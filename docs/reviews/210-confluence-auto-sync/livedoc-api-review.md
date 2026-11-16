# Confluence Live Docs: öffentliche REST-Verträge für #210

Recherche: Codex `/root/live_correction_review`, 2026-11-15. Ausschließlich offizielle Atlassian-Dokumentation, deren verlinkte öffentliche OpenAPI-Datei und Atlassians öffentlicher Fehlerbericht. Keine Tenant-Anfrage, Zugangsdaten-, UI- oder Produktänderung.

## Ergebnis für die beobachtete Suche

**Kein fehlender `subtype`-Parameter als Fehler belegt.** Atlassians Live-Docs-Ankündigung beschreibt das ungefilterte `GET /pages` ausdrücklich als gemeinsame Liste normaler Pages und Live Docs. `subtype=live` grenzt auf Live Docs ein, `subtype=page` auf normale Pages. Live Docs benutzen dieselbe Page-API; in Antworten kennzeichnet `subtype: "live"` ihren Typ. [Atlassian: Live-Docs-Unterstützung](https://community.developer.atlassian.com/t/please-test-update-your-confluence-cloud-apps-to-function-in-live-docs-by-may-30-2025/89849).

Root hat die ursprüngliche Beobachtung inzwischen aufgeklärt: Das aktive Dokument war ungespeichert („Unbenannt“), `hasPluginProject` war false, und `searchConfluencePages()` kehrte ohne Anfrage zurück. Die UI meldete dennoch eine abgeschlossene Suche. Daher lag noch **kein echter Such-API-Test** vor, weder ein Beweis fehlender LiveDoc-Unterstützung noch ein belegter Tenant-/REST-Fehler. Der laufende Main-Prozess war zudem noch der ältere Build.

## Exakte Parameter und Statuswerte

Quelle für die folgende Tabelle: die direkt von der offiziellen REST-Referenz verlinkte [OpenAPI v2](https://dac-static.atlassian.com/cloud/confluence/openapi-v2.v3.json?_v=1.8516.157), lokal rein zur Recherche unter `/tmp/sketchdraw-210-atlassian-openapi-v2.json` gespeichert. Die Regeln stammen aus `paths` und `components.requestBodies.PageUpdateRequest`, nicht aus den allgemeineren ContentStatus-Enums.

| Operation | Vertrag |
| --- | --- |
| `GET /wiki/api/v2/pages` | `status` ist ein Array; standardmäßig `current` und `archived`. Erlaubt: `current`, `archived`, `deleted`, `trashed`. **Kein `draft`** in diesem Listenfilter. |
| Dieselbe Liste | `subtype`: `live` oder `page`; `title` als serverseitiger Filter; `id` und `space-id` als Arrays; `cursor` für Folgeseiten. `limit`: 1–250, Standard 25. |
| `GET /wiki/api/v2/pages/{id}` | `get-draft=true` fragt die Draft-Version an, Standard false. `status`: `current`, `archived`, `trashed`, `deleted`, `historical`, `draft`. `version` selektiert eine frühere veröffentlichte Revision. |
| Lesen des Bodys | `body-format=storage` oder `atlas_doc_format` sind für die Liste und den Einzelabruf unterstützt. Einzelabruf bietet weitere Darstellungen. |
| `PUT /wiki/api/v2/pages/{id}` | Erforderlich: `id`, `status`, `title`, `body`, `version`. Schreibstatus nur `current` oder `draft`. `current`: aktuelle Versionsnummer +1. `draft`: Versionsnummer **1**. |
| Update des Drafts | Wechsel von `current` zu `draft` kann einen bestehenden Draft ersetzen. `subtype` gehört nicht zum Update-Payload. |

Ein allgemeines `ContentStatus`-Enum enthält zusätzlich `any`; daraus darf kein zusätzlicher Listen- oder Schreibstatus abgeleitet werden.

## Live-Inhalt und Versionssemantik

Ein erfolgreiches `current`-Update wird laut REST-Referenz mit einem vorhandenen Draft zusammengeführt; bei größerer Abweichung kann der neue Body den Draft vollständig ersetzen. Ein Vergleich zweier identischer `current`-GETs belegt deshalb nicht, dass gleichzeitig im Editor keine neueren Inhalte vorhanden sind. [Offizielle Update-page-Referenz](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-id-put).

Atlassian beschreibt den Editorinhalt ausdrücklich als möglicherweise neuer als die letzte veröffentlichte bzw. automatisch gespeicherte Revision und stellt dafür gesonderte Forge-Editor-APIs bereit. Das ist keine Zusage, dass REST-Lesen oder ein Attachment-Update automatisch jeden bereits geöffneten Browsereditor aktualisiert. Die tatsächliche Live-Anzeige bleibt eine separate Abnahme. [Atlassian: Editor- und Snapshot-Unterschied](https://community.developer.atlassian.com/t/please-test-update-your-confluence-cloud-apps-to-function-in-live-docs-by-may-30-2025/89849).

Atlassians weiterhin ungelöster Fehlerbericht beschreibt außerdem: `status=draft`, `version.number=1` aktualisiert einen LiveDoc-Inhalt, erzeugt jedoch allein keine neue Current-Version nach dem üblichen Zeitfenster. Als Workaround nennt Atlassian einen späteren Current-Update mit passender Versionsnummer. Das ist ein dokumentierter Verhaltenshinweis, keine Empfehlung, den Produktcode unbesehen auf Draft-Schreiben umzustellen. [CONFCLOUD-83848](https://jira.atlassian.com/browse/CONFCLOUD-83848).

## Minimaler nächster Schritt / mögliche Fable-Ergänzung

1. Zunächst gespeichertes Referenzdiagramm öffnen und die bestehende Suche im tatsächlichen Plugin ausführen. **Keinen `subtype=live`-Scheinfix** aus der bisherigen Beobachtung ableiten.
2. Wenn eine echte Liste das bekannte Ziel nicht findet: Paging und den konfigurierten Space untersuchen. Der Code holt nur die erste Seite mit 100 Einträgen und filtert danach lokal. Das ist eine nachvollziehbare Auffindbarkeitsgrenze, derzeit kein nachgewiesener Fehler für Seite164037. Die offizielle Liste ist paginiert. [Get pages](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-get).
3. Eine gezielte URL-/ID-Auflösung für die ausdrücklich vorgegebene Seite ist ein sinnvoller kleiner Produktvorschlag: ID aus eigener Site-URL validieren und über den vorhandenen Plugin-Service per `GET /pages/164037` prüfen. Das löst die Abhängigkeit von der ersten Suchergebnisseite. Das ist eine Empfehlung, keine ausgeführte Änderung.
4. Für sicheres Body-Schreiben in native Live Docs Typ/Status und gegebenenfalls den Draft bewusst lesen und vergleichen; niemals pauschal einen Current-Body als neuesten Editorinhalt behandeln. `get-draft=true` ist ein dokumentierter REST-Lesepfad, dessen konkretes Verhalten am Ziel noch zu prüfen ist. Der vorhandene offene Befund zum Draft-/Body-Konflikt bleibt bestehen; diese Recherche beweist keine atomare Schreibsicherheit und fordert keinen automatischen Wechsel auf Draft-Schreiben.

Für die unmittelbar nächste Fable-Korrekturrunde folgt aus der angeblich leeren Suche **keine zusätzliche bestätigte subtype-Korrektur**. CF10 und CF11 bleiben unabhängig davon bestätigt. Native LiveDoc-Lesen/Schreiben und tatsächliche Browseraktualisierung müssen an der konkreten Zielseite überprüft werden.
