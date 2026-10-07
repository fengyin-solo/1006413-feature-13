<template>
  <section class="page" data-module="emission">
    <header class="page-head">
      <div>
        <h2>环保指标监控管理</h2>
        <p class="page-desc">飞灰固化检测结论落到本页「待复核」清单，环保科逐条复核通过或不通过。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记环保监控记录</button>
        <button class="btn" type="button" @click="exportRows">导出环保指标监控清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-review': String(row.status) === '待复核' }">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td><span class="status-tag" :data-status="row.status">{{ row.status }}</span></td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无环保指标监控数据，可先登记环保监控记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条环保指标监控记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('emission')
const columns = ["监控编号", "监控指标", "限值要求", "实测值", "达标判定", "监控日期", "监控人员", "监控状态"]
const statuses = ["待监控", "监控中", "待复核", "已达标", "未达标"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => {
  const count = (status: string) => rows.value.filter((row) => String(row.status) === status).length
  return [
    { label: '待复核清单', value: count('待复核'), tone: 'tone-pending' },
    { label: '已达标指标', value: count('已达标'), tone: 'tone-done' },
    { label: '未达标指标', value: count('未达标'), tone: 'tone-rework' },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 待复核的只能走复核动作；其它状态保留通用动作，避免页面上全是点不动的按钮。
function availableActions(row: EntryRow): string[] {
  if (String(row.status) === '待复核') {
    return ['复核通过', '复核不通过']
  }
  if (String(row.status) === '待监控') {
    return ['提交监控']
  }
  return ['提交监控', '复核通过', '复核不通过']
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '环保监控记录登记入口尚未接入审批流'
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '环保指标监控列表读取失败'
  }
}

function handleStorage(event: StorageEvent) {
  if (event.key && event.key.includes('waste-to-energy-plant')) {
    reload()
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
