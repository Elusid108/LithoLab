/** Sanitize a lithophane name for download filenames. */
export function safeFileName(name: string, fallback = 'Lithophane'): string {
  const cleaned = name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

export function extForImageBlob(blob: Blob): 'jpg' | 'png' | 'webp' {
  const t = blob.type.toLowerCase()
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  if (t.includes('webp')) return 'webp'
  return 'png'
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}
