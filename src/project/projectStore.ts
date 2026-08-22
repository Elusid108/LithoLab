const DB_NAME = 'litholab'
const DB_VERSION = 1
const STORE = 'library'

export interface LibraryRecord {
  id: string
  name: string
  createdAt: number
  thumbnail: Blob
  litholabZip: Blob
}

export interface LibraryListItem {
  id: string
  name: string
  createdAt: number
  thumbnail: Blob
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
  })
}

export function isQuotaError(e: unknown): boolean {
  if (e instanceof DOMException) {
    return e.name === 'QuotaExceededError' || e.code === 22
  }
  return false
}

export async function addLibraryEntry(
  entry: Omit<LibraryRecord, 'id'> & { id?: string },
): Promise<string> {
  const id = entry.id ?? crypto.randomUUID()
  const record: LibraryRecord = {
    id,
    name: entry.name,
    createdAt: entry.createdAt,
    thumbnail: entry.thumbnail,
    litholabZip: entry.litholabZip,
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(record)
    req.onerror = () => reject(req.error ?? new Error('Failed to save library entry'))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save library entry'))
    tx.onabort = () => reject(tx.error ?? new Error('Library save aborted'))
  })
  return id
}

export async function listLibrary(): Promise<LibraryListItem[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index('createdAt')
    const req = index.openCursor(null, 'prev')
    const items: LibraryListItem[] = []
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        const v = cursor.value as LibraryRecord
        items.push({
          id: v.id,
          name: v.name,
          createdAt: v.createdAt,
          thumbnail: v.thumbnail,
        })
        cursor.continue()
      } else {
        resolve(items)
      }
    }
    req.onerror = () => reject(req.error ?? new Error('Failed to list library'))
  })
}

export async function getLibraryZip(id: string): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => {
      const rec = req.result as LibraryRecord | undefined
      resolve(rec?.litholabZip ?? null)
    }
    req.onerror = () => reject(req.error ?? new Error('Failed to read library entry'))
  })
}

export async function deleteLibraryEntry(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete library entry'))
    tx.objectStore(STORE).delete(id)
  })
}
