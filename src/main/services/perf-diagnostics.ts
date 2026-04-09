import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync } from 'fs'
import { createLogger } from './logger'

const log = createLogger({ component: 'PerfDiagnostics' })

const INTERVAL_MS = 30_000
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_ROTATED_FILES = 2

export interface MetricCollectors {
  getPtyCount: () => number
  getScriptStats: () => { active: number; totalOpened: number; totalClosed: number }
  getFileWatcherCount: () => number
  getWorktreeWatcherCount: () => number
  getBranchWatcherCount: () => number
  getActiveSessionCount: () => number
}

export interface PerfSnapshot {
  timestamp: string
  uptimeMs: number
  cpu: {
    userMs: number
    systemMs: number
    percentSinceLastSample: number
  }
  memory: {
    rss: number
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
  }
  processes: {
    ptyActive: number
    scriptsActive: number
    scriptsTotalOpened: number
    scriptsTotalClosed: number
  }
  watchers: {
    fileTree: number
    worktree: number
    branch: number
  }
  sessions: {
    active: number
  }
  handles: {
    active: number
    requests: number
  }
  eventLoopLagMs: number
}

class PerfDiagnosticsService {
  private interval: NodeJS.Timeout | null = null
  private collectors: MetricCollectors | null = null
  private logFile: string
  private logDir: string
  private prevCpuUsage: NodeJS.CpuUsage | null = null
  private prevCpuTimestamp: number | null = null
  private running = false

  constructor() {
    const homeDir = app.getPath('home')
    this.logDir = join(homeDir, '.hive', 'logs')
    this.logFile = join(this.logDir, 'perf-diagnostics.jsonl')
  }

  setCollectors(collectors: MetricCollectors): void {
    this.collectors = collectors
  }

  start(): void {
    if (this.running) return
    this.running = true

    this.ensureLogDir()
    // Initialize CPU baseline
    this.prevCpuUsage = process.cpuUsage()
    this.prevCpuTimestamp = Date.now()

    log.info('Performance diagnostics started', { intervalMs: INTERVAL_MS })
    this.collectAndLog()

    this.interval = setInterval(() => {
      this.collectAndLog()
    }, INTERVAL_MS)
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.prevCpuUsage = null
    this.prevCpuTimestamp = null
    log.info('Performance diagnostics stopped')
  }

  isRunning(): boolean {
    return this.running
  }

  getSnapshot(): PerfSnapshot {
    return this.collect()
  }

  cleanup(): void {
    this.stop()
  }

  private ensureLogDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  private collect(): PerfSnapshot {
    const now = Date.now()
    const mem = process.memoryUsage()
    const cpuUsage = process.cpuUsage()

    // Calculate CPU % since last sample
    let cpuPercent = 0
    if (this.prevCpuUsage && this.prevCpuTimestamp) {
      const elapsed = (now - this.prevCpuTimestamp) * 1000 // to microseconds
      if (elapsed > 0) {
        const userDelta = cpuUsage.user - this.prevCpuUsage.user
        const systemDelta = cpuUsage.system - this.prevCpuUsage.system
        cpuPercent = ((userDelta + systemDelta) / elapsed) * 100
      }
    }
    this.prevCpuUsage = cpuUsage
    this.prevCpuTimestamp = now

    // Collect metrics from registered collectors
    const collectors = this.collectors
    const scriptStats = collectors?.getScriptStats() ?? { active: 0, totalOpened: 0, totalClosed: 0 }

    // Event loop lag measurement is async; use last measured value
    const eventLoopLag = this.measureEventLoopLagSync()

    // Active handles/requests (Node.js internals)
    const activeHandles = (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })
      ._getActiveHandles?.()?.length ?? -1
    const activeRequests = (process as NodeJS.Process & { _getActiveRequests?: () => unknown[] })
      ._getActiveRequests?.()?.length ?? -1

    return {
      timestamp: new Date(now).toISOString(),
      uptimeMs: process.uptime() * 1000,
      cpu: {
        userMs: Math.round(cpuUsage.user / 1000),
        systemMs: Math.round(cpuUsage.system / 1000),
        percentSinceLastSample: Math.round(cpuPercent * 100) / 100
      },
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers
      },
      processes: {
        ptyActive: collectors?.getPtyCount() ?? -1,
        scriptsActive: scriptStats.active,
        scriptsTotalOpened: scriptStats.totalOpened,
        scriptsTotalClosed: scriptStats.totalClosed
      },
      watchers: {
        fileTree: collectors?.getFileWatcherCount() ?? -1,
        worktree: collectors?.getWorktreeWatcherCount() ?? -1,
        branch: collectors?.getBranchWatcherCount() ?? -1
      },
      sessions: {
        active: collectors?.getActiveSessionCount() ?? -1
      },
      handles: {
        active: activeHandles,
        requests: activeRequests
      },
      eventLoopLagMs: eventLoopLag
    }
  }

  private measureEventLoopLagSync(): number {
    // Simple hrtime-based measurement: time a setImmediate round-trip won't work synchronously.
    // Instead, measure how long a synchronous operation takes compared to expected.
    // For a proper async lag, we use a running average updated each interval.
    // For now, return -1 and update via the async method.
    return this.lastEventLoopLag
  }

  private lastEventLoopLag = 0

  private measureEventLoopLagAsync(): void {
    const start = process.hrtime.bigint()
    setTimeout(() => {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6 // ms
      // setTimeout(0) should fire in ~1ms; anything above is lag
      this.lastEventLoopLag = Math.round((elapsed - 1) * 100) / 100
    }, 0)
  }

  private collectAndLog(): void {
    // Measure event loop lag for next snapshot
    this.measureEventLoopLagAsync()

    const snapshot = this.collect()

    // Rotate if needed
    this.rotateIfNeeded()

    // Write JSONL line
    try {
      appendFileSync(this.logFile, JSON.stringify(snapshot) + '\n')
    } catch (err) {
      log.error(
        'Failed to write perf diagnostics',
        err instanceof Error ? err : new Error(String(err))
      )
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.logFile)) return
      const stats = statSync(this.logFile)
      if (stats.size < MAX_LOG_SIZE) return

      // Rotate: rename current to .1, .1 to .2, etc.
      for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
        const from = `${this.logFile}.${i}`
        const to = `${this.logFile}.${i + 1}`
        if (existsSync(from)) {
          try {
            renameSync(from, to)
          } catch {
            // ignore
          }
        }
      }
      renameSync(this.logFile, `${this.logFile}.1`)
    } catch {
      // ignore rotation errors
    }
  }
}

export const perfDiagnostics = new PerfDiagnosticsService()
