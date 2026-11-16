import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppSwitch from '@/renderer/design-system/atoms/AppSwitch.vue';

const meta = {
  title: 'Atoms/AppSwitch',
  component: AppSwitch,
  args: { modelValue: true },
  render: (args) => ({
    components: { AppSwitch },
    setup: () => { const on = ref(args.modelValue); return { on }; },
    template: '<div style="width:420px"><AppSwitch v-model="on">Beim Speichern committen<template #description>Jedes Speichern des Diagramms wird ein Commit.</template></AppSwitch></div>',
  }),
} satisfies Meta<typeof AppSwitch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};
export const Off: Story = { args: { modelValue: false } };
/** Without a description the switch is one line. */
export const NameOnly: Story = { render: () => ({ components: { AppSwitch }, setup: () => ({ on: ref(false) }), template: '<div style="width:320px"><AppSwitch v-model="on">Nur dieses Diagramm</AppSwitch></div>' }) };
export const Disabled: Story = { render: () => ({ components: { AppSwitch }, template: '<div style="width:420px"><AppSwitch :model-value="true" disabled>Nach dem Commit pushen<template #description>Solange gespeichert wird, lässt sich das nicht umschalten.</template></AppSwitch></div>' }) };
