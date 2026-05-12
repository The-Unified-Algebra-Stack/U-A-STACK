import { deterministicHash } from "../serialization/hash"

describe("deterministic replay", () => {
  it("produces identical hashes for identical logs", () => {
    const stateA = {
      count: 3
    }

    const stateB = {
      count: 3
    }

    const hashA = deterministicHash(stateA)
    const hashB = deterministicHash(stateB)

    expect(hashA).toBe(hashB)
  })
})
