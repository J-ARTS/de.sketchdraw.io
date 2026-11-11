/// <reference path="../../../src/renderer/env.d.ts" />
import { createApp, defineComponent, h, nextTick, onMounted, ref } from 'vue';
import AppSelect from '../../../src/renderer/components/AppSelect.vue';
import '../../../src/renderer/styles/tokens.css';
import '../../../src/renderer/styles/base.css';

// Real component fixture: exercises dynamic option/permission changes and top-layer clipping independently of domain flows.
const Harness = defineComponent({
  setup() {
    const value = ref('svg'), assignee = ref(''), disabled = ref(false), dialog = ref<HTMLDialogElement>();
    const options = ref([{ value: 'svg', label: 'SVG' }, { value: 'blocked', label: 'Unavailable', disabled: true }, { value: 'drawio', label: 'draw.io' }, { value: 'mermaid', label: 'Mermaid (Flowchart)' }]);
    onMounted(() => {
      dialog.value!.showModal();
      window.addEventListener('dropdown-fixture', ((event: CustomEvent) => {
        if ('disabled' in event.detail) disabled.value = event.detail.disabled;
        if ('options' in event.detail) options.value = event.detail.options;
        if ('value' in event.detail) value.value = event.detail.value;
        if ('theme' in event.detail) document.documentElement.dataset.theme = event.detail.theme;
        if ('disableOption' in event.detail) options.value.find(option => option.value === event.detail.disableOption)!.disabled = true;
      }) as EventListener);
      void nextTick(() => dialog.value!.querySelector<HTMLButtonElement>('[role=combobox]')?.focus());
    });
    return () => h('dialog', { ref: dialog, 'aria-labelledby': 'fixture-title', style: 'width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 24px);padding:16px;background:var(--surface-panel);color:var(--text-primary);overflow:hidden;' }, [
      h('h1', { id: 'fixture-title', style: 'font-size:18px;margin-bottom:16px' }, 'Dropdown fixture'),
      h('div', { style: 'overflow:auto;transform:translateZ(0);height:120px;padding:4px;' }, [
        h(AppSelect, { label: 'Format', modelValue: value.value, options: options.value, disabled: disabled.value, placeholder: 'Choose format', 'onUpdate:modelValue': (v: string) => { value.value = v; } }),
        h('output', { 'data-testid': 'selected-value' }, value.value),
      ]),
      h(AppSelect, { label: 'Assignee', editable: true, maxlength: 120, placeholder: 'Name', modelValue: assignee.value, options: [{ value: 'Ada Lovelace', label: 'Ada Lovelace' }, { value: 'Grace Hopper', label: 'Grace Hopper' }], 'onUpdate:modelValue': (v: string) => { assignee.value = v; } }),
      h('output', { 'data-testid': 'assignee-value' }, assignee.value),
      h('button', { type: 'button', 'data-testid': 'outside', style: 'display:block;margin-top:16px;padding:12px' }, 'Next control'),
    ]);
  },
});
createApp(Harness).mount('#fixture');
