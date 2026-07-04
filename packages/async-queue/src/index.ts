/**
 * @md4lp/async-queue — a single-lane async mutex (D18 single-writer primitive).
 *
 * Runs submitted async functions one at a time, in submission order. This makes a multi-step
 * read-modify-write sequence atomic within one process: while one `run()` is in flight, the next
 * waits, so two concurrent callers cannot both read the same state and have the second clobber the
 * first (lost update). Used by `@md4lp/repo` (serialize git ops) and `@md4lp/comments` (serialize
 * sidecar RMW); both depend on this single implementation rather than duplicating it.
 *
 * A failed task does NOT stall the lane: the next task still runs (the failure is delivered only to
 * that task's caller via the returned promise).
 */
export class AsyncQueue {
  private tail: Promise<unknown> = Promise.resolve()

  /** Enqueue `fn`; it starts once all previously-enqueued tasks have settled. Returns its result. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    // Chain off the tail with the SAME callback for both fulfil and reject, so a prior failure does
    // not prevent this task from starting.
    const result = this.tail.then(fn, fn)
    // Advance the tail, swallowing the result so one task's rejection can't break the chain.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
