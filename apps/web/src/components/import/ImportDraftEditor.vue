<script setup lang="ts">
import { inject, type Ref } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Disclosure from '@/components/ui/Disclosure.vue';
import Icon from '@/components/ui/Icon.vue';
import Combobox from '@/components/ui/Combobox.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import type { ImportTaskView } from '@/api';
import { aiSuggestionKey, isShortLink } from '@canglin/shared';
import { buttonClass } from '@/components/ui/button';
import { webLink } from '@/components/workflow/presentation';
import { importTaskKey } from './useImportTask';
import { useDraftHeaderHints } from './useDraftHeaderHints';

/**
 * 草稿（双栏右侧）：单据头与明细表、识别依据与 AI 建议、未采用的候选行。
 * 编辑直接写上下文里的 form / lines / reviewedAi，由 useImportTask() 的自动保存 watch 接手。
 */

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportDraftEditor 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { mobileTab, fields, labels, form, loaded, lines, selected, stackedLabel, suggestions, reviewedAi } = ctx;
const { line, focusLine, needsReview, localValue, applyLocal, suggestion, apply, acknowledge, addSuggestion } = ctx;
const { catalogMatch, applyCatalog } = ctx;
const { fillUnit, unitEdited, chooseUnit, unitHint, unitSuggestions, linkError, tidyLink } = ctx;
/** 单位来源的小字：自动填的单位要让人一眼看出来，改过就消失 */
const UNIT_SOURCE_LABEL = { CATALOG: '沿用物品库', AI: 'AI 推测' } as const;
/** 单位候选药丸：触屏加高到 40px（DESIGN.md §4） */
const UNIT_CHIP =
  'inline-flex h-6 min-w-7 items-center justify-center rounded-full border border-line bg-surface px-2 text-xs text-text transition-colors duration-150 hover:border-blue hover:text-blue pointer-coarse:h-10 pointer-coarse:px-3.5';
/** 只在 ImportView 的 v-else-if="task" 里渲染：task 变回 null 时父组件先更新、卸载本组件，所以收窄为非空 */
const task = ctx.task as Ref<ImportTaskView>;
/* 单据头的候选与提醒（docs/manual-entry-2026-10.md P6、N6、N7），见 useDraftHeaderHints */
const { headerChoices, headerLike, duplicate, noOaMatches, requestSummary } = useDraftHeaderHints(form, task);

/** 本地 OCR 行最低置信度低于 0.6（与 OCR 服务的告警阈值一致）；文本层与 AI 行没有置信度 */
const lowConfidence = (l: { source?: { confidence?: number | null } | null }) => (l.source?.confidence ?? 1) < 0.6;
</script>

<template>
  <!--
    草稿：单据头 + 明细表。fieldset 在已确认时整体只读；草稿载入前（识别中）也只读：
    载入会整份替换单据头与明细，之前的输入既不会保存也会被覆盖。
  -->
  <fieldset
    :disabled="task.confirmed || !loaded"
    :class="[mobileTab === 'draft' ? 'block' : 'hidden', 'min-w-0 space-y-4 lg:block']"
  >
    <section class="card p-5">
      <Notice v-if="noOaMatches.length" size="sm" class="mb-4" data-no-oa-hint>
        {{ form.handler.trim() }}还有 {{ noOaMatches.length }} 张没有 OA 单号的申请：<template v-for="(row, i) in noOaMatches" :key="row.id"><template v-if="i">、</template><a :href="`/requests/${row.id}`" target="_blank" rel="noopener" :class="buttonClass({ variant: 'link' })">{{ row.serialNumber }}</a>（{{ requestSummary(row) }}）</template>。如果这份 OA 单是给它补办的，打开那张申请补填流水号、上传这份原件，再「放弃草稿」，免得重复入账。
      </Notice>
      <div class="grid gap-4 sm:grid-cols-2">
        <div v-for="f in fields" :key="f" class="min-w-0">
          <Combobox
            v-if="f === 'department' || f === 'handler'"
            :label="labels[f]"
            :model-value="form[f]"
            :options="headerChoices[f]"
            :disabled="task.confirmed || !loaded"
            :empty-text="f === 'department' ? '还没有用过的部门，直接填写' : '还没有用过的经办人，直接填写'"
            @update:model-value="form[f] = $event"
          />
          <Input
            v-else
            :label="labels[f]"
            v-model="form[f]"
            :type="f === 'requestDate' ? 'date' : 'text'"
            :disabled="task.confirmed || !loaded"
          /><Button
            v-if="headerLike(f)"
            variant="link"
            class="mt-1.5 mr-3 text-left text-xs"
            @click="form[f] = headerLike(f)!"
          >是不是「{{ headerLike(f) }}」？</Button><template v-for="p in task.aiResult" :key="p.page"
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
      <Notice v-if="duplicate" variant="inline" class="mt-3" data-duplicate-serial>
        已有申请用了这个流水号：{{ duplicate.department }} · {{ duplicate.handler }} · <span class="num">{{ duplicate.requestDate }}</span> · {{ duplicate.lines.length }} 条明细
        <template #actions><a :href="`/requests/${duplicate.id}`" target="_blank" rel="noopener" :class="buttonClass({ variant: 'link' })">查看</a></template>
      </Notice>
    </section>

    <!--
      明细表：面板够宽（≥ 36rem）时是表格，窄时（手机、1280 以下的双栏）每条明细堆叠成
      「品名、规格与链接 / 数量·单位」两行。数量、单位的 Input 用 hideLabel（label 只留给读屏），
      堆叠时列头不在，另显示一行 aria-hidden 的字段名（stackedLabel）。
      导入不收集单价：成交价格在申请详情「登记采购」时按实际成交填写；原件上的采购链接随明细入账，登记采购时预填。
      单位为空时自动填（物品库 > AI 推测），输入框下方标出来源；下方一行给一键候选（docs/import-units-links-2026-10.md U1–U4）。
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
            <th scope="col" class="pl-4 pr-1.5">品名</th>
            <th scope="col" class="w-28 px-1.5">数量</th>
            <th scope="col" class="w-20 pl-1.5 pr-4">单位</th>
          </tr>
        </thead>
        <tbody
          v-for="(l, i) in lines"
          :key="l.lineId"
          class="transition-colors duration-150 @max-xl:block"
          :class="[
            i > 0 ? 'border-t border-line' : '',
            selected === l.lineId ? 'bg-primary-soft' : lowConfidence(l) ? 'bg-amber-soft/50' : '',
          ]"
          @focusin="focusLine(l)"
        >
          <tr
            class="[&:hover]:bg-transparent @max-xl:grid @max-xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)] @max-xl:gap-2 @max-xl:px-4 @max-xl:pt-3"
          >
            <td class="border-b-0 pb-2 pl-4 pr-1.5 pt-3 @max-xl:col-span-2 @max-xl:p-0">
              <!-- 可访问名称带行号（「第 N 行品名 / 规格 / 数量 / 单位」）：每行同名时读屏分不清是哪一行 -->
              <Input
                v-model="l.itemName"
                size="sm"
                :label="`第 ${i + 1} 行品名`"
                hide-label
                placeholder="品名（同名不同规格请明确区分）"
                :title="l.source?.rawText && l.source.rawText !== l.itemName ? `原文：${l.source.rawText}` : undefined"
                @blur="fillUnit(l)"
              />
              <Input v-model="l.spec" size="sm" :label="`第 ${i + 1} 行规格`" hide-label placeholder="规格（可空）" class="mt-1.5" @blur="fillUnit(l)" />
              <div class="mt-1.5 flex items-start gap-1">
                <Input
                  v-model="l.purchaseLink"
                  size="sm"
                  :label="`第 ${i + 1} 行采购链接`"
                  hide-label
                  placeholder="采购链接（可空）"
                  :error="linkError(l)"
                  class="min-w-0 flex-1"
                  @blur="tidyLink(l)"
                />
                <a
                  v-if="webLink(l.purchaseLink)"
                  :href="webLink(l.purchaseLink)"
                  target="_blank"
                  rel="noopener"
                  :class="buttonClass({ variant: 'ghost', size: 'sm', iconOnly: true })"
                  :aria-label="`打开第 ${i + 1} 行采购链接`"
                  title="在新标签页打开"
                  ><Icon name="arrow-up-right" :size="14"
                /></a>
              </div>
            </td>
            <td class="border-b-0 px-1.5 pb-2 pt-3 @max-xl:p-0">
              <span aria-hidden="true" :class="stackedLabel">数量</span>
              <Input
                v-model="l.quantity"
                size="sm"
                :label="`第 ${i + 1} 行数量`"
                hide-label
                type="number"
                step="any"
                placeholder="数量：待确认"
              />
            </td>
            <td class="border-b-0 pb-2 pl-1.5 pr-4 pt-3 @max-xl:p-0">
              <span aria-hidden="true" :class="stackedLabel">单位</span>
              <Input
                v-model="l.unit"
                size="sm"
                :label="`第 ${i + 1} 行单位`"
                hide-label
                placeholder="单位"
                :suggestions="unitSuggestions(l)"
                class="[&_input::-webkit-calendar-picker-indicator]:hidden"
                @update:model-value="unitEdited(l)"
              />
              <span v-if="l.unit && l.unitSource" class="mt-1 block text-[11.5px] leading-4 text-muted" :data-unit-source="l.unitSource">{{
                UNIT_SOURCE_LABEL[l.unitSource]
              }}</span>
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
                  <Badge v-if="lowConfidence(l)" tone="amber">识别置信度低，请对照原件。</Badge>
                  <Badge v-if="isShortLink(l.purchaseLink)" tone="amber">短链接容易失效，建议换成商品页地址。</Badge>
                  <span v-if="unitHint(l)" class="inline-flex flex-wrap items-center gap-1 text-xs text-muted">
                    {{ unitHint(l)!.label }}
                    <button
                      v-for="u in unitHint(l)!.units"
                      :key="u"
                      type="button"
                      :class="UNIT_CHIP"
                      :disabled="task.confirmed"
                      :aria-label="`第 ${i + 1} 行单位填「${u}」`"
                      @click="chooseUnit(l, u)"
                    >
                      {{ u }}
                    </button>
                  </span>
                </div>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  :disabled="task.confirmed"
                  :aria-label="`删除第 ${i + 1} 行`"
                  @click="lines.splice(i, 1)"
                  ><Icon name="trash" :size="14" />删除</Button
                >
              </div>
              <Notice v-if="needsReview(l)" variant="inline" size="sm" class="mt-2">
                AI 建议的品名、规格、单位或数量与首次识别结果不同，请展开建议核对。
              </Notice>
              <div
                v-if="catalogMatch(l)"
                class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs leading-5 text-muted"
              >
                <span class="flex min-w-0 items-start gap-1.5">
                  <Icon name="sparkles" :size="13" class="mt-[3px] shrink-0" />
                  <span
                    >匹配到已有物品：<span class="text-text">{{ catalogMatch(l)!.name }}</span
                    ><template v-if="catalogMatch(l)!.spec">（{{ catalogMatch(l)!.spec }}）</template
                    ><template v-if="catalogMatch(l)!.unit"> · {{ catalogMatch(l)!.unit }}</template></span
                  >
                </span>
                <Button size="sm" variant="secondary" @click="applyCatalog(l)">采用已有物品</Button>
              </div>
              <Disclosure
                class="mt-2 rounded-(--radius-control) bg-surface-2"
                summary="识别依据与 AI 建议"
                summary-class="rounded-(--radius-control) px-3 py-2 text-xs font-medium text-muted hover:text-ink"
              >
                <div class="space-y-3 px-3 pb-3 text-xs leading-5 text-muted">
                  <p class="break-all">原始文本：{{ l.source?.rawText || '无可信文本来源' }}</p>
                  <p v-if="localValue(l)?.purchaseLink" class="break-all">原件链接：{{ localValue(l)!.purchaseLink }}</p>
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
                      {{ suggestion(l)!.quantity ?? '未知' }}{{ suggestion(l)!.unit ?? ''
                      }}<template v-if="!suggestion(l)!.unit && suggestion(l)!.unitGuess">（推测单位：{{ suggestion(l)!.unitGuess }}）</template>
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
