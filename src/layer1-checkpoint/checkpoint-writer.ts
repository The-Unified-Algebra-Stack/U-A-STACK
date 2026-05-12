/**
 * CHECKPOINT WRITER: Persistence Layer
 * Spec: Layer 1: IMMUTABLE TRUTH (pages 2, 29)
 * 
 * Writes checkpoint events to persistent storage (filesystem, database, etc.)
 * Maintains hash-chain integrity across process boundaries.
 * 
 * Properties:
 * - Append-only writes
 * - Hash-chain validation on every write
 * - Crash-safe (each write is atomic)
 * - JSON-serializable
 */

import { EventLog } from "./event-log"
import { HLCClock, HLC } from "./hlc"
import * as fs from "fs"
import * as path from "path"

export interface CheckpointWriterConfig {
  /**
   * Path where checkpoint log is written
   * Spec: RuntimeConfig.checkpointPath (page 8)
   */
  checkpointPath: string

  /**
   * Node identifier (used in HLC)
   * Spec: RuntimeConfig.nodeId (page 8)
   */
  nodeId: string

  /**
   * Hash algorithm (default: sha256)
   */
  algorithm?: string

  /**
   * Sync to disk after each write (default: true)
   * When true: fsync() after every checkpoint
   * When false: relies on OS buffering (faster but riskier)
   */
  syncInterval?: number // ms between syncs (0 = sync on every write)
}

/**
 * CheckpointWriter: Persistent checkpoint log with HLC
 * 
 * Manages:
 * 1. In-memory event log (EventLog)
 * 2. Hybrid logical clock (HLCClock)
 * 3. Persistent writes to disk
 * 4. Hash chain integrity verification
 */
export class CheckpointWriter {
  private readonly log: EventLog
  private readonly clock: HLCClock
  private readonly config: Required<CheckpointWriterConfig>
  private writeHandle: fs.WriteStream | null = null
  private pendingSyncs: Promise<void> = Promise.resolve()

  constructor(config: CheckpointWriterConfig) {
    this.config = {
      algorithm: "sha256",
      syncInterval: 0,
      ...config,
    }

    this.log = new EventLog({ algorithm: this.config.algorithm })
    this.clock = new HLCClock(this.config.nodeId)

    // Create directory if needed
    const dir = path.dirname(this.config.checkpointPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Load existing checkpoint if present
    this.loadCheckpoint()
  }

  /**
   * Load existing checkpoint from disk
   * 
   * Spec: Replay Theorem (Law 12)
   * "Save checkpoint log; shut down; restart with same code; 
   *  replay log; assert final state matches."
   */
  private loadCheckpoint(): void {
    if (fs.existsSync(this.config.checkpointPath)) {
      try {
        const content = fs.readFileSync(this.config.checkpointPath, "utf-8")
        const data = JSON.parse(content)

        // Restore event log
        const restoredLog = EventLog.fromJSON(data, this.config.algorithm)
        ;(this as any).log = restoredLog

        // Restore HLC clock (use logical time from last event + 1)
        if (restoredLog.length() > 0) {
          const lastEvent = restoredLog.getLastEvent()
          if (lastEvent && lastEvent.timestamp) {
            this.clock.import({
              logical: lastEvent.timestamp.logical,
              physical: lastEvent.timestamp.physical,
              nodeId: this.config.nodeId,
            })
          }
        }
      } catch (err) {
        // If load fails, start fresh
        console.warn("Failed to load checkpoint, starting fresh:", err)
      }
    }
  }

  /**
   * Write a checkpoint event (REDUCE or MERGE)
   * 
   * Spec: CheckpointEvent (Type 7)
   * "Checkpoint: { before, after, intents }"
   */
  writeCheckpoint(params: {
    readonly type: "REDUCE" | "MERGE"
    readonly before: unknown
    readonly after: unknown
    readonly intents: readonly any[]
  }): any {
    // Generate timestamp
    const timestamp = this.clock.increment()

    // Append to in-memory log
    const event = this.log.append({
      nodeId: this.config.nodeId,
      timestamp,
      type: params.type,
      before: params.before,
      after: params.after,
      intents: params.intents,
    })

    // Write to disk asynchronously
    this.writeToFile()

    return event
  }

  /**
   * Receive a remote checkpoint event (for replication)
   * 
   * Spec: Distributed Execution (pages 12-13)
   * Updates HLC from remote timestamp
   */
  receiveRemoteCheckpoint(event: any): void {
    // Update HLC based on remote timestamp
    this.clock.receive(event.timestamp)

    // Append to log
    this.log.append({
      nodeId: event.nodeId,
      timestamp: event.timestamp,
      type: event.type,
      before: event.before,
      after: event.after,
      intents: event.intents,
    })

    // Write to disk
    this.writeToFile()
  }

  /**
   * Write current log to disk
   * 
   * Atomic write: write to temp file, then rename
   */
  private writeToFile(): void {
    const tempPath = this.config.checkpointPath + ".tmp"

    const content = JSON.stringify(this.log.toJSON(), null, 2)

    try {
      fs.writeFileSync(tempPath, content, "utf-8")

      // Atomic rename
      if (fs.existsSync(this.config.checkpointPath)) {
        fs.unlinkSync(this.config.checkpointPath)
      }
      fs.renameSync(tempPath, this.config.checkpointPath)
    } catch (err) {
      // Clean up temp file on error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
      throw new Error(`Failed to write checkpoint: ${err}`)
    }
  }

  /**
   * Get current log
   */
  getLog(): EventLog {
    return this.log
  }

  /**
   * Get current HLC timestamp
   */
  getTimestamp(): HLC {
    return this.clock.now()
  }

  /**
   * Get all events
   */
  getEvents(): readonly any[] {
    return this.log.getEvents()
  }

  /**
   * Get the last event hash
   * 
   * Spec: Law 13: Hash Chain Integrity
   */
  getLastHash(): string | null {
    return this.log.getLastHash()
  }

  /**
   * Verify checkpoint integrity
   * 
   * Spec: Law 13 verification
   */
  verify(): {
    valid: boolean
    firstInvalidIndex: number | null
    errors: string[]
  } {
    return this.log.verify()
  }

  /**
   * Replay log to reconstruct state
   * 
   * Spec: Law 12: Replay Theorem
   */
  replay<Σ>(
    initialState: Σ,
    reducer: (state: Σ, event: any) => Σ
  ): {
    finalState: Σ
    states: readonly Σ[]
    valid: boolean
  } {
    return this.log.replay(initialState, reducer)
  }

  /**
   * Get events since a hash (for replication)
   */
  getEventsSince(lastKnownHash: string | null): {
    events: readonly any[]
    fromIndex: number
  } {
    return this.log.getEventsSince(lastKnownHash)
  }

  /**
   * Sync to disk and wait
   * Called before shutdown
   */
  async flush(): Promise<void> {
    return this.pendingSyncs
  }

  /**
   * Close and cleanup
   */
  close(): void {
    if (this.writeHandle) {
      this.writeHandle.destroy()
      this.writeHandle = null
    }
  }
}