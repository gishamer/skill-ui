import type { IpcResult } from '@shared/types'

/** The preload-exposed API. */
export const api = window.api

/** Unwrap an IpcResult, throwing a friendly Error on failure. */
export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const res = await p
  if (!res.ok) throw new Error(res.error)
  return res.data
}
