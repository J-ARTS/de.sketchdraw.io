import { defineComponent, h, type PropType, type VNode } from 'vue';
import { resolveCatalogIcon } from '@/catalog';
import type { SafeSvgElementNode } from '@/catalog';

/** Only the catalog's validated tree crosses into DOM creation; raw SVG is never HTML. */
export default defineComponent({
  props: { source: String, size: { type: [Number, String] as PropType<number | string>, default: 32 } },
  setup(props) {
    function child(node: SafeSvgElementNode): VNode {
      return h(node.tag, { ...node.attributes }, node.children.map(child));
    }
    return () => {
      const { tree } = resolveCatalogIcon(props.source);
      return h('svg', { ...tree.attributes, viewBox: tree.viewBox, width: props.size, height: props.size, 'aria-hidden': 'true' }, tree.children.map(child));
    };
  },
});
