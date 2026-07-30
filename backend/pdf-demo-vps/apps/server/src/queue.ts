/** In-process job queue, concurrency-limited (default 2 = max parallel Chromium instances).
 * Isolated so it can be swapped for BullMQ+Redis when the demo scales out. */
export class JobQueue {
  private running = 0;
  private waiting: Array<{ run: () => Promise<void>; onPosition: (n: number) => void }> = [];

  constructor(private concurrency = 2) {}

  get queueLength(): number { return this.waiting.length; }

  enqueue(run: () => Promise<void>, onPosition: (n: number) => void = () => {}): void {
    this.waiting.push({ run, onPosition });
    this.notifyPositions();
    void this.pump();
  }

  private notifyPositions(): void {
    this.waiting.forEach((w, i) => w.onPosition(i + 1));
  }

  private async pump(): Promise<void> {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const item = this.waiting.shift()!;
      this.notifyPositions();
      this.running++;
      item.run().catch(() => {}).finally(() => {
        this.running--;
        void this.pump();
      });
    }
  }
}
