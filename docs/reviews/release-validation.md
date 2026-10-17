# Konsolidierte Produkt- und Release-Nachweise

Stand: 17.10.2026, ergänzt vor Integration der Korrektur für #26. Tatsächlicher Reviewer: OpenAI Codex (`dependency_review`), ausschließlich Dokumentation und lesender Abgleich der GitHub-Jobs/Logs sowie lokalen Smoke-Berichte. Die nachfolgend ausdrücklich bezeichneten neuen lokalen Ergebnisse wurden vom koordinierenden Codex bestätigt; für diese Ergänzung wurden keine Tests erneut ausgeführt. Bezug: [#24](https://github.com/J-ARTS/de.sketchdraw.io/issues/24), Plattformprüfung [#15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15), Packagingfehler [#26](https://github.com/J-ARTS/de.sketchdraw.io/issues/26). Die historischen Einzelberichte bleiben Nachweise ihres jeweiligen Prüfstands.

**Produkt-CI auf allen drei Systemen bestanden; Release v0.1.0 nicht veröffentlicht.** Der Release-Lauf scheiterte beim macOS-Packaging. Windows- und Linux-Installer haben ihre tatsächlichen Startprüfungen bestanden; diese zwei Ergebnisse ergeben noch kein vollständiges Release derselben Revision.

## Evidenzmatrix

| Stand / Umgebung | Tatsächliches Ergebnis | Beleg |
| --- | --- | --- |
| `f91538a07dd4f2ac77efa25ae00167bce1ffff4e`; Ubuntu 24.04 x64, macOS 15 arm64, Windows 2025 x64; Node 22.16.0 | **Gesamte CI bestanden.** Je 19 Browser-UI- und 6 Electronprüfungen; Linux/macOS 282 Vitestfälle, Windows 279 bestanden / 3 übersprungen. Nodeprüfungen 44/44, Governance/Python und Typechecks erfolgreich. | [CI 39044253516](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39044253516) |
| Derselbe Produktstand; nativer Linux-P2P-Job | **3/3 bestanden:** zwei Chromium-Kontexte, zwei Electronfenster mit expliziter Sandbox, zwei vollständige App-Seiten mit Pairing, Mutation, Ergebnisauflösung und lokaler Kopie beim Verlassen. | [Job 117429722080](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39044253516/job/117429722080) |
| Tag `v0.1.0`, `a041ceab3031f25bf391f1d3ce48527e244ea53a` | **Erneute vollständige Produkt-CI auf allen drei Systemen sowie P2P bestanden. Release insgesamt fehlgeschlagen; Publish übersprungen.** | [Release 39044870745](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39044870745) |
| `v0.1.0` / `a041cea`; Linux x64 DEB | **Packaging und nativer Installer-Smoke bestanden:** aus dem erzeugten DEB extrahierte GUI und gebündelter MCP-Adapter gestartet. | [Job 117432880687](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39044870745/job/117432880687), [Smoke-Artefakt](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39044870745/artifacts/12105467158) |
| `v0.1.0` / `a041cea`; Windows x64 NSIS | **Packaging und nativer Installer-Smoke bestanden:** tatsächliches NSIS-Payload extrahiert, GUI und MCP gestartet. | [Job 117432880773](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39044870745/job/117432880773), [Smoke-Artefakt](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39044870745/artifacts/12106220541) |
| `v0.1.0` / `a041cea`; macOS arm64 DMG | **Packaging fehlgeschlagen**, vor positivem Installer-Smoke: leeres `CSC_LINK` wird als Zertifikatpfad behandelt; Builder meldet Checkoutverzeichnis „not a file“. Lokal inzwischen korrigiert und geprüft; neuer vollständiger Release-Lauf noch offen. | [Job 117432880776](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39044870745/job/117432880776), [#26](https://github.com/J-ARTS/de.sketchdraw.io/issues/26) |
| Früherer lokaler macOS-arm64-Lauf, Version 0.1.0 / `f91538a`, Signingvariablen nicht gesetzt | **Echter DMG-Smoke bestanden**, einschließlich extrahierter GUI und MCP. Historischer, zuvor gelesener Nachweis; die lokalen Smoke-/Manifestdateien wurden durch die folgende Probe überschrieben. | Historischer Installer-Hash unten; kein Verweis auf eine weiterhin unveränderte lokale Berichtsdatei. |
| Neue lokale macOS-arm64-Probe, Version 0.1.0 / `a041cea` **plus unveröffentlichte #26-Korrektur**, alle elf CI-Signing-Secrets als leere Strings | **Echter DMG-Smoke bestanden:** extrahierte App, `appIsPackaged`, Sandbox, ASAR, MCP-Initialisierung, sechs Tools und verweigerter Zugriff ohne Grant. Kein nativer CI-Erfolg für Version 0.1.1. | Vom Koordinator bestätigte Probe; aktueller lokaler Bericht `release/smoke-mac.json`, Installer-Hash unten. |

Die drei Windows-Skips betreffen POSIX-Symlink-/Aliasfälle in `tests/unit/platform/persistence.spec.ts` und `tests/unit/desktop-review.spec.ts`; sie werden nicht als bestanden gezählt. Die erfolgreiche Windows-CI enthält den echten Desktop-/SDK-Test und damit den Windows-Loopback-Transport. Die native P2P-Positivprüfung erfolgte auf Linux; ein allgemeiner Drei-Plattform-/Internet-P2P-Nachweis folgt daraus nicht.

## Identität der tatsächlich geprüften Installer

SHA-256 aus den jeweiligen Smoke-Berichten und Stagingmanifesten, keine veröffentlichten Asset-Digests:

| Installer / Prüfstand | SHA-256 |
| --- | --- |
| `Sketchdraw-0.1.0-linux-x64.deb`, CI `a041cea` | `1a61fe8ee46eb6aa981f33349175d74504a40f9bb615d0c7d7fa94e22f8f0422` |
| `Sketchdraw-0.1.0-windows-x64.exe`, CI `a041cea` | `162898a3e8c6240ed5106796512612fbd6eacf81f540e63c4ad6f2c6e96bffaf` |
| `Sketchdraw-0.1.0-macos-arm64.dmg`, lokaler Stand `f91538a` | `4caabe475c164275cf519649db1f97909a5ec02b5850e9f855005dba2cb0d18e` |
| `Sketchdraw-0.1.0-macos-arm64.dmg`, lokale #26-Korrektur auf `a041cea`, elf leere Signing-Secrets | `7298e18315b36afd93bd9e1a8cb69d37042f6ae00ce8fd1a89dfa66d0d4050b2` |

## Aussagegrenzen und Fortsetzung

Die Installer-Smokes prüfen die aus genau diesen Archiven extrahierte Anwendung: Architektur/Version, echten ASAR-Inhalt mit Bundle-Hashes, sichtbaren Renderer und Preload, `app.isPackaged`, Sandbox ohne `--no-sandbox`, Context Isolation und deaktivierte Node-Integration. Der ausgelieferte Electron-Prozess startet anschließend den ASAR-MCP-Adapter; der SDK-Client bestätigt Initialisierung, sechs Tools und `ACCESS_DENIED` ohne Freigabe. Autorisierte Dokumentänderungen werden durch den getrennten Desktop-Produkttest abgedeckt.

Dies ist ein **Startnachweis nach Extraktion**, keine interaktive Installations-/Deinstallationsprüfung, keine Registrierung durch den Installationsassistenten und keine Gatekeeper-/SmartScreen-Freigabe. Der lokale Mac-Build ist ad-hoc-signiert, ohne Developer ID und ohne Notarisierung; Windows und DEB sind laut Manifest unsigniert. Es gibt keinen Produktionszertifikatsnachweis. Die Linux-Extraktion führt kein DEB-Postinstall aus; der CI-Smoke nutzt eine temporäre, exakt an die extrahierte Binary gebundene AppArmor-Userns-Freigabe.

Die #26-Korrektur einschließlich der unabhängig geprüften Windows-Passwortfallbackkorrektur ist zur Integration freigegeben. Vom Koordinator bestätigte lokale Prüfungen: **22/22** in `release.test`, **31/31** in `release*.test`, **51/51** Nodeprüfungen insgesamt sowie **22/22** Pythonprüfungen. Diese Teilmengen werden nicht addiert. Die neue reale DMG-Probe oben prüft genau die zuvor problematischen elf leeren CI-Secretwerte.

Version **0.1.1** ist im Manifest vorbereitet. Nächster Schritt: Korrektur integrieren und veröffentlichen, danach native CI und alle drei Installer derselben neuen Revision einschließlich Remote-Asset-Identität bestätigen. Bis zum belegten erfolgreichen Publish bleibt die Veröffentlichung offen. Für 0.1.1 ist noch kein erfolgreicher nativer Lauf vorweggenommen.
