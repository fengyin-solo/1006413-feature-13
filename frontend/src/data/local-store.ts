import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'
// 每个模块一个版本号：saveRows 落表时 +1，两个班组抢同一批时靠它做乐观锁，先入库的那一版说了算。
const META_KEY = 'waste-to-energy-plant:meta'

type ModuleMeta = { version: number }
type StorageMeta = Record<string, ModuleMeta>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedMeta(): StorageMeta {
  const meta: StorageMeta = {}
  for (const key of Object.keys(SEED_ROWS)) {
    meta[key] = { version: 0 }
  }
  return meta
}

function readMeta(force = false): StorageMeta {
  if (!force && typeof window === 'undefined') {
    return seedMeta()
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedMeta()
  }
  const raw = window.localStorage.getItem(META_KEY)
  if (!raw) {
    const meta = seedMeta()
    window.localStorage.setItem(META_KEY, JSON.stringify(meta))
    return meta
  }
  try {
    return { ...seedMeta(), ...(JSON.parse(raw) as StorageMeta) }
  } catch {
    const meta = seedMeta()
    window.localStorage.setItem(META_KEY, JSON.stringify(meta))
    return meta
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let metaCache: StorageMeta | null = null

// 作废内存缓存：收到别的标签页 storage 事件、或测试里要模拟跨标签页时调用。
export function invalidateCache(): void {
  cache = null
  metaCache = null
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 另一个标签页（另一个班组）落表后，本页内存里的缓存就旧了；storage 事件触发时作废重读。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
    if (event.key === META_KEY) {
      metaCache = null
    }
  })
}

function meta(force = false): StorageMeta {
  if (metaCache === null || force) {
    metaCache = readMeta(force)
  }
  return metaCache
}

export function moduleVersion(key: string): number {
  return meta()[key]?.version ?? 0
}

function persist(next: Record<string, EntryRow[]>, nextMeta: StorageMeta): void {
  cache = next
  metaCache = nextMeta
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.localStorage.setItem(META_KEY, JSON.stringify(nextMeta))
  }
}

// 普通落表：不校验版本，直接成为新版本。
export function saveRows(key: string, rows: EntryRow[]): void {
  const current = moduleVersion(key)
  const nextMeta = { ...meta(), [key]: { version: current + 1 } }
  persist({ ...allRows(), [key]: rows }, nextMeta)
}

// 带乐观锁的落表：expectedVersion 必须等于持久层里的最新版本，说明读表之后没人抢先；
// 版本号以 localStorage 里的权威值为准（本页 metaCache 可能已被别的班组改旧），
// 不一致就整批拒收并作废本页缓存，由调用方重新读表回报——先入库的那一版说了算。
export function commitRows(
  key: string,
  rows: EntryRow[],
  expectedVersion: number,
): { ok: boolean; version: number } {
  const authoritative = readMeta(true)[key]?.version ?? 0
  if (authoritative !== expectedVersion) {
    cache = null
    metaCache = null
    return { ok: false, version: authoritative }
  }
  const nextMeta = { ...meta(), [key]: { version: authoritative + 1 } }
  persist({ ...allRows(), [key]: rows }, nextMeta)
  return { ok: true, version: authoritative + 1 }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
