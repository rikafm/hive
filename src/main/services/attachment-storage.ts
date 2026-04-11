import { app } from 'electron'
import { join, resolve } from 'path'
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { createLogger } from './logger'

const log = createLogger({ component: 'AttachmentStorage' })

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

function getAttachmentsDir(): string {
  const dir = join(app.getPath('home'), '.hive', 'attachments')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function saveAttachment(
  buffer: Buffer,
  originalName: string
): { success: boolean; filePath?: string; error?: string } {
  try {
    if (buffer.length > MAX_IMAGE_SIZE) {
      return { success: false, error: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` }
    }

    const ext = originalName.split('.').pop()?.toLowerCase() ?? 'png'
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { success: false, error: `Unsupported image format: .${ext}` }
    }

    const dir = getAttachmentsDir()
    const fileName = `${randomUUID()}.${ext}`
    const filePath = join(dir, fileName)

    writeFileSync(filePath, buffer)
    log.info('Saved attachment', { filePath, size: buffer.length })

    return { success: true, filePath }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    log.error('Failed to save attachment', new Error(msg))
    return { success: false, error: msg }
  }
}

export function deleteAttachment(filePath: string): { success: boolean; error?: string } {
  try {
    // Safety: only delete files inside the attachments directory
    const dir = resolve(getAttachmentsDir())
    const resolved = resolve(filePath)
    if (!resolved.startsWith(dir)) {
      return { success: false, error: 'Path is not inside attachments directory' }
    }
    if (existsSync(resolved)) {
      unlinkSync(resolved)
      log.info('Deleted attachment', { filePath: resolved })
    }
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    log.error('Failed to delete attachment', new Error(msg))
    return { success: false, error: msg }
  }
}
