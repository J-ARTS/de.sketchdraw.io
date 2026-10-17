# Domain-Abnahme nach Reparatur

Issues #9/#15/#18/#19/#20/#21. Koordinator und ausführende Prüfinstanz: Codex. Implementierung: tatsächlicher Antigravity-Lauf `antigravity-domain-fixes-001` mit Gemini 4 Argon High. Änderungen lokal, uncommitted; keine Integration oder Ticketabschluss behauptet.

## Ausgeführt

macOS arm64, Node 22.16.0, Vitest 5.0.5, TypeScript 6.0.3. Prüflauf am 17.10.2026 um 15:21 Europe/Berlin.

- `npx vitest run tests/unit/domain.spec.ts tests/unit/domain-review.spec.ts tests/unit/geometry-acceptance.spec.ts tests/unit/domain/`: **32 Tests in vier Dateien bestanden**, Exit 0, Dauer 989 ms.
- `npx tsc -p tsconfig.electron.json --noEmit`: **bestanden**, Exit 0; enthält die in Electron verwendete Domain.

Die unabhängigen Basis- und Regressionstests wurden für die Reparatur nicht abgeschwächt. Geprüft werden unter anderem Atomarität, CAS, Fremdänderungsschutz, per-Actor-Undo, JSON-Roundtrips, Ressourcenlimits sowie die vier konkreten Befunde: Connector-Eigenrotation, Elementtypwechsel in History, kanonisches Größenbudget vor Commit und sichere Ganzzahlrevisionen einschließlich Undo/Redo-Überlauf.

## Grenzen

Noch keine vollständige Renderer-/Desktop-Integration; UI, Windows und Linux in diesem Lauf nicht ausgeführt. Die zusätzlichen Tests des Implementierenden sind im selben Lauf enthalten, die unabhängigen Prüfungen sind getrennte Dateien. Ein bestandener Test beweist nur seine tatsächlichen Fälle.

## Geprüfte Dateien (SHA-256)

- `src/domain/commands.ts`: `7a1f4863d4f299d145f53cb2a7db26ecb5aa73a9df87a6db768e847f7e91d69d`
- `src/domain/controller.ts`: `7b15a3d2e63c365a91f8cf92041ac8e5ee6135c923f9c03d5e925051eb21b09b`
- `src/domain/errors.ts`: `b88453fa26ee5d50cadad1a494296f67102947b127261dd7877b6b00e3404b60`
- `src/domain/factories.ts`: `73435c534971fd5d380f6cba73f0aaa93f359b78eb2a8a4b19ab1ac24e569d9f`
- `src/domain/geometry.ts`: `adb04f7e1e33f2bd92cb007159d13d2230e339f9fdab05feb2348c64c1f05fbf`
- `src/domain/index.ts`: `bb51f63324afd0d244d2b95587e8ef55d1073980d4e1ed25a92daf3ced671741`
- `src/domain/limits.ts`: `328481ca0d38fc80e9010396803799b4e0a74a02005beba14c0f1b23feab0244`
- `src/domain/serialization.ts`: `2c9e3b142e91fc6fe6ae0c7f2858139e70a609d4a7dc4cedd0504ea861fead52`
- `src/domain/types.ts`: `5ee12a57b46a95b5e8600e4d448bdd16e863380feea727c6b9cf1a8d7f453518`
- `src/domain/validation.ts`: `754c71d671453732bfb5de1092132d5265adc91140f339a92a564c52ded5b1c5`
- `tests/unit/domain.spec.ts`: `4e5e91c1ed19d9038d4ceaeb0b7a6ac904ca9375a36bb12288a4cefcbfd95c9d`
- `tests/unit/domain-review.spec.ts`: `8cf535f840cdadf221aa5fef5b12b4c19d4b8669a035599a6de59eda2a13319b`
- `tests/unit/geometry-acceptance.spec.ts`: `6943f02d5e0fe46b4510c1f4f1722509e0bbab181af99504a1eee53eebb7b136`
- `tests/unit/domain/domain-extended.spec.ts`: `32704b54814a15abe4bb336a5deefb83e8a99018c07aeba3c095b030072f4f76`

Erfasst: 2026-10-17T13:22:28.064048+00:00.
