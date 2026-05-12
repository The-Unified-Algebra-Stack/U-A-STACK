import { Json } from "../serialization/canonical-json"

export interface ReducerContext {
  readonly timestamp: number
}

export interface Reducer<
  TState extends Json,
  TEvent extends Json
> {
  reduce(
    state: TState,
    event: TEvent,
    context: ReducerContext
  ): TState
}
