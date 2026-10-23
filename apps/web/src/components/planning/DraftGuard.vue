<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
const props = defineProps<{ dirty: boolean }>();
const open = ref(false);
let pending: ((ok: boolean) => void) | undefined;
function guard() { if (!props.dirty) return true; open.value = true; return new Promise<boolean>(resolve => { pending = resolve; }); }
function settle(ok: boolean) { open.value = false; pending?.(ok); pending = undefined; }
function unload(e: BeforeUnloadEvent) { if (props.dirty) { e.preventDefault(); e.returnValue = ''; } }
onBeforeRouteLeave(guard); onBeforeRouteUpdate(guard);
onMounted(() => window.addEventListener('beforeunload', unload));
onBeforeUnmount(() => { window.removeEventListener('beforeunload', unload); pending?.(false); });
</script>
<template><ConfirmDialog :open="open" title="离开前要保存吗？" message="还有未保存的输入。留在这里可继续编辑，离开会丢弃这些输入。" confirm-text="丢弃并离开" danger @confirm="settle(true)" @update:open="settle(false)" /></template>
