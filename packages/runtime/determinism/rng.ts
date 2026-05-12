export interface DeterministicRng {
  next(): number
}

export class SeededRng implements DeterministicRng {
  constructor(private seed: number) {}

  next(): number {
    this.seed = (1664525 * this.seed + 1013904223) % 4294967296

    return this.seed / 4294967296
  }
}
