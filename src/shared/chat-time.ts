const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric'
})
const datedYearFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})

function localDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Formats a message time using calendar-relative labels in the user's local timezone. */
export function formatChatMessageTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp)
  const current = new Date(now)
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) return ''

  const daysAgo = (localDayNumber(current) - localDayNumber(date)) / 86_400_000
  const time = timeFormatter.format(date)
  if (daysAgo === 0) return `Today ${time}`
  if (daysAgo === 1) return `Yesterday ${time}`
  if (daysAgo > 1 && daysAgo < 7) return `${weekdayFormatter.format(date)} ${time}`

  const formatter =
    date.getFullYear() === current.getFullYear() ? dateFormatter : datedYearFormatter
  return `${formatter.format(date)}, ${time}`
}

/** Provides the full local date for the timestamp tooltip. */
export function formatChatMessageTimeTitle(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(date)
}
