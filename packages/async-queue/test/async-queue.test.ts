import { describe, it, expect } from 'vitest'
import { AsyncQueue } from '../src/index'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('AsyncQueue', () => {
  it('runs tasks one at a time (never overlapping)', async () => {
    const q = new AsyncQueue()
    let active = 0
    let maxActive = 0
    const task = () =>
      q.run(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await tick(5)
        active--
      })
    await Promise.all([task(), task(), task(), task()])
    expect(maxActive).toBe(1)
  })

  it('preserves submission order', async () => {
    const q = new AsyncQueue()
    const order: number[] = []
    // submit fast-then-slow to prove ordering is by submission, not by completion speed
    const a = q.run(async () => {
      await tick(10)
      order.push(1)
    })
    const b = q.run(async () => {
      order.push(2)
    })
    await Promise.all([a, b])
    expect(order).toEqual([1, 2])
  })

  it('returns each task its own resolved value', async () => {
    const q = new AsyncQueue()
    const [a, b] = await Promise.all([q.run(async () => 'a'), q.run(async () => 'b')])
    expect([a, b]).toEqual(['a', 'b'])
  })

  it('a rejected task does not stall the lane (next task still runs)', async () => {
    const q = new AsyncQueue()
    const failed = q.run(async () => {
      throw new Error('boom')
    })
    const after = q.run(async () => 'ok')
    await expect(failed).rejects.toThrow('boom')
    await expect(after).resolves.toBe('ok')
  })
})
