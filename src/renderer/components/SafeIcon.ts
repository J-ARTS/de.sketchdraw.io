import { defineComponent, h, type PropType, type VNode } from 'vue';
import { resolveCatalogIcon } from '@/catalog';
import type { ResolvedCatalogIcon, SafeSvgElementNode } from '@/catalog';

/** Parsed icons are cached by source: the library shows hundreds of official icons (#92). */
const parsed = new Map<string, ResolvedCatalogIcon>();
const MAX_CACHED = 4000;
function resolve(source: string | undefined): ResolvedCatalogIcon {
  if (source === undefined) return resolveCatalogIcon(source);
  let icon = parsed.get(source);
  if (!icon) {
    icon = resolveCatalogIcon(source);
    if (parsed.size >= MAX_CACHED) parsed.delete(parsed.keys().next().value!);
    parsed.set(source, icon);
  }
  return icon;
}

/** Only the catalog's validated tree crosses into DOM creation; raw SVG is never HTML. */
export default defineComponent({
  props: { source: String, size: { type: [Number, String] as PropType<number | string>, default: 32 } },
  setup(props) {
    function child(node: SafeSvgElementNode): VNode {
      return h(node.tag, { ...node.attributes }, node.children.map(child));
    }
    return () => {
      const { tree } = resolve(props.source);
      return h('svg', { ...tree.attributes, viewBox: tree.viewBox, width: props.size, height: props.size, 'aria-hidden': 'true' }, tree.children.map(child));
    };
  },
});
