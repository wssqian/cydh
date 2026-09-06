import { EventEmitter } from 'events';
import os from 'os';

export interface PerformanceMetrics {
  timestamp: Date;
  memoryUsage: {
    rss: number; // Resident Set Size
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  cpuUsage: {
    user: number;
    system: number;
    elapsedMs: number;
  };
  systemMemory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  jobMetrics?: {
    jobDurationMs: number;
    rankingsProcessed: number;
    highlightsProcessed: number;
    pagesProcessed: number;
    errorsCount: number;
  };
}

export interface PerformanceAlert {
  type: 'memory' | 'cpu' | 'duration' | 'error';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
}

const MEMORY_WARNING_THRESHOLD_MB = 200;
const MEMORY_CRITICAL_THRESHOLD_MB = 400;
const CPU_WARNING_THRESHOLD_PERCENT = 80;
const CPU_CRITICAL_THRESHOLD_PERCENT = 95;
const JOB_DURATION_WARNING_MS = 60000; // 1 minute
const JOB_DURATION_CRITICAL_MS = 120000; // 2 minutes

class ACGBoxPerformanceMonitor extends EventEmitter {
  private metrics: PerformanceMetrics[] = [];
  private maxMetricsHistory: number = 50;
  private alerts: PerformanceAlert[] = [];
  private maxAlertsHistory: number = 20;
  private lastCpuUsage: { user: number; system: number } | null = null;
  private lastCpuSampleAt: number | null = null;
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
  }

  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    console.log(`[ACGBox Monitor] Starting performance monitoring with ${intervalMs / 1000}s interval.`);

    // Take initial snapshot
    this.collectMetrics();

    // Set up periodic monitoring
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[ACGBox Monitor] Performance monitoring stopped.');
    }
  }

  collectMetrics(jobMetrics?: PerformanceMetrics['jobMetrics']): PerformanceMetrics {
    const now = Date.now();
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage || undefined);
    const elapsedMs = this.lastCpuSampleAt === null ? 0 : Math.max(1, now - this.lastCpuSampleAt);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = now;

    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    const metrics: PerformanceMetrics = {
      timestamp: new Date(),
      memoryUsage: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers,
      },
      cpuUsage: {
        user: cpuUsage.user / 1000000, // Convert microseconds to seconds
        system: cpuUsage.system / 1000000,
        elapsedMs,
      },
      systemMemory: {
        total: totalMemory,
        free: freeMemory,
        used: usedMemory,
        usagePercent: (usedMemory / totalMemory) * 100,
      },
      jobMetrics,
    };

    // Store metrics
    this.metrics.push(metrics);
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics.shift();
    }

    // Check for alerts
    this.checkAlerts(metrics);

    return metrics;
  }

  private checkAlerts(metrics: PerformanceMetrics): void {
    const heapUsedMB = metrics.memoryUsage.heapUsed / (1024 * 1024);
    const rssUsedMB = metrics.memoryUsage.rss / (1024 * 1024);

    // Check memory usage
    if (rssUsedMB > MEMORY_CRITICAL_THRESHOLD_MB) {
      this.addAlert({
        type: 'memory',
        severity: 'critical',
        message: `Memory usage critical: ${rssUsedMB.toFixed(2)}MB RSS`,
        value: rssUsedMB,
        threshold: MEMORY_CRITICAL_THRESHOLD_MB,
        timestamp: new Date(),
      });
    } else if (rssUsedMB > MEMORY_WARNING_THRESHOLD_MB) {
      this.addAlert({
        type: 'memory',
        severity: 'warning',
        message: `Memory usage high: ${rssUsedMB.toFixed(2)}MB RSS`,
        value: rssUsedMB,
        threshold: MEMORY_WARNING_THRESHOLD_MB,
        timestamp: new Date(),
      });
    }

    // Check system CPU usage
    const cpuPercent = metrics.cpuUsage.elapsedMs > 0
      ? ((metrics.cpuUsage.user + metrics.cpuUsage.system) * 1000 / metrics.cpuUsage.elapsedMs) * 100
      : 0;
    if (cpuPercent > CPU_CRITICAL_THRESHOLD_PERCENT) {
      this.addAlert({
        type: 'cpu',
        severity: 'critical',
        message: `CPU usage critical: ${cpuPercent.toFixed(2)}%`,
        value: cpuPercent,
        threshold: CPU_CRITICAL_THRESHOLD_PERCENT,
        timestamp: new Date(),
      });
    } else if (cpuPercent > CPU_WARNING_THRESHOLD_PERCENT) {
      this.addAlert({
        type: 'cpu',
        severity: 'warning',
        message: `CPU usage high: ${cpuPercent.toFixed(2)}%`,
        value: cpuPercent,
        threshold: CPU_WARNING_THRESHOLD_PERCENT,
        timestamp: new Date(),
      });
    }

    // Check job duration
    if (metrics.jobMetrics) {
      if (metrics.jobMetrics.jobDurationMs > JOB_DURATION_CRITICAL_MS) {
        this.addAlert({
          type: 'duration',
          severity: 'critical',
          message: `Job duration critical: ${(metrics.jobMetrics.jobDurationMs / 1000).toFixed(2)}s`,
          value: metrics.jobMetrics.jobDurationMs,
          threshold: JOB_DURATION_CRITICAL_MS,
          timestamp: new Date(),
        });
      } else if (metrics.jobMetrics.jobDurationMs > JOB_DURATION_WARNING_MS) {
        this.addAlert({
          type: 'duration',
          severity: 'warning',
          message: `Job duration warning: ${(metrics.jobMetrics.jobDurationMs / 1000).toFixed(2)}s`,
          value: metrics.jobMetrics.jobDurationMs,
          threshold: JOB_DURATION_WARNING_MS,
          timestamp: new Date(),
        });
      }

      // Check error count
      if (metrics.jobMetrics.errorsCount > 0) {
        this.addAlert({
          type: 'error',
          severity: metrics.jobMetrics.errorsCount >= 3 ? 'critical' : 'warning',
          message: `Job encountered ${metrics.jobMetrics.errorsCount} error(s)`,
          value: metrics.jobMetrics.errorsCount,
          threshold: 0,
          timestamp: new Date(),
        });
      }
    }
  }

  private addAlert(alert: PerformanceAlert): void {
    this.alerts.push(alert);
    if (this.alerts.length > this.maxAlertsHistory) {
      this.alerts.shift();
    }

    // Emit alert event
    this.emit('alert', alert);

    // Log alert
    const logMethod = alert.severity === 'critical' ? 'error' : 'warn';
    console[logMethod](`[ACGBox Monitor] ${alert.severity.toUpperCase()}: ${alert.message}`);
  }

  getLatestMetrics(): PerformanceMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  getMetricsHistory(count?: number): PerformanceMetrics[] {
    if (count) {
      return this.metrics.slice(-count);
    }
    return [...this.metrics];
  }

  getAlerts(count?: number): PerformanceAlert[] {
    if (count) {
      return this.alerts.slice(-count);
    }
    return [...this.alerts];
  }

  getPerformanceSummary(): {
    current: PerformanceMetrics | null;
    average: {
      memoryUsageMB: number;
      cpuUsagePercent: number;
    };
    alertsCount: {
      warning: number;
      critical: number;
    };
    uptime: number;
  } {
    const current = this.getLatestMetrics();

    // Calculate averages
    let avgMemoryMB = 0;
    let avgCpuPercent = 0;
    if (this.metrics.length > 0) {
      const totalMemory = this.metrics.reduce((sum, m) => sum + m.memoryUsage.rss, 0);
      const totalCpu = this.metrics.reduce((sum, m) => {
        if (!m.cpuUsage.elapsedMs) {
          return sum;
        }
        return sum + ((m.cpuUsage.user + m.cpuUsage.system) * 1000 / m.cpuUsage.elapsedMs) * 100;
      }, 0);
      avgMemoryMB = (totalMemory / this.metrics.length) / (1024 * 1024);
      avgCpuPercent = totalCpu / this.metrics.length;
    }

    // Count alerts by severity
    const warningAlerts = this.alerts.filter((a) => a.severity === 'warning').length;
    const criticalAlerts = this.alerts.filter((a) => a.severity === 'critical').length;

    return {
      current,
      average: {
        memoryUsageMB: Math.round(avgMemoryMB * 100) / 100,
        cpuUsagePercent: Math.round(avgCpuPercent * 100) / 100,
      },
      alertsCount: {
        warning: warningAlerts,
        critical: criticalAlerts,
      },
      uptime: process.uptime(),
    };
  }

  clearHistory(): void {
    this.metrics = [];
    this.alerts = [];
    console.log('[ACGBox Monitor] Performance history cleared.');
  }
}

// Create singleton instance
export const acgboxPerformanceMonitor = new ACGBoxPerformanceMonitor();

// Monitoring is started on-demand by acgbox-scraper-jobs.ts when a job runs,
// and stopped when the job completes. No automatic background monitoring.
export default acgboxPerformanceMonitor;
