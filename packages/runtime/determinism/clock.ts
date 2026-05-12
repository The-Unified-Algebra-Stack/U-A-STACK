export interface DeterministicClock {
  now(): number
}

export class ReplayClock implements DeterministicClock {
  private current: number

  constructor(start = 0) {
    this.current = start
  }

  now(): number {
    return this.current++
  }
}
