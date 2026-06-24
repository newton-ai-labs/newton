import {
  File,
  FileCode,
  FileJson,
  FileText,
  Braces,
  Hash,
  Coffee,
  Binary,
  Image as ImageIcon,
  Settings,
  Database,
  Terminal,
  FileType,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Icon = LucideIcon

export function fileIcon(name: string): Icon {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const lower = name.toLowerCase()
  if (lower === 'dockerfile' || ext === 'dockerfile') return Binary
  if (lower.startsWith('.env') || lower === '.gitignore' || lower === '.dockerignore') return Settings
  if (lower === 'package.json' || ext === 'lock') return FileJson
  if (ext === 'json') return Braces
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return FileText
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return FileCode
  if (['py'].includes(ext)) return FileCode
  if (['rb'].includes(ext)) return FileCode
  if (['go', 'rs', 'c', 'cpp', 'h'].includes(ext)) return Hash
  if (['java', 'kt'].includes(ext)) return Coffee
  if (['css', 'scss', 'sass'].includes(ext)) return Hash
  if (['html', 'xml', 'vue', 'svelte'].includes(ext)) return FileCode
  if (['sh', 'bash', 'zsh'].includes(ext)) return Terminal
  if (['sql'].includes(ext)) return Database
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return ImageIcon
  if (['yml', 'yaml', 'toml', 'ini'].includes(ext)) return Settings
  return File
}

export function fileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const lower = name.toLowerCase()
  if (lower === 'package.json') return 'var(--red)'
  if (['ts', 'tsx'].includes(ext)) return 'var(--blue)'
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'var(--yellow)'
  if (ext === 'json') return 'var(--yellow)'
  if (ext === 'py') return 'var(--blue)'
  if (ext === 'css' || ext === 'scss') return 'var(--blue)'
  if (ext === 'html') return 'var(--orange)'
  if (ext === 'md') return 'var(--text-dim)'
  if (ext === 'sql') return 'var(--pink)'
  if (['yml', 'yaml'].includes(ext)) return 'var(--green)'
  if (['png', 'jpg', 'svg'].includes(ext)) return 'var(--pink)'
  return 'var(--text-dim)'
}

export { FileType }