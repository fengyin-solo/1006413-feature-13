import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, refreshRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// ---- 飞灰固化整组处置 ----
// 多选待固化批次，整组判定检测结论：合格 → 已检测，不合格 → 需返工。
// 逐条回报结果；被挡的留在待固化不消失，已落表的不因同组有失败而撤回。

export type FlyashSettleOutcome = 'accepted' | 'blocked' | 'skipped'

export type FlyashSettleItem = {
  id: number
  code: string
  outcome: FlyashSettleOutcome
  message: string
}

export type FlyashSettleResult = {
  ok: boolean
  items: FlyashSettleItem[]
  message: string
}

const FLYASH_KEY = 'flyash'
const EMISSION_KEY = 'emission'
// 整组落表前这两项必须都填了，缺任何一项都挡在待固化里。
const FLYASH_REQUIRED_FIELDS = ['螯合剂用量', '水泥用量']

export function settleFlyashGroup(ids: number[], decision: '合格' | '不合格'): FlyashSettleResult {
  const target = decision === '合格' ? '已检测' : '需返工'
  // 两个班组抢同一批时，以落表这一刻读到的入库版本为准，先入库的说了算。
  refreshRows()
  const rows = listRows(FLYASH_KEY)
  const next = [...rows]
  const items: FlyashSettleItem[] = []
  const accepted: EntryRow[] = []
  const seenCodes = new Set<string>()

  for (const id of [...new Set(ids)]) {
    const index = next.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      items.push({ id, code: String(id), outcome: 'skipped', message: `记录 ${id}：没有找到这条飞灰固化批次` })
      continue
    }
    const row = next[index]
    const code = String(row['固化编号'] ?? id)
    // 同一条固化编号重报只算一次：同组里重复勾选的直接跳过。
    if (seenCodes.has(code)) {
      items.push({ id, code, outcome: 'skipped', message: `${code}：同一固化编号重复提交，只算一次` })
      continue
    }
    seenCodes.add(code)
    const current = String(row.status)
    if (current !== '待固化') {
      items.push({
        id,
        code,
        outcome: 'skipped',
        message: `${code}：当前已是「${current}」，先入库的那一版说了算，本次不再重复处置`,
      })
      continue
    }
    const missing = FLYASH_REQUIRED_FIELDS.filter((field) => String(row[field] ?? '').trim() === '')
    if (missing.length > 0) {
      items.push({
        id,
        code,
        outcome: 'blocked',
        message: `${code}：${missing.join('、')}没填全，被挡在整组处置之外，仍旧留在待固化`,
      })
      continue
    }
    next[index] = {
      ...row,
      status: target,
      pending: target !== '已检测',
      abnormal: target === '需返工',
      检测结果: `检测${decision}`,
      固化状态: target,
    }
    accepted.push(next[index])
    items.push({ id, code, outcome: 'accepted', message: `${code}：检测${decision}，已判为「${target}」` })
  }

  if (accepted.length > 0) {
    saveRows(FLYASH_KEY, next)
    appendEmissionReviews(accepted, decision)
  }
  const done = items.filter((item) => item.outcome === 'accepted').length
  const blocked = items.filter((item) => item.outcome === 'blocked').length
  const skipped = items.length - done - blocked
  return {
    ok: done > 0,
    items,
    message: `整组处置完成：${done} 条判为「${target}」，${blocked} 条被挡留在待固化，${skipped} 条跳过`,
  }
}

// 检测结论同步落到环保监控的待复核清单：每条批次一条待复核记录，同一固化编号只落一条。
function appendEmissionReviews(accepted: EntryRow[], decision: string): void {
  const rows = listRows(EMISSION_KEY)
  const next = [...rows]
  let maxId = next.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const today = new Date().toISOString().slice(0, 10)
  for (const batch of accepted) {
    const code = String(batch['固化编号'])
    const exists = next.some(
      (row) => row['来源模块'] === FLYASH_KEY && String(row['固化编号']) === code,
    )
    if (exists) {
      continue
    }
    maxId += 1
    next.push({
      id: maxId,
      status: '待监控',
      pending: true,
      abnormal: decision === '不合格',
      监控编号: `EMIS-${String(maxId).padStart(4, '0')}`,
      监控指标: '飞灰固化块检测',
      限值要求: '固化块浸出毒性符合 GB 16889',
      实测值: `检测${decision}`,
      达标判定: decision === '合格' ? '达标' : '未达标',
      监控日期: today,
      监控人员: String(batch['操作人员'] ?? '—'),
      监控状态: '待复核',
      来源模块: FLYASH_KEY,
      固化编号: code,
      固化块批次: String(batch['固化块批次'] ?? ''),
    })
  }
  saveRows(EMISSION_KEY, next)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    // 飞灰固化块批次的待返工数：整组处置落表后随存储重算。
    { label: '待返工批次', value: (rows[FLYASH_KEY] ?? []).filter((row) => row.status === '需返工').length },
  ]
  return { cards, modules }
}
