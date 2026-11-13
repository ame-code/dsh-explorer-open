// 客户端逻辑自测：用假的 dsh 服务 + 假的 fetch，验证调用顺序与参数
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

let mod
const fakeWindow = {
  __ModuleLoader__: {
    load({ id, factory }) {
      mod = factory(() => {})
      mod.id = id
    },
  },
}

const ok = (cond, label) => console.log(cond ? `PASS ${label}` : `FAIL ${label}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(label, { payload, failSession, failOpen }) {
  const calls = []
  const ctx = {
    workspaces: {
      async create(input) {
        calls.push(['workspaces.create', input])
        return { workspaceId: 'ws-1', path: input.path, title: 't' }
      },
    },
    sessions: {
      async create(input) {
        calls.push(['sessions.create', input])
        if (failSession) throw new Error('create failed')
        return 'sess-1'
      },
      binding(id) {
        return { id }
      },
    },
    get(name) {
      if (name !== 'conversation') return undefined
      return {
        input: {
          requestDraftInitialization(binding, options) {
            calls.push(['requestDraftInitialization', binding?.id, options])
            return 'applied'
          },
        },
      }
    },
    uiWorkspace: {
      openSession(id) {
        calls.push(['uiWorkspace.openSession', id])
        if (failOpen) throw new Error('openSession failed')
      },
      async openWorkspace(id) {
        calls.push(['uiWorkspace.openWorkspace', id])
      },
    },
    effect(fn) {
      return fn()
    },
  }

  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(['fetch', url, init?.headers])
    return { ok: true, json: async () => payload }
  }
  globalThis.window = fakeWindow
  try {
    const loaded = (await import(`data:text/javascript,${encodeURIComponent(source)}`)).default
    void loaded
  } catch {}
  // 上面的动态 import 只为了拿到模块；真正执行发生在 factory 里
  globalThis.window = fakeWindow
  mod = undefined
  // 页面每次刷新都是新的 window，插件的一次性注册标记也要跟着重置
  delete fakeWindow.__dshExplorerOpenClientRegistered
  // 重新加载一次（module 缓存按 url，所以加个 hash）
  await import(`data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`)
  const controller = mod.apply(ctx)
  await sleep(1500)
  globalThis.fetch = origFetch
  return { calls, controller }
}

console.log('--- 正常路径 ---')
const a = await run('ok', { payload: { status: 'open', requests: [{ folder: 'E:\\demo', token: 't', at: 1 }] } })
console.log(a.calls.map((c) => JSON.stringify(c)).join('\n'))
ok(mod.id === '@reed-io/dsh-explorer-open', '注册 id 与包名一致')
ok(a.calls.some((c) => c[0] === 'workspaces.create' && c[1].path === 'E:\\demo'), '调用 workspaces.create({path})')
ok(a.calls.some((c) => c[0] === 'sessions.create' && c[1].workspaceId === 'ws-1'), '调用 sessions.create({workspaceId, cwd})')
ok(a.calls.some((c) => c[0] === 'uiWorkspace.openSession' && c[1] === 'sess-1'), '调用 uiWorkspace.openSession(新会话)')
ok(a.calls.some((c) => c[0] === 'fetch' && c[2] && c[2]['x-dsh-explorer-open'] === '1'), '轮询带上自定义请求头')

console.log('--- 空闲时不该有动作 ---')
const b = await run('idle', { payload: { status: 'idle', requests: [] } })
ok(b.calls.filter((c) => c[0] !== 'fetch').length === 0, '空闲时只轮询不动作')

console.log('--- 建会话失败 → 退回 openWorkspace ---')
const c = await run('fail-session', { payload: { status: 'open', requests: [{ folder: 'E:\\demo2', token: 't', at: 1 }] }, failSession: true })
ok(c.calls.some((x) => x[0] === 'uiWorkspace.openWorkspace' && x[1] === 'ws-1'), '建会话失败时打开工作区')
ok(!c.calls.some((x) => x[0] === 'uiWorkspace.openSession'), '建会话失败时不再切会话')

console.log('--- 切会话失败 → 退回 openWorkspace ---')
const d = await run('fail-open', { payload: { status: 'open', requests: [{ folder: 'E:\\demo3', token: 't', at: 1 }] }, failOpen: true })
ok(d.calls.some((x) => x[0] === 'uiWorkspace.openWorkspace' && x[1] === 'ws-1'), '切会话失败时打开工作区')

console.log('--- 文件右键 → 草稿里预置 @ 引用 ---')
const e = await run('file', {
  payload: { status: 'open', requests: [{ folder: 'E:\\demo4', token: 't', at: 1, file: 'E:\\demo4\\sub\\a b.txt' }] },
})
const initialized = e.calls.find((x) => x[0] === 'requestDraftInitialization')
ok(initialized !== undefined, '调用了 requestDraftInitialization')
ok(initialized?.[1] === 'sess-1', `绑定到新会话 (${initialized?.[1]})`)
ok(initialized?.[2]?.prompt === '@"sub\\a b.txt" ', `含空格的相对路径用引号形式 (${JSON.stringify(initialized?.[2]?.prompt)})`)
ok(initialized?.[2]?.clearPreviousDraft === true, '覆盖旧草稿')

console.log('--- 文件在工作区之外 → 不写引用 ---')
const f = await run('outside', {
  payload: { status: 'open', requests: [{ folder: 'E:\\demo5', token: 't', at: 1, file: 'D:\\other\\x.txt' }] },
})
ok(!f.calls.some((x) => x[0] === 'requestDraftInitialization'), '工作区外的文件不写引用')
ok(f.calls.some((x) => x[0] === 'uiWorkspace.openSession'), '工作区外的文件仍然打开会话')

console.log('--- 同一页面重复执行入口（插件改名/重复注入）---')
{
  // 回归用例：chunk 被执行两次时，第二次必须直接跳过，不能撞 client-modules
  // 的 duplicate factory registration —— 那会让整个 web 启动失败。
  const win = { __ModuleLoader__: { load({ factory }) { factory(() => {}) } } }
  globalThis.window = win
  await import(`data:text/javascript,${encodeURIComponent(source)}#dup-a-${Math.random()}`)
  win.__ModuleLoader__.load = () => {
    throw new Error('client-modules: duplicate factory registration for "dsh-explorer-open"')
  }
  let threw = false
  try {
    await import(`data:text/javascript,${encodeURIComponent(source)}#dup-b-${Math.random()}`)
  } catch {
    threw = true
  }
  ok(!threw, '第二次执行不重复注册工厂')
}

console.log('DONE')
process.exit(0)
