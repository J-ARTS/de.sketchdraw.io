# Files of builds between releases 0.1.8 and 0.1.9

Written on 2026-11-22 by the builds named in the file names (`git worktree` of the commit, `prepareSvgExport` and
`prepareDrawioExport` with the embedded document). All of them name `svg-v2` and `drawio-v3`, but the picture
under these numbers changed twice in that time (#290):

| Build | SVG picture 2 | draw.io picture 3 |
| --- | --- | --- |
| `41dc689` | symbol of a plain component in its corner | only components as pictures, with that symbol |
| `1fd1e8d` | symbol centred, text in the lower half | only components as pictures, with the centred symbol |
| `14001e6` | as `1fd1e8d` | notes, tables and rich text as pictures too, editable labels |

`tests/unit/interop/intermediate-builds.spec.ts` reads them. They are never regenerated: they are what those builds
wrote.

## Ticket cards before they had a picture of their own

`tickets-66857f3.svg`, `.drawio` and `.mmd` were written on 2026-11-23 by build `66857f3`, the first with ticket
cards (#283). It wrote them under `svg-v3`, `drawio-v5` and `mermaid-v2` as rectangles with the title of the ticket.
Since `svg-v4`, `drawio-v6` and `mermaid-v3` a card is exported as the card of the canvas; the files of that build
still are the picture their numbers stand for. `tests/unit/interop/ticket-card-export.spec.ts` reads them.
