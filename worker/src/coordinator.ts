import app from "./app";
import { cleanObjects, stepJob } from "./lib/maintenance";
import { SerialQueue } from "./lib/serial";
import type { Bindings } from "./types";

export class LibraryCoordinator {
  private queue = new SerialQueue();
  constructor(
    private ctx: DurableObjectState,
    private env: Bindings,
  ) {}
  fetch(request: Request): Promise<Response> {
    return this.queue.run(async () => {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return app.fetch(request, this.env);
    });
  }
  alarm(): Promise<void> {
    return this.queue.run(async () => {
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      try {
        const work =
          (await cleanObjects(this.env)) || (await stepJob(this.env));
        if (work) await this.ctx.storage.setAlarm(Date.now() + 1000);
        else await this.ctx.storage.deleteAlarm();
      } catch (error) {
        console.error("Library cleanup will retry", error);
      }
    });
  }
}
