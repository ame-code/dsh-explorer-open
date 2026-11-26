// 统一管理两种菜单，串行处理安装、原生就绪和停用，避免迟到的安装恢复重复入口。
export function createMenuCoordinator({ installClassic, removeClassic, refresh, onError }) {
  let active = true
  let nativeReady = false
  let pending = Promise.resolve()

  function enqueue(operation) {
    pending = pending.then(operation).catch(onError)
    return pending
  }

  function update() {
    return enqueue(async () => {
      if (!active) return
      const installing = !nativeReady
      if (installing) await installClassic()
      else await removeClassic()
      // 安装期间原生菜单可能刚刚就绪，或者插件已经被停用。
      if (installing && (!active || nativeReady)) await removeClassic()
      if (active) await refresh()
    })
  }

  return {
    start: update,
    useNative() {
      nativeReady = true
      return update()
    },
    dispose() {
      active = false
      return enqueue(async () => {
        await removeClassic()
        await refresh()
      })
    },
  }
}
