/* Worker pool.

   The crawl used to run fixed batches: Promise.all over six folders, then the
   next six. Because the upstream latency tail is long (p50 1.7s but p90 9.8s),
   every batch stalled on its slowest member while the other five slots idled.
   Measured slot utilisation was 51-58%.

   A pool keeps all slots fed from a shared queue instead. On the Doraemon tree
   it came out ~1.15x faster; the gain is modest there only because the tree is
   shallow, so the queue frequently runs dry. On a wider tree the same code has
   more to chew on. */

/**
 * @param {number} limit          how many jobs may run at once
 * @param {() => any|null} next   pull the next job, or null when none is ready
 * @param {(job:any) => Promise}  run
 * @param {() => boolean} [stop]  abort check, consulted before each dispatch
 */
export function runPool(limit, next, run, stop) {
  return new Promise((resolve) => {
    let active = 0;
    let done = false;

    const pump = () => {
      if (done) return;

      if (stop && stop()) {
        // Let in-flight work settle, but dispatch nothing more.
        if (active === 0) { done = true; resolve(); }
        return;
      }

      while (active < limit) {
        const job = next();
        if (job === null || job === undefined) break;
        active++;
        Promise.resolve()
          .then(() => run(job))
          .catch(() => { /* run() owns its own error reporting */ })
          .then(() => { active--; pump(); });
      }

      // Nothing running and nothing to start means the queue is genuinely done.
      if (active === 0) { done = true; resolve(); }
    };

    pump();
  });
}
