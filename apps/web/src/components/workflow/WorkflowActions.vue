<script setup lang="ts">
import { ref } from 'vue';
import { workflowApi, type WorkflowDocumentRow, type WorkflowRequestRow, type WorkflowStockRow } from '@/api/workflow';
import { useToastStore } from '@/stores/toast';
import PurchaseRegisterDialog from './PurchaseRegisterDialog.vue';
import PurchaseEditDialog from './PurchaseEditDialog.vue';
import ReceiptRegisterDialog from './ReceiptRegisterDialog.vue';
import QuantityCommandDialog, { type QuantityCommand, type QuantityChoice } from './QuantityCommandDialog.vue';
import VoidDocumentDialog from './VoidDocumentDialog.vue';
import WorkflowMetadataDialog from './WorkflowMetadataDialog.vue';
import StockAdjustmentDialog from './StockAdjustmentDialog.vue';
import WorkflowAttachments from './WorkflowAttachments.vue';
import Dialog from '@/components/ui/Dialog.vue';
import DocumentInspectDialog from './DocumentInspectDialog.vue';
import LinkEditDialog, { type LinkTarget } from './LinkEditDialog.vue';
import { apiError } from '@/api/client';

const emit = defineEmits<{ recorded: [document: WorkflowDocumentRow]; attachmentsChanged: []; linkChanged: [] }>();
const toast = useToastStore();
const purchaseOpen = ref(false), purchaseTarget = ref<WorkflowRequestRow | null>(null);
const purchaseEditOpen = ref(false), purchaseEditTarget = ref<WorkflowDocumentRow | null>(null);
const receiptOpen = ref(false), receiptTarget = ref<WorkflowDocumentRow | null>(null);
const commandOpen = ref(false), commandTarget = ref<{ action: QuantityCommand; choices: QuantityChoice[]; context: string; department: string; recipient: string } | null>(null);
const voidOpen = ref(false), voidTarget = ref<WorkflowDocumentRow | null>(null);
const metadataOpen = ref(false), metadataTarget = ref<WorkflowDocumentRow | null>(null);
const adjustmentOpen = ref(false), adjustmentTarget = ref<WorkflowStockRow | null>(null);
const attachmentsOpen = ref(false), attachmentsTarget = ref<WorkflowDocumentRow | null>(null);
const inspectionOpen = ref(false), inspectionTarget = ref<{ documentId?: number; lineId?: number }>({});
const linkOpen = ref(false), linkTarget = ref<LinkTarget | null>(null);

function purchase(request: WorkflowRequestRow) { purchaseTarget.value = request; purchaseOpen.value = true; }
async function editPurchase(document: WorkflowDocumentRow) {
  try {
    const latest = await workflowApi.document(document.id);
    if (latest.purchaseEditReason) { toast.error(latest.purchaseEditReason); return; }
    purchaseEditTarget.value = latest; purchaseEditOpen.value = true;
  } catch (cause) { toast.error(apiError(cause)); }
}
function receipt(document: WorkflowDocumentRow) { receiptTarget.value = document; receiptOpen.value = true; }
/** department / recipient：从申请详情发起时带上申请部门与经办人（直接发放默认发给经办人，docs/manual-entry-2026-10.md P3） */
function command(action: QuantityCommand, choices: QuantityChoice[], context = '', department = '', recipient = '') { commandTarget.value = { action, choices, context, department, recipient }; commandOpen.value = true; }
function voidDocument(document: WorkflowDocumentRow) { voidTarget.value = document; voidOpen.value = true; }
function metadata(document: WorkflowDocumentRow) { metadataTarget.value = document; metadataOpen.value = true; }
function adjust(product: WorkflowStockRow) { adjustmentTarget.value = product; adjustmentOpen.value = true; }
function attachments(document: WorkflowDocumentRow) { attachmentsTarget.value = document; attachmentsOpen.value = true; }
function inspectDocument(documentId: number) { inspectionTarget.value = { documentId }; inspectionOpen.value = true; }
function inspectLine(lineId: number) { inspectionTarget.value = { lineId }; inspectionOpen.value = true; }
/** 更换申请明细或采购明细的链接 */
function editLink(target: LinkTarget) { linkTarget.value = target; linkOpen.value = true; }
function linkSaved() { toast.success('采购链接已更新'); emit('linkChanged'); }
async function refreshAttachments() {
  try {
    if (metadataTarget.value) metadataTarget.value = await workflowApi.document(metadataTarget.value.id);
    if (attachmentsTarget.value) attachmentsTarget.value = await workflowApi.document(attachmentsTarget.value.id);
    emit('attachmentsChanged');
  } catch (cause) { toast.error(apiError(cause)); }
}
function closeAll() { purchaseOpen.value = purchaseEditOpen.value = receiptOpen.value = commandOpen.value = voidOpen.value = metadataOpen.value = adjustmentOpen.value = attachmentsOpen.value = inspectionOpen.value = linkOpen.value = false; }
function recorded(document: WorkflowDocumentRow) { toast.success('业务登记已保存'); emit('recorded', document); }
defineExpose({ purchase, editPurchase, receipt, command, voidDocument, metadata, adjust, attachments, inspectDocument, inspectLine, editLink, closeAll });
</script>

<template>
  <PurchaseRegisterDialog v-if="purchaseTarget" v-model:open="purchaseOpen" :request="purchaseTarget" @recorded="recorded" />
  <PurchaseEditDialog v-if="purchaseEditTarget" v-model:open="purchaseEditOpen" :document="purchaseEditTarget" @recorded="recorded" />
  <ReceiptRegisterDialog v-if="receiptTarget" v-model:open="receiptOpen" :purchase="receiptTarget" @recorded="recorded" />
  <QuantityCommandDialog v-if="commandTarget" v-model:open="commandOpen" :action="commandTarget.action" :choices="commandTarget.choices" :context="commandTarget.context" :department="commandTarget.department" :recipient="commandTarget.recipient" @recorded="recorded" />
  <VoidDocumentDialog v-if="voidTarget" v-model:open="voidOpen" :document="voidTarget" @recorded="recorded" />
  <WorkflowMetadataDialog v-if="metadataTarget" v-model:open="metadataOpen" :document="metadataTarget" @recorded="recorded"><template #attachments><WorkflowAttachments :document-id="metadataTarget.id" :attachments="metadataTarget.attachments" @changed="refreshAttachments" /></template></WorkflowMetadataDialog>
  <StockAdjustmentDialog v-if="adjustmentTarget" v-model:open="adjustmentOpen" :product="adjustmentTarget" @recorded="recorded" />
  <Dialog v-if="attachmentsTarget" :open="attachmentsOpen" title="签收凭证" :description="`领用发放 #${attachmentsTarget.id} · ${attachmentsTarget.date}`" @update:open="attachmentsOpen = $event"><WorkflowAttachments :document-id="attachmentsTarget.id" kind="SIGNOFF" :attachments="attachmentsTarget.attachments" @changed="refreshAttachments" /></Dialog>
  <DocumentInspectDialog :open="inspectionOpen" :document-id="inspectionTarget.documentId" :line-id="inspectionTarget.lineId" @update:open="inspectionOpen = $event" />
  <LinkEditDialog v-if="linkTarget" v-model:open="linkOpen" :target="linkTarget" @saved="linkSaved" />
</template>
