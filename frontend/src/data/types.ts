/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 飞灰固化整组检测：单条送检项，固化编号与检测结论一起落表。
export type FlyashGroupItem = {
  code: string
  conclusion: '合格' | '不合格'
}

export type FlyashGroupOutcome =
  | 'accepted' // 已收下，判成「已检测」
  | 'rework' // 已收下，判成「需返工」
  | 'blocked' // 螯合剂/水泥用量没填全，挡回「待固化」
  | 'duplicate' // 同一固化编号重报，只算第一次
  | 'notfound' // 找不到这个固化编号
  | 'stale' // 被别的班组抢先入库

export type FlyashGroupDetail = {
  code: string
  conclusion: string
  outcome: FlyashGroupOutcome
  fromStatus: string
  toStatus: string
  reason: string
}

export type FlyashGroupResult = {
  ok: boolean
  message: string
  conflict: boolean
  accepted: FlyashGroupDetail[]
  rework: FlyashGroupDetail[]
  blocked: FlyashGroupDetail[]
  duplicate: FlyashGroupDetail[]
  notfound: FlyashGroupDetail[]
  reviewIds: string[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
