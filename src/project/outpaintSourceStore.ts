const DB_NAME = 'litholab-outpaint'
const DB_VERSION = 1
const STORE = 'source'
const RECORD_ID = 'current'

interface OutpaintSourceRecord {
  id: string
  blob: Blob
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open extend-source storage'))
  })
}

export async function saveOutpaintSourceBlob(blob: Blob): Promise<void> {
  const db = await openDb()
  const record: OutpaintSourceRecord = { id: RECORD_ID, blob }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(record)
    req.onerror = () => reject(req.error ?? new Error('Failed to save extend source'))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save extend source'))
    tx.onabort = () => reject(tx.error ?? new Error('Extend source save aborted'))
  })
}

export async function loadOutpaintSourceBlob(): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(RECORD_ID)
    req.onsuccess = () => {
      const rec = req.result as OutpaintSourceRecord | undefined
      resolve(rec?.blob ?? null)
    }
    req.onerror = () => reject(req.error ?? new Error('Failed to read extend source'))
  })
}

export async function deleteOutpaintSourceBlob(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete extend source'))
    tx.objectStore(STORE).delete(RECORD_ID)
  })
}
