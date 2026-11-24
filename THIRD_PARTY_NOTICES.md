# Third-party software notices

Sketchdraw is published under the Functional Source License, Version 1.1, ALv2 Future License (`FSL-1.1-ALv2`, see `LICENSE`). The following direct runtime dependencies added for collaborative editing are separately available under the MIT License. Their licenses remain applicable to those packages.

| Package | Pinned version | License | Purpose |
| --- | --- | --- | --- |
| `yjs` | 13.6.32 | MIT | CRDT document, updates, state vectors and undo |
| `y-protocols` | 1.0.7 | MIT | Ephemeral awareness protocol |
| `y-indexeddb` | 9.0.12 | MIT | Local IndexedDB recovery cache |
| `nanoevents` | 9.1.0 | MIT | Typed post-commit events |
| `@trystero-p2p/mqtt` | 0.26.0 | MIT | Automatic MQTT/WSS peer discovery and WebRTC transport |
| `@trystero-p2p/core` | 0.26.0 | MIT | Trystero transport core (transitive dependency) |
| `@vueuse/core` | 15.0.0 | MIT | Vue renderer lifecycle and browser composables |
| `@vueuse/shared` | 15.0.0 | MIT | Shared VueUse composable utilities (transitive dependency) |
| `@vueuse/metadata` | 15.0.0 | MIT | VueUse composable metadata (transitive dependency) |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | Typed style variants of the design-system atoms |
| `clsx` | 2.1.1 | MIT | Class-name composition (transitive dependency of class-variance-authority) |
| `mermaid` | 12.3.0 | MIT | Draws Mermaid diagrams the app has no shapes for; loaded only when such a diagram is imported or redrawn |

Complete dependency metadata and resolved transitive versions are recorded in `package-lock.json`. This notice does not replace the license files distributed by the packages.

## Mermaid and the libraries it brings

`mermaid` 12.3.0 is bundled with the libraries it loads to parse and draw diagrams (116 packages in `package-lock.json`). Their licenses:

| License | Packages |
| --- | --- |
| MIT | 68, among them `mermaid`, `d3` and most of its modules, `dagre-d3-es`, `cytoscape`, `katex`, `khroma`, `langium`, `lodash-es`, `marked`, `roughjs`, `stylis`, `uuid` |
| ISC | 33, mostly modules of `d3` |
| BSD-3-Clause | `d3-array` 2.12.1, `d3-ease` 3.0.2, `d3-path` 1.0.9, `d3-sankey` 0.12.3, `d3-shape` 1.3.7, `rw` 1.3.3 |
| Apache-2.0 | `chevrotain` 13.2.0 and its `@chevrotain/*` packages |
| MPL-2.0 OR Apache-2.0 | `dompurify` 3.5.0 (used under Apache-2.0) |
| Unlicense | `robust-predicates` 3.0.3 |

**Not shipped:** `elkjs` 0.12.1 (EPL-2.0 OR GPL-3.0-or-later). Mermaid can lay out some diagrams with ELK. The build replaces `elkjs` with a stub (`src/renderer/lib/stubs/elk.ts`), and diagrams are laid out with Mermaid's own layout (dagre). A diagram whose code asks for ELK is not drawn and says so.
