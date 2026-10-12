<script setup lang="ts">
import { inject, type Ref } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Disclosure from '@/components/ui/Disclosure.vue';
import Icon from '@/components/ui/Icon.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import type { ImportTaskView } from '@/api';
import { aiSuggestionKey } from '@canglin/shared';
import { importTaskKey } from './useImportTask';

/**
 * 草稿（双栏右侧）：单据头与明细表、识别依据与 AI 建议、未采用的候选行。
 * 编辑直接写上下文里的 form / lines / reviewedAi，由 useImportTask() 的自动保存 watch 接手。
 */

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportDraftEditor 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { mobileTab, fields, labels, form, loaded, lines, selected, stackedLabel, suggestions, reviewedAi } = ctx;
const { line, focusLine, needsReview, localValue, applyLocal, suggestion, apply, acknowledge, addSuggestion } = ctx;
/** 只在 ImportView 的 v-else-if="task" 里渲染：task 变回 null 时父组件先更新、卸载本组件，所以收窄为非空 */
const task = ctx.task as Ref<ImportTaskView>;
</script>

<template>
  <!-- 草稿：单据头 + 明细表（fieldset 在已确认时整体只读） -->
  <fieldset
    :disabled="task.confirmed"
    :class="[mobileTab === 'draft' ? 'block' : 'hidden', 'min-w-0 space-y-4 lg:block']"
  >
    <section class="card p-5">
      <div class="grid gap-4 sm:grid-cols-2">
        <div v-for="f in fields" :key="f" class="min-w-0">
          <Input
            :label="labels[f]"
            v-model="form[f]"
            :type="f === 'requestDate' ? 'date' : 'text'"
            :disabled="task.confirmed"
          /><template v-for="p in task.aiResult" :key="p.page"
            ><Button
              v-if="p[f] && p[f] !== form[f]"
              variant="link"
              class="mt-1.5 mr-3 text-left text-xs items-start"
              @click="form[f] = p[f]!"
            >
              <Icon name="sparkles" :size="12" class="mt-[3px] shrink-0" />采用 AI：{{
                p[f]
              }}
            </Button></template
          >
        </div>
      </div>
    </section>

    <!--
      明细表：面板够宽（≥ 36rem）时是表格，窄时（手机、1280 以下的双栏）每条明细堆叠成
      「品名与规格 / 数量·单位」两行。数量、单位的 Input 用 hideLabel（label 只留给读屏），
      堆叠时列头不在，另显示一行 aria-hidden 的字段名（stackedLabel）。
      导入不收集单价和采购链接：成交价格与链接在申请详情「登记采购」时按实际成交填写。
    -->
    <section class="card @container divide-y divide-line overflow-hidden">
      <div v-if="!loaded" class="space-y-2.5 p-4">
        <Skeleton class="h-8 w-full" />
        <Skeleton class="h-8 w-4/5" />
        <Skeleton class="h-8 w-3/5" />
      </div>
      <table v-else-if="lines.length" class="table-base table-fixed @max-xl:block">
        <thead class="@max-xl:hidden">
          <tr>
            <th class="pl-4 pr-1.5">品名</th>
            <th class="w-28 px-1.5">数量</th>
            <th class="w-20 pl-1.5 pr-4">单位</th>
          </tr>
        </thead>
        <tbody
          v-for="(l, i) in lines"
          :key="l.lineId"
          class="transition-colors duration-150 @max-xl:block"
          :class="[
            i > 0 ? 'border-t border-line' : '',
            selected === l.lineId ? 'bg-primary-soft' : '',
          ]"
          @focusin="focusLine(l)"
        >
          <tr
            class="[&:hover]:bg-transparent @max-xl:grid @max-xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)] @max-xl:gap-2 @max-xl:px-4 @max-xl:pt-3"
          >
            <td class="border-b-0 pb-2 pl-4 pr-1.5 pt-3 @max-xl:col-span-2 @max-xl:p-0">
              <Input
                v-model="l.itemName"
                size="sm"
                placeholder="品名（同名不同规格请明确区分）"
                :title="l.source?.rawText && l.source.rawText !== l.itemName ? `原文：${l.source.rawText}` : undefined"
              />
              <Input v-model="l.spec" size="sm" label="规格" hide-label placeholder="规格（可空）" class="mt-1.5" />
            </td>
            <td class="border-b-0 px-1.5 pb-2 pt-3 @max-xl:p-0">
              <span aria-hidden="true" :class="stackedLabel">数量</span>
              <Input
                v-model="l.quantity"
                size="sm"
                label="数量"
                hide-label
                type="number"
                step="any"
                placeholder="数量：待确认"
              />
            </td>
            <td class="border-b-0 pb-2 pl-1.5 pr-4 pt-3 @max-xl:p-0">
              <span aria-hidden="true" :class="stackedLabel">单位</span>
              <Input v-model="l.unit" size="sm" label="单位" hide-label placeholder="单位" />
            </td>
          </tr>
          <tr class="[&:hover]:bg-transparent @max-xl:block">
            <td colspan="3" class="px-4 pb-3 pt-0 @max-xl:block @max-xl:pt-2.5">
              <!-- 左：定位按钮与提示（可换行）；右：删除固定在行首右侧 -->
              <div class="flex items-start gap-2">
                <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 py-1">
                  <Button variant="link" class="mr-1 h-6 text-xs font-medium" @click="focusLine(l)">
                    <Icon name="scan" :size="13" class="shrink-0" />明细 {{ i + 1 }} ·
                    {{ l.source ? `第 ${l.source.page} 页` : '人工录入／历史结果' }}
                  </Button>
                  <Badge v-if="!l.quantity || Number(l.quantity) <= 0" tone="amber" dot
                    >数量未确认，暂不能入账。</Badge
                  >
                  <Badge
                    v-if="lines.some((o, j) => j !== i && o.itemName === l.itemName)"
                    tone="amber"
                    >请核对同名明细的规格。</Badge
                  >
                </div>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  :disabled="task.confirmed"
                  @click="lines.splice(i, 1)"
                  ><Icon name="trash" :size="14" />删除</Button
                >
              </div>
              <Notice v-if="needsReview(l)" variant="inline" size="sm" class="mt-2">
                AI 建议的品名、规格、单位或数量与首次识别结果不同，请展开建议核对。
              </Notice>
              <Disclosure
                class="mt-2 rounded-(--radius-control) bg-surface-2"
                summary="识别依据与 AI 建议"
                summary-class="rounded-(--radius-control) px-3 py-2 text-xs font-medium text-muted hover:text-ink"
              >
                <div class="space-y-3 px-3 pb-3 text-xs leading-5 text-muted">
                  <p class="break-all">原始文本：{{ l.source?.rawText || '无可信文本来源' }}</p>
                  <div v-if="localValue(l)" class="space-y-2 border-t border-line pt-3">
                    <p>
                      首次识别：<span class="text-text">{{ localValue(l)!.itemName }}</span> · 数量
                      {{ localValue(l)!.quantity ?? '未知' }}{{ localValue(l)!.unit ?? '' }}
                    </p>
                    <Button size="sm" variant="secondary" @click="applyLocal(l)"
                      >核对后采用首次识别值</Button
                    >
                  </div>
                  <div v-if="suggestion(l)" class="space-y-2 border-t border-line pt-3">
                    <p>
                      AI：<span class="text-text">{{ suggestion(l)!.itemName }}</span
                      ><template v-if="suggestion(l)!.spec">（{{ suggestion(l)!.spec }}）</template>，数量
                      {{ suggestion(l)!.quantity ?? '未知' }}{{ suggestion(l)!.unit ?? '' }}
                    </p>
                    <p v-if="suggestion(l)!.rawText && suggestion(l)!.rawText !== suggestion(l)!.itemName" class="break-all">
                      AI 读到的原文：{{ suggestion(l)!.rawText }}
                    </p>
                    <p
                      v-if="!reviewedAi.includes(aiSuggestionKey(suggestion(l)!))"
                      class="text-amber"
                    >
                      建议待确认：可采用建议，或核对后保留当前编辑值。
                    </p>
                    <p v-else class="text-teal">本次建议已核对</p>
                    <div class="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" @click="apply(l)"
                        >已核对，采用建议</Button
                      ><Button size="sm" variant="ghost" @click="acknowledge(suggestion(l)!)"
                        >已核对，保留当前值</Button
                      >
                    </div>
                  </div>
                </div>
              </Disclosure>
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-for="candidate in task.result?.items.filter(
          (item) => !lines.some((l) => l.lineId === item.lineId),
        ) ?? []"
        :key="candidate.lineId"
        class="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-2 px-4 py-3 text-[13px] text-muted"
      >
        <p class="flex min-w-0 flex-1 basis-60 items-start gap-2">
          <Icon name="scan" :size="15" class="mt-0.5 shrink-0 text-faint" />
          <span
            >未采用的本地明细：<span class="text-ink">{{ candidate.itemName }}</span> ×
            <span class="num">{{ candidate.quantity ?? '待确认' }}</span></span
          >
        </p>
        <Button size="sm" variant="secondary" @click="lines.push(line(candidate))"
          >核对后添加本地明细</Button
        >
      </div>
      <div
        v-for="s in suggestions.filter(
          (s) =>
            !lines.some((l) => l.lineId === s.lineId) &&
            !reviewedAi.includes(aiSuggestionKey(s)),
        )"
        :key="s.lineId ?? s.itemName"
        class="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-2 px-4 py-3 text-[13px] text-muted"
      >
        <p class="flex min-w-0 flex-1 basis-60 items-start gap-2">
          <Icon name="sparkles" :size="15" class="mt-0.5 shrink-0 text-faint" />
          <span
            >AI 新增候选：<span class="text-ink">{{ s.itemName }}</span> ×
            <span class="num">{{ s.quantity ?? '待确认' }}</span>（第 {{ s.page }} 页）</span
          >
        </p>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" @click="addSuggestion(s)">核对后添加</Button
          ><Button size="sm" variant="ghost" @click="acknowledge(s)"
            >核对后不采用此行</Button
          >
        </div>
      </div>
      <div class="px-4 py-3">
        <Button
          size="sm"
          variant="secondary"
          :disabled="!loaded || task.confirmed"
          @click="lines.push(line())"
          ><Icon name="plus" :size="14" />添加明细</Button
        >
      </div>
    </section>
  </fieldset>
</template>
