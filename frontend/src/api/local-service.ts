import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  commitRows,
  listRows,
  moduleVersion,
  resetRows,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FlyashGroupDetail,
  FlyashGroupItem,
  FlyashGroupResult,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 飞灰固化整组检测用到的模块键、字段与状态，页面与服务保持同一份口径。
const FLYASH_KEY = 'flyash'
const EMISSION_KEY = 'emission'
const FLYASH_RAW = '待固化' // 还没进料固化，挡回来的批次留在这里
const FLYASH_PENDING_INSPECT = '固化中' // 已成型待检测，整组检测只收这一档
const FLYASH_DONE = '已检测'
const FLYASH_REWORK = '需返工'
const EMISSION_REVIEW = '待复核'
const FIELD_CODE = '固化编号'
const FIELD_CHELATOR = '螯合剂用量'
const FIELD_CEMENT = '水泥用量'
const FIELD_BLOCK = '固化块批次'
const FIELD_RESULT = '检测结果'
const FIELD_FLOW_STATUS = '固化状态'

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
  // 终态由各模块显式登记：环保监控的「已达标/未达标」都算处理完，不能只看状态顺序。
  const terminalStatuses: Record<string, string[]> = {
    [EMISSION_KEY]: ['已达标', '未达标'],
  }
  const terminal = terminalStatuses[key] ?? [meta.statuses[meta.statuses.length - 1]]
  const abnormalStatuses: Record<string, string[]> = {
    [FLYASH_KEY]: [FLYASH_REWORK],
    [EMISSION_KEY]: ['未达标'],
  }
  const abnormal = abnormalStatuses[key]?.includes(target)
    ?? NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !terminal.includes(target),
    abnormal,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function isFilled(value: string | number | boolean | undefined): boolean {
  return String(value ?? '').trim() !== ''
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function emptyGroupResult(message: string): FlyashGroupResult {
  return {
    ok: false,
    conflict: false,
    message,
    accepted: [],
    rework: [],
    blocked: [],
    duplicate: [],
    notfound: [],
    reviewIds: [],
  }
}

// 飞灰固化整组检测：
// - 只收「固化中（待检测）」的批次；螯合剂用量、水泥用量没填全的整组挡回「待固化」，绝不无声消失；
// - 检测结论合格判「已检测」，不合格判「需返工」，逐条回报；
// - 同一固化编号重报只算一次；已经收下的不允许整组撤回；
// - 结论同步落进环保监控「待复核」清单；
// - 两个班组抢同一批时按版本号做乐观锁，先入库的那一版说了算。
export function groupInspectFlyash(
  rawItems: FlyashGroupItem[],
  team: string,
): FlyashGroupResult {
  const items = rawItems.map((item) => ({
    code: String(item.code ?? '').trim(),
    conclusion: item.conclusion,
  }))
  if (items.length === 0) {
    return emptyGroupResult('请先勾选要整组检测的待检测批次')
  }
  const operator = team.trim() || '当班班组'
  const inspectTime = nowText()
  const inspectDate = inspectTime.slice(0, 10)

  // 读表同时记住版本号，落表前若被别的班组改过，整组拒收。
  const flyashRows = listRows(FLYASH_KEY)
  const flyashVersion = moduleVersion(FLYASH_KEY)
  const rowByCode = new Map<string, EntryRow>()
  for (const row of flyashRows) {
    rowByCode.set(String(row[FIELD_CODE] ?? ''), row)
  }

  const accepted: FlyashGroupDetail[] = []
  const rework: FlyashGroupDetail[] = []
  const blocked: FlyashGroupDetail[] = []
  const duplicate: FlyashGroupDetail[] = []
  const notfound: FlyashGroupDetail[] = []
  const seen = new Set<string>()

  for (const item of items) {
    if (!item.code) {
      notfound.push({
        code: '（空编号）',
        conclusion: item.conclusion,
        outcome: 'notfound',
        fromStatus: '—',
        toStatus: '—',
        reason: '固化编号为空，无法落表',
      })
      continue
    }
    // 同一批里同一条固化编号重报：只按第一次结论算。
    if (seen.has(item.code)) {
      duplicate.push({
        code: item.code,
        conclusion: item.conclusion,
        outcome: 'duplicate',
        fromStatus: '—',
        toStatus: '—',
        reason: '同一固化编号在本组内重复上报，只算第一次，本条忽略',
      })
      continue
    }
    seen.add(item.code)

    const row = rowByCode.get(item.code)
    if (!row) {
      notfound.push({
        code: item.code,
        conclusion: item.conclusion,
        outcome: 'notfound',
        fromStatus: '—',
        toStatus: '—',
        reason: '找不到这条飞灰固化批次，未做任何改动',
      })
      continue
    }
    const fromStatus = String(row.status)

    // 已经收下（已检测）的不许借重报改结论，也不许整组撤回。
    if (fromStatus === FLYASH_DONE) {
      duplicate.push({
        code: item.code,
        conclusion: item.conclusion,
        outcome: 'duplicate',
        fromStatus,
        toStatus: fromStatus,
        reason: '该批次此前已判成「已检测」，重报只算第一次，不允许整组撤回',
      })
      continue
    }

    // 整组检测只收待检测（固化中，含返工后重检）的批次；还在待固化的不受理。
    if (fromStatus === FLYASH_RAW) {
      blocked.push({
        code: item.code,
        conclusion: item.conclusion,
        outcome: 'blocked',
        fromStatus,
        toStatus: FLYASH_RAW,
        reason: '批次还在「待固化」、未进入待检测，整组检测不受理，继续留在待固化',
      })
      continue
    }

    // 螯合剂用量与水泥用量必须填全，缺一项就挡回待固化补齐，不允许无声消失。
    const missing: string[] = []
    if (!isFilled(row[FIELD_CHELATOR] as string)) {
      missing.push('螯合剂用量')
    }
    if (!isFilled(row[FIELD_CEMENT] as string)) {
      missing.push('水泥用量')
    }
    if (missing.length > 0) {
      blocked.push({
        code: item.code,
        conclusion: item.conclusion,
        outcome: 'blocked',
        fromStatus,
        toStatus: FLYASH_RAW,
        reason: `${missing.join('与')}没填全，挡回「待固化」补齐后再报，本条没有判成已检测`,
      })
      continue
    }

    if (fromStatus !== FLYASH_PENDING_INSPECT && fromStatus !== FLYASH_REWORK) {
      blocked.push({
        code: item.code,
        conclusion: item.conclusion,
        outcome: 'blocked',
        fromStatus,
        toStatus: fromStatus,
        reason: `当前状态「${fromStatus}」不在可整组检测范围内，保持原状`,
      })
      continue
    }

    if (item.conclusion === '合格') {
      accepted.push({
        code: item.code,
        conclusion: item.conclusion,
        outcome: 'accepted',
        fromStatus,
        toStatus: FLYASH_DONE,
        reason: '用量齐全，检测结论合格，判成「已检测」',
      })
    } else {
      rework.push({
        code: item.code,
        conclusion: item.conclusion,
        outcome: 'rework',
        fromStatus,
        toStatus: FLYASH_REWORK,
        reason: '检测结论不合格，判成「需返工」，计入运营概览待返工批次',
      })
    }
  }

  const taken = [...accepted, ...rework]
  const bouncedCodes = new Set(blocked.filter((d) => d.toStatus === FLYASH_RAW).map((d) => d.code))
  const nextFlyashRows = flyashRows.map((row) => {
    const code = String(row[FIELD_CODE] ?? '')
    const detail = taken.find((item) => item.code === code)
    if (detail) {
      return {
        ...row,
        status: detail.toStatus,
        pending: detail.toStatus !== FLYASH_DONE,
        abnormal: detail.toStatus === FLYASH_REWORK,
        [FIELD_RESULT]: detail.conclusion,
        [FIELD_FLOW_STATUS]: detail.toStatus,
        检测班组: operator,
        检测时间: inspectTime,
      }
    }
    // 被挡回待固化的：显式写回「待固化」，继续留在待固化队列里等人补齐。
    if (bouncedCodes.has(code)) {
      return {
        ...row,
        status: FLYASH_RAW,
        pending: true,
        [FIELD_FLOW_STATUS]: FLYASH_RAW,
      }
    }
    return row
  })

  const flyashCommit = commitRows(FLYASH_KEY, nextFlyashRows, flyashVersion)
  if (!flyashCommit.ok) {
    // 别的班组先一步把同一批落表了：先入库的那一版说了算，本组整组作废、页面重读。
    return {
      ...emptyGroupResult(
        `这批飞灰固化批次刚被别的班组抢先落表（数据版本已变），先入库的那一版说了算，请刷新后按最新数据重报，本组未写入任何结论`,
      ),
      conflict: true,
    }
  }

  // 结论同步进环保监控「待复核」清单：合格、不合格都要复核；同一固化编号已有待复核记录不重复生成。
  const reviewIds: string[] = []
  const buildReviewRows = (): EntryRow[] => {
    const emissionRows = listRows(EMISSION_KEY)
    const nextEmission = [...emissionRows]
    let nextId = nextEmission.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
    for (const detail of taken) {
      const source = rowByCode.get(detail.code)
      const reviewNo = `EMIS-${detail.code}`
      const exists = nextEmission.some(
        (row) =>
          String(row['来源固化编号'] ?? '') === detail.code && String(row.status) === EMISSION_REVIEW,
      )
      if (exists) {
        reviewIds.push(reviewNo)
        continue
      }
      nextId += 1
      nextEmission.push({
        id: nextId,
        status: EMISSION_REVIEW,
        pending: true,
        abnormal: detail.conclusion === '不合格',
        监控编号: reviewNo,
        监控指标: '飞灰固化块浸出毒性',
        限值要求: 'GB16889 表1 限值',
        实测值: detail.conclusion === '合格' ? '螯合稳定化检测合格' : '浸出检测不合格，需返工',
        达标判定: detail.conclusion,
        监控日期: inspectDate,
        监控人员: operator,
        监控状态: EMISSION_REVIEW,
        来源固化编号: detail.code,
        固化块批次: source ? String(source[FIELD_BLOCK] ?? '') : '',
      })
      reviewIds.push(reviewNo)
    }
    return nextEmission
  }

  const pushReview = (attempt: number): void => {
    const nextEmission = buildReviewRows()
    const result = commitRows(EMISSION_KEY, nextEmission, moduleVersion(EMISSION_KEY))
    if (!result.ok && attempt < 1) {
      // 并行班组可能同时在写环保监控清单：重读一次再提交，待复核记录按来源固化编号去重，不会写重。
      pushReview(attempt + 1)
    }
  }
  pushReview(0)

  const lines: string[] = []
  if (accepted.length > 0) {
    lines.push(`判成「已检测」${accepted.length}条：${accepted.map((d) => d.code).join('、')}`)
  }
  if (rework.length > 0) {
    lines.push(`判成「需返工」${rework.length}条：${rework.map((d) => d.code).join('、')}`)
  }
  if (blocked.length > 0) {
    lines.push(`被挡在外${blocked.length}条（仍留在原队列/待固化，未判成已检测）：${blocked.map((d) => d.code).join('、')}`)
  }
  if (duplicate.length > 0) {
    lines.push(`重报只算一次${duplicate.length}条：${duplicate.map((d) => d.code).join('、')}`)
  }
  if (notfound.length > 0) {
    lines.push(`查无此批次${notfound.length}条：${notfound.map((d) => d.code).join('、')}`)
  }

  return {
    ok: true,
    conflict: false,
    message: lines.join('；') || '本组没有可落表的批次',
    accepted,
    rework,
    blocked,
    duplicate,
    notfound,
    reviewIds,
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: '﻿' + lines.join('\n') }
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
  const flyashRows = rows[FLYASH_KEY] ?? []
  const emissionRows = rows[EMISSION_KEY] ?? []
  // 固化块批次进了已检测/需返工以后，待返工批次跟着重算，不写死。
  const reworkCount = flyashRows.filter((row) => String(row.status) === FLYASH_REWORK).length
  const pendingInspectCount = flyashRows.filter(
    (row) => String(row.status) === FLYASH_PENDING_INSPECT,
  ).length
  const reviewCount = emissionRows.filter((row) => String(row.status) === EMISSION_REVIEW).length
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '飞灰待返工批次', value: reworkCount },
    { label: '飞灰待检测批次', value: pendingInspectCount },
    { label: '环保待复核清单', value: reviewCount },
  ]
  return { cards, modules }
}
