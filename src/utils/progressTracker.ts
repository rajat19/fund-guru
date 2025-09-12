/**
 * Progress Tracker Utility
 * 
 * Provides consistent progress tracking and reporting across different operations
 */

export interface ProgressOptions {
  reportInterval?: number;
  showPercentage?: boolean;
  prefix?: string;
}

export class ProgressTracker {
  private options: Required<ProgressOptions>;
  private lastReported = 0;

  constructor(options: ProgressOptions = {}) {
    this.options = {
      reportInterval: options.reportInterval ?? 50,
      showPercentage: options.showPercentage ?? true,
      prefix: options.prefix ?? 'Progress',
    };
  }

  /**
   * Report progress if it meets the reporting criteria
   */
  report(processed: number, total: number, force = false): void {
    const shouldReport = force || 
      processed === total || 
      processed % this.options.reportInterval === 0 ||
      processed === 1; // Always report first item

    if (!shouldReport) return;

    const percentage = Math.round((processed / total) * 100);
    let message = `${this.options.prefix}: ${processed}/${total}`;
    
    if (this.options.showPercentage) {
      message += ` (${percentage}%)`;
    }

    console.log(message);
    this.lastReported = processed;
  }

  /**
   * Create a progress callback function
   */
  createCallback(): (processed: number, total: number) => void {
    return (processed: number, total: number) => {
      this.report(processed, total);
    };
  }

  /**
   * Reset the tracker for a new operation
   */
  reset(): void {
    this.lastReported = 0;
  }
}

/**
 * Create a simple progress callback with default settings
 */
export function createProgressCallback(prefix = 'Progress', interval = 50): (processed: number, total: number) => void {
  const tracker = new ProgressTracker({ prefix, reportInterval: interval });
  return tracker.createCallback();
}
