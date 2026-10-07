import { groupInspectFlyash, listEntries, loadOverview, resetModule, runAction } from '@/api/local-service'
import { listRows, moduleVersion } from '@/data/local-store'

function byCode(code: string) {
  return listRows('flyash').find((row) => String(row['固化编号']) === code)
}

function emissionReviewRows() {
  return listRows('emission').filter((row) => String(row.status) === '待复核')
}

export function reset() {
  resetModule('flyash')
  resetModule('emission')
}

export function warm(): number {
  // 读一遍表并把版本号吃进本进程缓存，模拟班组打开页面时拿到的旧快照。
  listEntries('flyash')
  return moduleVersion('flyash')
}

export function raceSubmit(team: string) {
  // 真并发窗口：班组在收到 storage 事件作废缓存之前就点了提交，
  // 仍按自己打开页面时读到的版本号去落表，由 CAS 决定谁算。
  const result = groupInspectFlyash(
    [
      { code: 'FLYA-0010', conclusion: '合格' },
      { code: 'FLYA-0011', conclusion: '不合格' },
    ],
    team,
  )
  return { ok: result.ok, conflict: result.conflict, message: result.message }
}

export function checkRace() {
  const r0010 = byCode('FLYA-0010')
  const r0011 = byCode('FLYA-0011')
  const reviews10 = listRows('emission').filter(
    (row) => String(row['来源固化编号']) === 'FLYA-0010' && String(row.status) === '待复核',
  )
  const checks: Array<[string, boolean]> = [
    ['0010 只被甲班收下一次', r0010?.status === '已检测' && r0010?.['检测班组'] === '甲班'],
    ['0011 只被甲班判返工一次', r0011?.status === '需返工' && r0011?.['检测班组'] === '甲班'],
    ['复核清单里 0010 只有一条', reviews10.length === 1],
  ]
  return {
    rows: { 'FLYA-0010': r0010?.status, 'FLYA-0011': r0011?.status },
    checks: checks.map(([name, pass]) => `${pass ? 'PASS' : 'FAIL'}  ${name}`),
    allPass: checks.every(([, pass]) => pass),
  }
}

export function runMain() {
  reset()

  // 一整组：合格收下、不合格返工、缺用量挡回、待固化挡回、已检测重报、组内重复、查无此号
  const report = groupInspectFlyash(
    [
      { code: 'FLYA-0004', conclusion: '合格' }, // 固化中、用量全 -> 已检测
      { code: 'FLYA-0008', conclusion: '合格' }, // 固化中、用量全 -> 已检测
      { code: 'FLYA-0007', conclusion: '不合格' }, // -> 需返工
      { code: 'FLYA-0005', conclusion: '合格' }, // 缺螯合剂 -> 挡回待固化
      { code: 'FLYA-0006', conclusion: '不合格' }, // 缺水泥 -> 挡回待固化
      { code: 'FLYA-0001', conclusion: '合格' }, // 还在待固化 -> 挡（留待固化）
      { code: 'FLYA-0016', conclusion: '不合格' }, // 已检测 -> 重报只算一次，不许撤回
      { code: 'FLYA-0004', conclusion: '不合格' }, // 组内同号重报 -> 重复
      { code: 'FLYA-0099', conclusion: '合格' }, // 查无此号
    ],
    '甲班',
  )

  // 返工批次（18）补检合格，应该允许收下；再次重报必须挡
  const reworkReport = groupInspectFlyash(
    [
      { code: 'FLYA-0018', conclusion: '合格' },
      { code: 'FLYA-0018', conclusion: '不合格' },
    ],
    '乙班',
  )
  const reworkRepeat = groupInspectFlyash([{ code: 'FLYA-0018', conclusion: '不合格' }], '乙班')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flyashNow: Record<string, any> = {}
  for (const code of ['FLYA-0004', 'FLYA-0007', 'FLYA-0005', 'FLYA-0006', 'FLYA-0001', 'FLYA-0016', 'FLYA-0018']) {
    const row = byCode(code)
    flyashNow[code] = {
      status: row?.status,
      pending: row?.pending,
      abnormal: row?.abnormal,
      result: row?.['检测结果'],
      team: row?.['检测班组'],
      chelator: row?.['螯合剂用量'],
    }
  }

  // 环保复核动作：复核不通过 -> 未达标（pending=false, abnormal=true）
  const reviewBefore = emissionReviewRows().map((row) => ({
    no: row['监控编号'],
    source: row['来源固化编号'],
    verdict: row['达标判定'],
  }))
  const reviewRow = emissionReviewRows().find((row) => String(row['来源固化编号']) === 'FLYA-0007')
  const failAction = reviewRow ? runAction('emission', Number(reviewRow.id), '复核不通过') : null

  const overview = loadOverview()
  const card = (label: string) => overview.cards.find((item) => item.label === label)?.value

  const status0007 = byCode('FLYA-0007')?.status
  const status0018 = byCode('FLYA-0018')?.status
  const reviewAfter = emissionReviewRows().map((row) => String(row['来源固化编号']))

  // 断言
  const checks: Array<[string, boolean]> = [
    ['报告总成功', report.ok === true],
    ['已检测两条', report.accepted.map((d) => d.code).join() === 'FLYA-0004,FLYA-0008'],
    ['需返工一条', report.rework.map((d) => d.code).join() === 'FLYA-0007'],
    ['挡回/挡外三条', report.blocked.map((d) => d.code).join() === 'FLYA-0005,FLYA-0006,FLYA-0001'],
    ['重复两条', report.duplicate.map((d) => d.code).join() === 'FLYA-0016,FLYA-0004'],
    ['查无此号一条', report.notfound.map((d) => d.code).join() === 'FLYA-0099'],
    ['0004 落已检测', flyashNow['FLYA-0004']?.status === '已检测'],
    ['0007 落需返工且异常', flyashNow['FLYA-0007']?.status === '需返工' && flyashNow['FLYA-0007']?.abnormal === true],
    ['0005 缺螯合剂挡回待固化', flyashNow['FLYA-0005']?.status === '待固化'],
    ['0006 缺水泥挡回待固化', flyashNow['FLYA-0006']?.status === '待固化'],
    ['0001 留待固化未消失', flyashNow['FLYA-0001']?.status === '待固化'],
    ['0016 已检测不许撤回', flyashNow['FLYA-0016']?.status === '已检测' && flyashNow['FLYA-0016']?.result === '合格'],
    ['返工18补检可收下', reworkReport.accepted[0]?.code === 'FLYA-0018'],
    ['返工18补检后重报算重复', reworkRepeat.duplicate[0]?.code === 'FLYA-0018'],
    ['复核清单含0004/0007/0008/0018', reviewBefore.some((r) => r.source === 'FLYA-0004') && reviewBefore.some((r) => r.source === 'FLYA-0007') && reviewBefore.some((r) => r.source === 'FLYA-0008') && reviewBefore.some((r) => r.source === 'FLYA-0018')],
    ['复核清单种子0017仍在', reviewBefore.some((r) => r.source === 'FLYA-0017')],
    ['复核不通过成功', failAction?.ok === true],
    ['0007复核后清单移除', !reviewAfter.includes('FLYA-0007')],
    ['概览待返工重算=3（0007/0019/0020）', card('飞灰待返工批次') === 3],
    ['概览待检测重算=7（固化中12条收下0004/0007/0008）', card('飞灰待检测批次') === 7],
    ['概览待复核重算=4（0017种子+0004/0008/0018）', card('环保待复核清单') === 4],
    ['18补检后为已检测', status0018 === '已检测'],
    ['0007仍需返工（环保复核不影响固化态）', status0007 === '需返工'],
  ]

  return {
    message: report.message,
    flyashNow,
    reviewBefore,
    failAction,
    overviewCards: overview.cards,
    checks: checks.map(([name, pass]) => `${pass ? 'PASS' : 'FAIL'}  ${name}`),
    allPass: checks.every(([, pass]) => pass),
  }
}
