/**
 * §3 offline queue: when the network drops, the punch — selfie included — is
 * stored in IndexedDB with the device timestamp and replayed on reconnect with
 * `queuedOffline: true`, which the server turns into the OFFLINE_SYNCED flag
 * plus the visible sync delay. Raw IndexedDB, no wrapper dependency.
 */

const DB_NAME = "attendance"
const STORE = "punch-queue"

export interface QueuedPunch {
  id: string
  body: Record<string, unknown>
  queuedAt: string
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE, mode)
    const request = run(transaction.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const enqueuePunch = (item: QueuedPunch) =>
  withStore("readwrite", (store) => store.put(item))

export const queuedPunches = () =>
  withStore<QueuedPunch[]>("readonly", (store) => store.getAll() as IDBRequest<QueuedPunch[]>)

export const removeQueued = (id: string) =>
  withStore("readwrite", (store) => store.delete(id))

export const queuedCount = () => withStore<number>("readonly", (store) => store.count())

/**
 * Replay everything, oldest first. Items that fail with a network error stay
 * queued; anything the server answers — even a 4xx — leaves the queue, because
 * a punch the server has ruled on must not replay forever.
 */
export async function flushQueue(
  post: (body: Record<string, unknown>) => Promise<unknown>
): Promise<{ sent: number; kept: number }> {
  const items = (await queuedPunches()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
  let sent = 0
  for (const item of items) {
    try {
      await post({ ...item.body, queuedOffline: true })
      await removeQueued(item.id)
      sent += 1
    } catch (error) {
      if ((error as { status?: number }).status !== undefined) {
        await removeQueued(item.id)
      }
      // Network failure: stop — the connection is still down.
      else break
    }
  }
  const kept = (await queuedPunches()).length
  return { sent, kept }
}
