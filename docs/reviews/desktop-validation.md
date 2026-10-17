# Desktop-Backend-Abnahme nach Reparatur

Issues #8/#15/#17/#22/#23. Implementierung: echter Antigravity-Run `antigravity-desktop-fixes-001`; ausführende unabhängige Prüfinstanz: Codex. Dateien lokal und noch nicht integriert.

macOS arm64, Node22.16.0, Vitest5.0.5, TypeScript6.0.3; 17.10.2026,15:30 Europe/Berlin.

- `npx vitest run tests/unit/desktop-security.spec.ts tests/unit/desktop-review.spec.ts tests/unit/platform/`: **32/32 Tests in fünf Dateien bestanden**, Exit0,14,05s.
- `npx tsc -p tsconfig.electron.json --noEmit`: **bestanden**.
- `npm run build:electron`: **bestanden**, main.cjs107,0kB/preload.cjs12,8kB.

Prüfungen enthalten unveränderte unabhängige Regressionen für erlaubte Custom-Scheme-Hauptseite versus fremde Sender, Save-as-/Export-Fremdänderungen einschließlich neuer Zieldatei, Verzeichnis-Symlink-Sperren und Dateisymlink-Erhalt; außerdem echte temporäre Dateisystemfälle und Browser-Adapterfehlerpfade. Eigene Implementierertests sind zusätzlich im selben Lauf enthalten.

**Noch nicht ausgeführt:** echter Renderer-/Electron-Fensterstart, native Dialoge/Close-Integration, Windows/Linux. Die Frontend-Lieferung ist unvollständig. Ein bestandenes Backend-Bundle ersetzt keine native GUI-Abnahme.

**Präzisierung zum Implementiererbericht:** Die verbleibende Fremdprozess-Race zwischen letzter Prüfung und Rename ist qualitativ dokumentiert. Dessen Formulierungen „Sub-Millisekundenbereich“/„Mikrofenster“ sind keine gemessenen oder garantierten Zeitobergrenzen. Prozessinterne Serialisierung und konkrete konfliktgeschützte Fälle sind getestet; ein atomarer Kernel-CAS gegenüber beliebigen externen Prozessen wird nicht behauptet.

## Dateihashes

- `electron/close-handshake.ts`: `2f3506fba62c1423fed915797ee72759e87476e3f15f3ab98b6163256c8ae65b`
- `electron/ipc-contract.ts`: `ab0b49e88b88c6b83e6e69a06a79d56e6c3693ef099db627d09a74a4cf3bae58`
- `electron/main.ts`: `d6b339ea2188c08247ad928acd607d10b75d5956b5c25430a5ce368f71b2c112`
- `electron/persistence.ts`: `4c3abb9f83a7377d7ee33e81c4399efa541d6611024ecd0d5441855028b12f90`
- `electron/preload.ts`: `46f6a6c049266a5cd0df9cad3cbb8e99629e609e996ad2391716129d163eb9a5`
- `electron/security.ts`: `5e868ca5f47947bc3a892acebf899e8e05a982a7fa486c0ba73feb74e1775b7b`
- `src/platform/browser-bridge.ts`: `3b3ea2b18518a4d0cdbad845047295657526390c65cf121666399a67d221a81d`
- `src/platform/index.ts`: `003a27bd7ebc5f21d3e7923538d1bf121bb8defd811bfa15bb0075cba050fa54`
- `tests/unit/desktop-review.spec.ts`: `785408cc5055e29f6f1fd5ed647cb0527e03f3939a0f9f54be3b13bfc85a7e4c`
- `tests/unit/desktop-security.spec.ts`: `6383d6677e597cbd539a4628b400388d6b5344baa0af9b45c4c8bb459a363857`
- `tests/unit/platform/browser-bridge.spec.ts`: `56f2a9408a075861cd290d456a0e8d36b82e586141ec156d05fff121378adf26`
- `tests/unit/platform/persistence.spec.ts`: `b995d573b04c0d12824e00d29b6601c17289b9596f238bc0c74500eb9da8e253`
- `tests/unit/platform/security-and-ipc.spec.ts`: `dd2d9f2755b129d24456d2604963ac49df68e5b3c2fd69a0c8a43d4d776835a4`

Erfasst:2026-10-17T13:33:32.744243+00:00.
