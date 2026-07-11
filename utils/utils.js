import { spawn } from 'child_process'

/** 延时 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 启动 api 服务（detached 使其成为独立进程组，便于整组强杀） */
function startService() {
  const api = spawn('npm', ['run', 'apiService'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  api.stdout.on('data', () => {})
  api.stderr.on('data', data => {
    const msg = String(data).trim()
    if (msg) console.log('[api stderr]', msg)
  })
  api.on('close', code => console.log(`[api] 子进程退出，code=${code}`))

  return api
}

/**
 * 关闭 api 服务。
 * 关键修复：npm 不会把 SIGTERM 转发给它的子进程（真正的 Express 服务），
 * 仅 api.kill() 会导致 3000 端口一直被占 → 下一阶段 startService 报 EADDRINUSE。
 * 因此用 detached 进程组 + process.kill(-pid) 强杀整组。
 */
function close_api(api) {
  try {
    process.kill(-api.pid, 'SIGKILL') // 杀掉整个进程组（npm + Express）
  } catch (e) {
    try { api.kill('SIGKILL') } catch (_) { /* 已退出 */ }
  }
}

/**
 * 发送请求到本地 api 服务（带超时 + 重试）
 * 超时 10 秒，失败后指数退避重试最多 3 次
 */
async function send(path, method, headers) {
  const MAX_RETRIES = 3
  const TIMEOUT_MS = 10000
  let lastError

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const resp = await fetch('http://127.0.0.1:3000' + path, {
        method,
        headers,
        signal: controller.signal,
      })
      clearTimeout(timer)
      return await resp.json()
    } catch (err) {
      clearTimeout(timer)
      lastError = err
      if (attempt < MAX_RETRIES - 1) {
        const waitMs = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s
        console.log(`[send] 第 ${attempt + 1} 次请求失败，${waitMs}ms 后重试: ${err.message}`)
        await delay(waitMs)
      }
    }
  }
  throw lastError
}

export { delay, startService, close_api, send }
