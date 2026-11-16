import { translate } from '../../i18n/index.js'
import type { Locale } from '../settings.js'
import type { SessionSummary } from './types.js'

const DAY = 86_400_000

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

const formatMonthLabel = (time: number, locale: Locale): { key: string; label: string } => {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) {
    return { key: '', label: '' }
  }
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const key = `${year}-${String(month).padStart(2, '0')}`
  const label =
    locale === 'zh-CN'
      ? `${year}年${month}月`
      : new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short' }).format(date)
  return { key, label }
}

export type SessionGroup = {
  key: string
  label: string
  pinned?: boolean
  sessions: SessionSummary[]
}

/** 分组：置顶 / 今天 / 7 天内 / 30 天内 / 按月（2026年10月） */
export const groupSessions = (
  sessions: SessionSummary[],
  now: number,
  t = translate,
  locale: Locale = 'zh-CN'
): SessionGroup[] => {
  const pinned: SessionSummary[] = []
  const groups: SessionGroup[] = []

  for (const session of sessions) {
    if (session.pinned) {
      pinned.push(session)
      continue
    }
    const diff = Math.floor((now - startOfDay(session.updatedAt)) / DAY)
    const key =
      diff <= 0
        ? 'sessionHistoryTimelineLabelToday'
        : diff < 7
          ? 'sessionHistoryTimelineLabel7days'
          : diff < 30
            ? 'sessionHistoryTimelineLabel30days'
            : null
    const month = key ? null : formatMonthLabel(session.updatedAt, locale)
    const groupKey = key ?? month?.key ?? ''
    const label = key ? t(key) : (month?.label ?? '')
    const last = groups.at(-1)
    if (last?.key === groupKey) {
      last.sessions.push(session)
    } else {
      groups.push({ key: groupKey, label, sessions: [session] })
    }
  }

  if (pinned.length > 0) {
    return [{ key: 'pinned', label: t('pinnedSection'), pinned: true, sessions: pinned }, ...groups]
  }
  return groups
}
