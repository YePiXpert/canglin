<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import type { IScannerControls } from '@zxing/browser';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
const emit = defineEmits<{ scan: [value: string] }>();
const video = ref<HTMLVideoElement>(), manual = ref(''), active = ref(false), starting = ref(false), failure = ref('');
let controls: IScannerControls | undefined, generation = 0, last = '', lastAt = 0;
function stop() { generation++; controls?.stop(); controls = undefined; active.value = false; starting.value = false; }
async function start() { stop(); const current = generation; starting.value = true; failure.value = ''; try { const { BrowserQRCodeReader } = await import('@zxing/browser'); const next = await new BrowserQRCodeReader().decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video.value!, result => { if (!result || generation !== current) return; const text = result.getText(); if (text === last && Date.now() - lastAt < 3000) return; last = text; lastAt = Date.now(); emit('scan', text); }); if (current !== generation) next.stop(); else { controls = next; active.value = true; } } catch { failure.value = '摄像头暂时无法使用，可输入标签编号或上传二维码照片。'; } finally { if (current === generation) starting.value = false; } }
async function photo(e: Event) { const input = e.target as HTMLInputElement, file = input.files?.[0]; if (!file) return; const url = URL.createObjectURL(file); try { const { BrowserQRCodeReader } = await import('@zxing/browser'); const result = await new BrowserQRCodeReader().decodeFromImageUrl(url); emit('scan', result.getText()); failure.value = ''; } catch { failure.value = '没有识别到清晰的二维码，请重拍或输入编号。'; } finally { URL.revokeObjectURL(url); input.value = ''; } }
onBeforeUnmount(stop);
</script>
<template><div class="space-y-3"><video v-show="active || starting" ref="video" class="w-full max-h-64 rounded-lg bg-black" playsinline muted aria-label="二维码扫描画面" /><div class="flex flex-wrap gap-3"><Button v-if="!active" :loading="starting" @click="start">开启摄像头扫码</Button><Button v-else @click="stop">停止扫码</Button><label class="inline-flex cursor-pointer items-center text-sm underline">识别二维码照片<input class="sr-only" type="file" accept="image/*" capture="environment" @change="photo" /></label></div><div class="flex gap-2"><Input v-model="manual" label="标签编号或本站标签链接" hide-label placeholder="P-物品编号 / D-单据编号" class="flex-1" @enter="emit('scan',manual)" /><Button @click="emit('scan',manual)">加入</Button></div><Notice v-if="failure">{{ failure }}</Notice></div></template>
