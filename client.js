window.__ModuleLoader__.load({
  id: 'dsh-explorer-open',
  factory(require) {
    const REQUEST_URL = '/api/plugins/dsh-open-with/request'
    // 自定义请求头：跨站页面无法在不触发预检的情况下带上它，
    // 可以挡住别的网页偷偷 GET 掉排队中的请求。
    const REQUEST_HEADER = 'x-dsh-open-with'
    const POLL_MS = 1000

    return {
      inject: ['uiWorkspace', 'sessions', 'workspaces'],
      apply(ctx) {
        const log = (message, error) => {
          if (error === undefined) console.info(`[dsh-open-with] ${message}`)
          else console.warn(`[dsh-open-with] ${message}`, error)
        }

        /** 打开工作区（已存在则复用），在其中新建一个会话，再切过去。 */
        async function handle(folder, file) {
          // create 对同一路径是幂等的：有就返回已有的，没有才新建
          const workspace = await ctx.workspaces.create({ path: folder })
          const workspaceId = workspace.workspaceId

          let sessionId
          try {
            // 不关心有没有旧会话：每次都新建一个
            sessionId = await ctx.sessions.create({ workspaceId, cwd: workspace.path })
          } catch (error) {
            log(`新建会话失败，改为打开工作区: ${folder}`, error)
            await ctx.uiWorkspace.openWorkspace(workspaceId)
            return
          }

          try {
            ctx.uiWorkspace.openSession(sessionId)
          } catch (error) {
            log(`切换到新会话失败，改为打开工作区: ${folder}`, error)
            await ctx.uiWorkspace.openWorkspace(workspaceId)
            return
          }
          log(`已打开: ${folder} → 会话 ${sessionId}`)

          if (file !== undefined) await seedFileReference(workspace.path, sessionId, file)
        }

        /**
         * 把被点中的文件写成草稿里的 @引用。
         * 引用按会话 cwd 解析，所以只接受位于工作区之内的文件；含空格的路径用 @"..." 形式。
         */
        function relativeMention(cwd, file) {
          const trim = (path) => path.replace(/[\\/]+$/u, '')
          const base = trim(cwd)
          const target = trim(file)
          const lower = (path) => path.toLowerCase()
          if (lower(target) === lower(base)) return undefined
          const prefix = lower(target).startsWith(`${lower(base)}\\`) || lower(target).startsWith(`${lower(base)}/`)
          if (!prefix) return undefined
          const relative = target.slice(base.length + 1)
          return `${/\s/u.test(relative) ? `@"${relative}"` : `@${relative}`} `
        }

        /** 新会话刚建好时，binding 可能还没就绪，短暂重试几次再写草稿。 */
        async function seedFileReference(cwd, sessionId, file) {
          const mention = relativeMention(cwd, file)
          if (mention === undefined) {
            log(`文件不在工作区内，跳过引用: ${file}`)
            return
          }

          let input
          try {
            input = ctx.get('conversation')?.input
          } catch {
            input = undefined
          }
          if (input?.requestDraftInitialization === undefined) {
            log(`当前界面不支持预置草稿，跳过引用: ${file}`)
            return
          }

          for (let attempt = 0; attempt < 20; attempt += 1) {
            const binding = ctx.sessions.binding?.(sessionId)
            if (binding !== undefined) {
              try {
                const result = input.requestDraftInitialization(binding, {
                  prompt: mention,
                  clearPreviousDraft: true,
                })
                if (result !== 'blocked') {
                  log(`已在草稿中引用: ${mention.trim()}`)
                  return
                }
              } catch (error) {
                log(`写入草稿失败: ${file}`, error)
                return
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          log(`草稿未就绪，跳过引用: ${file}`)
        }

        async function poll() {
          let data
          try {
            const res = await fetch(REQUEST_URL, { cache: 'no-store', headers: { [REQUEST_HEADER]: '1' } })
            if (!res.ok) return
            data = await res.json()
          } catch {
            return
          }
          if (data?.status !== 'open' || !Array.isArray(data.requests)) return
          for (const request of data.requests) {
            if (request === null || typeof request.folder !== 'string') continue
            const file = typeof request.file === 'string' ? request.file : undefined
            try {
              await handle(request.folder, file)
            } catch (error) {
              log(`打开失败: ${request.folder}`, error)
            }
          }
        }

        let busy = false
        async function tick() {
          if (busy) return
          busy = true
          try {
            await poll()
          } finally {
            busy = false
          }
        }

        ctx.effect(() => {
          void tick()
          const timer = setInterval(() => void tick(), POLL_MS)
          return () => clearInterval(timer)
        })
      },
    }
  },
})
