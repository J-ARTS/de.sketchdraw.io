# Design System

Das Design System ist der eine Ort für alle UI-Komponenten von Sketchdraw. Es liegt unter `src/renderer/design-system/` und folgt [Atomic Design](https://atomicdesign.bradfrost.com/chapter-2/): Aus kleinen Bausteinen entstehen größere, und jede Ebene verwendet nur die Ebenen davor.

- **Katalog zum Ansehen:** `npm run storybook` (http://localhost:6006), statisch mit `npm run build:storybook`.
- **Verzeichnis zum Nachschlagen:** [`manifest.md`](manifest.md) mit Beschreibung, Props, Events, Slots und Methoden jeder Komponente. Es wird aus dem Code erzeugt (`npm run design-system:manifest`).
- **Regeln für Agenten:** Abschnitt „Design System" in `AGENTS.md` und `CLAUDE.md`.

## Ebenen

| Ebene | Ordner | Was dort liegt | Beispiele |
| --- | --- | --- | --- |
| Tokens | `src/renderer/styles/tokens.css`, `base.css` | Farben, Abstände, Radien, Schrift, Höhen; gemeinsame Klassen | `--surface-panel`, `--chrome-height`, `.sd-panel` |
| Atoms | `atoms/` | Kleinste Bausteine aus HTML und Tokens | `AppButton`, `AppIconButton`, `AppTextField`, `AppIcon` |
| Molecules | `molecules/` | Wenige Atoms mit einer Aufgabe, gesteuert nur über Props und Events | `AppSelect`, `ColorPicker`, `TaskCard` |
| Organisms | `organisms/` | Eigenständige Abschnitte der Oberfläche, lesen und ändern den Store | `Toolbar`, `SelectionToolbar`, `AppDialog`, `WhiteboardCanvas` |
| Templates | `templates/` | Anordnung von Organisms ohne eigenen Inhalt | `WorkspaceLayout`, `WorkspacePanels` |
| Pages | `pages/` | Ein Template mit echtem Anwendungszustand | `WorkspacePage` |

Daneben: `composables/` (gemeinsame Logik wie `use-anchored-popover`), `storybook/` (Hilfen nur für Stories) und `index.ts` (Liste aller Komponenten).

Zwei Regeln entscheiden die Einordnung:

1. **Store oder nicht:** Wer `useWhiteboard()` oder `@/renderer/state/…` braucht, ist mindestens ein Organism. Atoms und Molecules bekommen alles über Props und melden alles über Events; dadurch lassen sie sich einzeln zeigen und testen.
2. **Richtung:** Importiert wird nur nach unten. Ein Molecule verwendet Atoms, ein Organism Molecules und Atoms. Braucht ein Baustein etwas aus einer höheren Ebene, gehört er selbst dorthin (so sind `FramePreview` und `PayloadPreview` Organisms: Sie zeichnen mit `ElementView`).

## Verwenden

```vue
<script setup lang="ts">
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import AppTextField from '@/renderer/design-system/atoms/AppTextField.vue';
</script>

<template>
  <AppTextField v-model="name" aria-label="Name" />
  <AppButton intent="primary" type="submit">Speichern</AppButton>
  <AppIconButton icon="close" label="Dialog schließen" @click="emit('close')" />
</template>
```

| Aufgabe | Baustein |
| --- | --- |
| Aktion mit Text | `AppButton` (`intent`: `neutral`, `primary`, `danger`) |
| Aktion nur als Symbol | `AppIconButton` (`icon`, `label`; `pressed` für Umschalter) |
| Einzeilige Eingabe | `AppTextField` (`v-model`, `type`, `invalid`) |
| Mehrzeilige Eingabe | `AppTextarea` |
| Beschriftung eines Felds | `AppFieldLabel` (`for`) |
| Tastenhinweis | `AppKbd` |
| Symbol | `AppIcon` (Namen aus `atoms/icons.ts`) |
| Auswahl aus einer Liste | `AppSelect` (auch mit freier Eingabe über `editable`) |
| Datum | `AppDatePicker` |
| Farbe | `ColorPicker` |
| Hilfe, ungespeicherte Änderungen, Speicherkonflikt | `AppDialog` über `store.state.dialog` |

Attribute und Listener, die keine Props sind (`disabled`, `aria-*`, `data-testid`, `@click`, `class`), gehen bei den Atoms an das native Element.

## Ergänzen

1. **Ebene wählen** nach den zwei Regeln oben.
2. **Datei anlegen:** `src/renderer/design-system/<ebene>/<Name>.vue`. Gemeinsame Bausteine heißen `App…`.
3. **Beschreiben:** Erste Zeile `<!-- @component Was die Komponente ist und wann man sie verwendet. -->`. Props, Events, Slots und `defineExpose` mit `/** … */` kommentieren; diese Texte landen im Manifest und in Storybook.
4. **Varianten typisieren:** Aussehensvarianten als `cva`-Tabelle in `<name>.variants.ts` daneben, der Typ der Prop kommt aus der Tabelle (siehe `atoms/button.variants.ts`).
5. **Tokens verwenden:** keine festen Farben, Abstände oder Höhen. Fehlt ein Wert, wird er in `tokens.css` ergänzt (hell und dunkel).
6. **Eintragen:** Export in `index.ts`.
7. **Story schreiben:** `<Name>.stories.ts` daneben, Titel `<Ebene>/<Name>`, je ein Export für die wichtigen Zustände (Standard, deaktiviert, Fehler, leer). Organisms bekommen ihren Store über `withWhiteboard()` aus `storybook/with-whiteboard.ts`.
8. **Manifest erzeugen:** `npm run design-system:manifest`, Ergebnis mit einchecken.
9. **Prüfen:** `npx vitest run --config vitest.config.ts tests/unit/renderer/design-system.spec.ts`, `npm run typecheck`, `npm run build:storybook`; die Story hell und dunkel ansehen.

## Was geprüft wird

`tests/unit/renderer/design-system.spec.ts` läuft mit den Unit-Tests und in der CI:

- Jede `.vue`-Datei des Renderers liegt in genau einer Ebene; außerhalb gibt es nur `App.vue`.
- `index.ts` nennt jede Komponente und nichts, was es nicht gibt.
- Jede Komponente hat ihre `@component`-Beschreibung.
- Keine Importe in eine höhere Ebene; Atoms und Molecules ohne Store.
- Jedes Atom, Molecule, Template und jede Page ist in Storybook zu sehen. Für Organisms gibt es eine Liste der noch fehlenden, die nur kürzer werden darf.
- `manifest.md` entspricht dem Code.
- Kein natives `<select>` oder `<datalist>`.
- Die Zahl handgeschriebener `sd-btn`-, `sd-icon-btn`-, `sd-input`- und `sd-textarea`-Elemente außerhalb der Atoms ist festgeschrieben und darf nur sinken. Wer eine Stelle auf ein Atom umstellt, senkt die Zahl im Test.

## Stand und offene Punkte

- 51 Textschaltflächen verwenden `AppButton`. Der Altbestand (15 Textschaltflächen, 34 Symbolschaltflächen, 7 Eingabefelder) wird beim nächsten Anfassen der jeweiligen Komponente umgestellt.
- Zwölf Organisms haben noch keine Story (Liste im Test), weil sie einen Dokumentzustand brauchen, der sich nicht mit einem Aufruf herstellen lässt.
- Schaltflächen in Menüs und Leisten mit eigener Gestaltung (`role="menuitem"`, Werkzeugschaltflächen) sind bewusst keine `AppButton`; sie gehören zu ihrem Organism.
