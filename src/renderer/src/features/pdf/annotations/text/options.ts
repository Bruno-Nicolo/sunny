import type { TextFontFamily } from './types'

export const textColors = [
  { name: 'Black', value: '#000000' },
  { name: 'Gray', value: '#6B7280' },
  { name: 'Red', value: '#FF0000' },
  { name: 'Green', value: '#16A34A' },
  { name: 'Blue', value: '#2563EB' },
  { name: 'Purple', value: '#9333EA' }
] as const

export const textFonts: Record<TextFontFamily, { label: string; css: string }> = {
  serif: { label: 'Serif', css: '"Times New Roman", Times, serif' },
  'sans-serif': { label: 'Sans serif', css: 'Helvetica, Arial, sans-serif' },
  monospace: { label: 'Monospace', css: 'Courier, "Courier New", monospace' }
}

export const defaultTextStyle = {
  color: '#000000',
  fontSize: 8,
  fontFamily: 'sans-serif',
  textAlign: 'left'
} as const
