/**
 * Stands in for `elkjs` in the build (#279). Mermaid can lay out a few diagrams with ELK when their code asks for
 * it (`layout: elk`); ELK is published under EPL-2.0 or GPL-3.0 and is not shipped with Sketchdraw. A diagram that
 * asks for it is not drawn and says so; every other diagram uses Mermaid's own layouts.
 */
export default class ELK {
  constructor() { throw new Error('The ELK layout is not part of Sketchdraw. Remove "layout: elk" from the code.'); }
}
