<template>
  <section class="page" data-module="flyash">
    <header class="page-head">
      <div>
        <h2>飞灰固化处置管理</h2>
        <p class="page-desc">待检测批次可整组勾选、逐条定结论后一次落表；用量没填全的会被挡回待固化，回报里逐条写明白。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记飞灰固化批次</button>
        <button class="btn" type="button" @click="exportRows">导出飞灰固化处置清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.tone">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="rivalNotice" class="rival-banner">
      检测到别的班组刚改过飞灰固化数据，列表已按最新版本刷新；本组勾选未提交的请核对后再报。
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="selectedIds.length > 0" class="batch-bar">
      <div class="batch-info">
        已勾选 <strong>{{ selectedIds.length }}</strong> 条待检测批次
      </div>
      <div class="batch-tools">
        <button class="btn" type="button" @click="fillConclusions('合格')">整组填：合格</button>
        <button class="btn" type="button" @click="fillConclusions('不合格')">整组填：不合格</button>
        <label class="team-item">
          <span>检测班组</span>
          <input v-model="team" list="flyash-team-options" placeholder="如：甲班" />
          <datalist id="flyash-team-options">
            <option value="甲班"></option>
            <option value="乙班"></option>
            <option value="丙班"></option>
          </datalist>
        </label>
        <button class="btn primary" type="button" @click="submitGroup">整组确认检测</button>
        <button class="btn ghost" type="button" @click="clearSelection">取消勾选</button>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="pick-col">
            <input
              type="checkbox"
              :checked="allEligiblePicked"
              :disabled="eligibleRows.length === 0"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>本次检测结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-picked': selected.has(Number(row.id)) }">
          <td class="pick-col">
            <input
              v-if="isEligible(row)"
              type="checkbox"
              :checked="selected.has(Number(row.id))"
              @change="toggleOne(row)"
            />
            <span v-else class="pick-disabled" title="只有「固化中（待检测）」的批次能整组检测">—</span>
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>
            <select
              v-if="isEligible(row)"
              v-model="conclusions[Number(row.id)]"
              :disabled="!selected.has(Number(row.id))"
            >
              <option value="合格">合格</option>
              <option value="不合格">不合格</option>
            </select>
            <span v-else>—</span>
          </td>
          <td>
            <span class="status-tag" :data-status="row.status">{{ row.status }}</span>
            <span v-if="isEligible(row)" class="tag-pending">待检测</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无飞灰固化处置数据，可先登记飞灰固化批次</td>
        </tr>
      </tbody>
    </table>

    <div v-if="report" class="report-panel">
      <header class="report-head">
        <strong>整组检测回报</strong>
        <button class="link" type="button" @click="report = null">收起</button>
      </header>
      <p :class="report.conflict ? 'report-conflict' : 'report-summary'">{{ report.message }}</p>
      <template v-if="!report.conflict">
        <section v-if="report.accepted.length" class="report-section ok">
          <h4>判成「已检测」（{{ report.accepted.length }} 条）</h4>
          <ul>
            <li v-for="item in report.accepted" :key="item.code">
              <strong>{{ item.code }}</strong>：{{ item.reason }}
            </li>
          </ul>
        </section>
        <section v-if="report.rework.length" class="report-section rework">
          <h4>判成「需返工」（{{ report.rework.length }} 条，已计入运营概览待返工批次）</h4>
          <ul>
            <li v-for="item in report.rework" :key="item.code">
              <strong>{{ item.code }}</strong>：{{ item.reason }}
            </li>
          </ul>
        </section>
        <section v-if="report.blocked.length" class="report-section blocked">
          <h4>被挡在外（{{ report.blocked.length }} 条，仍留在待固化/原队列，没有无声消失）</h4>
          <ul>
            <li v-for="item in report.blocked" :key="item.code">
              <strong>{{ item.code }}</strong>：{{ item.reason }}
            </li>
          </ul>
        </section>
        <section v-if="report.duplicate.length" class="report-section duplicate">
          <h4>重报只算一次（{{ report.duplicate.length }} 条）</h4>
          <ul>
            <li v-for="item in report.duplicate" :key="item.code">
              <strong>{{ item.code }}</strong>：{{ item.reason }}
            </li>
          </ul>
        </section>
        <section v-if="report.notfound.length" class="report-section duplicate">
          <h4>查无此批次（{{ report.notfound.length }} 条）</h4>
          <ul>
            <li v-for="item in report.notfound" :key="item.code">
              <strong>{{ item.code }}</strong>：{{ item.reason }}
            </li>
          </ul>
        </section>
        <p v-if="report.reviewIds.length" class="report-review">
          检测结论已同步到环保监控「待复核」清单：{{ report.reviewIds.join('、') }}
        </p>
      </template>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条飞灰固化处置记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  groupInspectFlyash,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, FlyashGroupResult } from '@/data/types'

const meta = moduleMeta('flyash')
const columns = ["固化编号", "飞灰来源", "螯合剂用量", "水泥用量", "固化块批次", "检测结果", "操作人员", "固化状态"]
const actions = ["提交固化", "确认检测", "要求返工"]
const statuses = ["待固化", "固化中", "已检测", "需返工"]
const STATUS_PENDING_INSPECT = '固化中'

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const rivalNotice = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const selected = ref<Set<number>>(new Set())
// 每条待检测批次一条结论：合格判已检测、不合格判需返工。
const conclusions = ref<Record<number, '合格' | '不合格'>>({})
const team = ref('白班')
const report = ref<FlyashGroupResult | null>(null)

const stats = computed(() => {
  const count = (status: string) => rows.value.filter((row) => String(row.status) === status).length
  return [
    { label: '待固化批次', value: count('待固化'), tone: '' },
    { label: '待检测（固化中）', value: count(STATUS_PENDING_INSPECT), tone: 'tone-pending' },
    { label: '需返工批次', value: count('需返工'), tone: 'tone-rework' },
    { label: '已检测批次', value: count('已检测'), tone: 'tone-done' },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const eligibleRows = computed(() => rows.value.filter((row) => isEligible(row)))
const selectedIds = computed(() => [...selected.value].sort((a, b) => a - b))
const allEligiblePicked = computed(
  () => eligibleRows.value.length > 0 && eligibleRows.value.every((row) => selected.value.has(Number(row.id))),
)

function isEligible(row: EntryRow): boolean {
  // 只有固化中（成型后等检测）的批次进整组检测；已检测的不许撤回，待固化的先补齐再报。
  return String(row.status) === STATUS_PENDING_INSPECT
}

function toggleOne(row: EntryRow) {
  const id = Number(row.id)
  const next = new Set(selected.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
    if (!conclusions.value[id]) {
      conclusions.value[id] = '合格'
    }
  }
  selected.value = next
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selected.value = new Set(checked ? eligibleRows.value.map((row) => Number(row.id)) : [])
  if (checked) {
    for (const row of eligibleRows.value) {
      const id = Number(row.id)
      if (!conclusions.value[id]) {
        conclusions.value[id] = '合格'
      }
    }
  }
}

function fillConclusions(conclusion: '合格' | '不合格') {
  const next = { ...conclusions.value }
  for (const id of selected.value) {
    next[id] = conclusion
  }
  conclusions.value = next
}

function clearSelection() {
  selected.value = new Set()
}

function submitGroup() {
  errorMessage.value = ''
  const items = rows.value
    .filter((row) => selected.value.has(Number(row.id)) && isEligible(row))
    .map((row) => ({
      code: String(row['固化编号'] ?? ''),
      conclusion: conclusions.value[Number(row.id)] ?? ('合格' as const),
    }))
  const result = groupInspectFlyash(items, team.value)
  report.value = result
  if (!result.ok && !result.conflict) {
    errorMessage.value = result.message
    return
  }
  if (result.conflict) {
    errorMessage.value = result.message
  }
  clearSelection()
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '飞灰固化批次登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 被别的班组抢先改掉的批次可能已不在待检测，勾选项里顺手剔掉。
    const liveIds = new Set(rows.value.filter(isEligible).map((row) => Number(row.id)))
    const pruned = new Set([...selected.value].filter((id) => liveIds.has(id)))
    if (pruned.size !== selected.value.size) {
      selected.value = pruned
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '飞灰固化处置列表读取失败'
  }
}

// 另一个班组在别的标签页落表：只有飞灰表真的变了才提示，并按最新版本重读，
// 不拿旧勾选去覆盖先入库的结论。
function handleStorage(event: StorageEvent) {
  if (!event.key || !event.key.includes('waste-to-energy-plant:entries') || !event.newValue) {
    return
  }
  let changed = false
  try {
    const next = JSON.parse(event.newValue) as { flyash?: EntryRow[] }
    changed = JSON.stringify(next.flyash ?? []) !== JSON.stringify(rows.value)
  } catch {
    changed = true
  }
  if (changed) {
    rivalNotice.value = true
    reload()
    window.setTimeout(() => {
      rivalNotice.value = false
    }, 6000)
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', handleStorage)
})
onUnmounted(() => {
  window.removeEventListener('storage', handleStorage)
})
</script>
