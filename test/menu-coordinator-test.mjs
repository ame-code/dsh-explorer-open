import assert from 'node:assert/strict'
import { createMenuCoordinator } from '../lib/menus.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ok = (condition, label) => {
  assert.ok(condition, label)
  console.log(`PASS ${label}`)
}

// 插件启动：先注册经典回退；原生菜单安装成功后移除经典入口。
{
  const calls = []
  const menus = createMenuCoordinator({
    installClassic: async () => calls.push('install'),
    removeClassic: async () => calls.push('remove'),
    refresh: async () => calls.push('refresh'),
    onError: (error) => { throw error },
  })
  await menus.start()
  await menus.useNative()
  ok(calls.join(',') === 'install,refresh,remove,refresh', '原生菜单就绪后移除经典入口')
  await menus.dispose()
  ok(calls.slice(-2).join(',') === 'remove,refresh', '停用时清理菜单')
}

// MSIX 不可用：经典回退保留。
{
  const calls = []
  const menus = createMenuCoordinator({
    installClassic: async () => calls.push('install'),
    removeClassic: async () => calls.push('remove'),
    refresh: async () => calls.push('refresh'),
    onError: (error) => { throw error },
  })
  await menus.start()
  ok(calls.join(',') === 'install,refresh', '原生菜单不可用时保留经典入口')
  await menus.dispose()
}

// 模拟经典入口安装较慢，原生菜单途中就绪，最后不得留下重复菜单。
{
  const calls = []
  let completeInstall
  const menus = createMenuCoordinator({
    installClassic: async () => {
      calls.push('install-start')
      await new Promise((resolve) => { completeInstall = resolve })
      calls.push('install-done')
    },
    removeClassic: async () => calls.push('remove'),
    refresh: async () => calls.push('refresh'),
    onError: (error) => { throw error },
  })
  const starting = menus.start()
  while (!completeInstall) await sleep(0)
  const native = menus.useNative()
  completeInstall()
  await Promise.all([starting, native])
  ok(calls.indexOf('remove') > calls.indexOf('install-done') && calls.at(-2) === 'remove', '安装过程原生就绪时不会留下重复入口')
  await menus.dispose()
}

// 停用与未完成安装竞态：安装返回后再次清理，不能复活菜单。
{
  const calls = []
  let completeInstall
  const menus = createMenuCoordinator({
    installClassic: async () => {
      calls.push('install-start')
      await new Promise((resolve) => { completeInstall = resolve })
      calls.push('install-done')
    },
    removeClassic: async () => calls.push('remove'),
    refresh: async () => calls.push('refresh'),
    onError: (error) => { throw error },
  })
  const starting = menus.start()
  await sleep(0)
  const disposing = menus.dispose()
  completeInstall()
  await Promise.all([starting, disposing])
  ok(calls.join(',') === 'install-start,install-done,remove,remove,refresh', '停用期间完成的菜单安装会被二次清理')
}

console.log('DONE')
