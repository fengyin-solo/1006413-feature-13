import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)

const STORE = '/tmp/fa-test-db.json'
const mode = process.argv[2]

// ---- 最小 localStorage 垫片：两个进程抢批时靠这个文件模拟跨标签页持久层 ----
function loadDb() {
  try {
    return JSON.parse(readFileSync(STORE, 'utf8'))
  } catch {
    return {}
  }
}
const db = loadDb()
const storage = {
  getItem: (k) => {
    // 每个进程每次都回磁盘，模拟浏览器里各标签页共享同一份 localStorage。
    const fresh = loadDb()
    return k in fresh ? fresh[k] : null
  },
  setItem: (k, v) => {
    db[k] = v
    const merged = loadDb()
    merged[k] = v
    writeFileSync(STORE, JSON.stringify(merged))
  },
}
globalThis.window = { localStorage: storage, addEventListener() {} }

await build({
  entryPoints: ['/workspace/frontend/src/test-harness/impl.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: '/tmp/fa-impl.cjs',
  alias: { '@': '/workspace/frontend/src' },
  logLevel: 'silent',
})

const impl = require('/tmp/fa-impl.cjs')

if (mode === 'reset') {
  rmSync(STORE, { force: true })
  impl.reset()
  console.log('reset done')
} else if (mode === 'main') {
  console.log(JSON.stringify(impl.runMain(), null, 2))
} else if (mode === 'check') {
  console.log(JSON.stringify(impl.checkRace(), null, 2))
} else if (mode === 'race-a' || mode === 'race-b') {
  const wait = Number(process.argv[3] ?? 200)
  const warm = impl.warm()
  console.log(`${mode} primed at version ${warm}`)
  setTimeout(() => {
    const result = impl.raceSubmit(mode === 'race-a' ? '甲班' : '乙班')
    console.log(`${mode} result ${JSON.stringify(result)}`)
  }, wait)
}
