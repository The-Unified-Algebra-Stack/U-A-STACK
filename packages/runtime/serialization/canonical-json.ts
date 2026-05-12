export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json }

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, Json>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, Json>)[key])
        return acc
      }, {})
  }

  return value
}

export function canonicalize(value: Json): string {
  return JSON.stringify(sortKeys(value))
}
