import clsx from 'clsx'
import { memo, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { HighlightRange, SessionSearchHit } from '../../services/chat/db.js'
import { selectSession, selectSessionAtMessage } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { useSettings, type Locale } from '../../services/settings.js'
import {
  IconChatBubbleOutline18,
  IconCheckOutline16,
  IconUserOutline16,
  IconVersionSwitch12,
} from '../base/icons.js'
import { leaveMobileSearch } from './chatSearchState.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

const LONG_PRESS_MS = 420
const MOVE_CANCEL_PX = 8

const HighlightRanges = ({ text, ranges }: { text: string; ranges?: HighlightRange[] }) => {
  if (!ranges || ranges.length === 0) {
    return <>{text}</>
  }
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    const start = Math.max(cursor, Math.min(text.length, range.start))
    const end = Math.max(start, Math.min(text.length, range.end))
    if (start > cursor) {
      parts.push(text.slice(cursor, start))
    }
    if (end > start) {
      parts.push(
        <mark key={`${start}-${end}`} className={styles.highlight}>
          {text.slice(start, end)}
        </mark>
      )
    }
    cursor = end
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return <>{parts}</>
}

const formatSearchDate = (timestamp: number, now: number, locale: Locale): string => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return ''
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  if (locale === 'zh-CN') {
    const m = date.getMonth() + 1
    const d = date.getDate()
    return sameYear ? `${m}月${d}日` : `${date.getFullYear()}年${m}月${d}日`
  }
  return new Intl.DateTimeFormat(
    'en-US',
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' }
  ).format(date)
}

export const SearchHitItem = memo(function SearchHitItem({
  hit,
  title,
  active,
  now,
  locale,
}: {
  hit: SessionSearchHit
  title: string
  active: boolean
  now: number
  locale: Locale
}) {
  const t = useTranslate()
  const profile = useSettings((state) => state.profile)
  const dateLabel = formatSearchDate(hit.messageTimestamp, now, locale)

  return (
    <button
      type="button"
      data-search-hit={hit.hitKey}
      data-session-id={hit.sessionId}
      data-message-id={hit.messageId ?? ''}
      data-session-row="true"
      className={clsx(styles.searchItem, active && styles.searchItemActive)}
      onClick={() => {
        selectSessionAtMessage(hit.sessionId, hit.messageId)
        closeMobileSider()
      }}
    >
      <span className={styles.searchIconWrap} aria-hidden="true">
        <span className={styles.searchCircle}>
          <IconChatBubbleOutline18 />
        </span>
        {hit.matchKind === 'user' ? (
          profile.avatar ? (
            <img src={profile.avatar} alt="" className={styles.searchUserBadgeImg} />
          ) : (
            <span className={styles.searchUserBadge}>
              {profile.name.trim() ? (
                profile.name.trim().slice(0, 1).toUpperCase()
              ) : (
                <IconUserOutline16 />
              )}
            </span>
          )
        ) : null}
      </span>
      <span className={styles.searchBody}>
        <span className={styles.searchTopLine}>
          <span className={styles.searchTitle}>
            <HighlightRanges text={title} ranges={hit.titleHighlights} />
          </span>
          {dateLabel ? <span className={styles.searchDate}>{dateLabel}</span> : null}
        </span>
        {hit.snippet ? (
          <span className={styles.searchBottomLine}>
            {hit.versionTotal && hit.versionTotal > 1 ? (
              <span className={styles.versionBadge}>
                <IconVersionSwitch12 />
                <span>
                  {hit.versionIndex}/{hit.versionTotal}
                </span>
              </span>
            ) : null}
            <span className={styles.searchSnippet}>
              {hit.matchKind === 'thinking' ? t('searchMatchedThinkingPrefix') : null}
              <HighlightRanges text={hit.snippet} ranges={hit.snippetHighlights} />
            </span>
          </span>
        ) : null}
      </span>
    </button>
  )
})

export const SessionItem = memo(function SessionItem({
  session,
  active,
  multiSelect,
  selected,
  onToggleSelect,
  onOpenContextMenu,
}: {
  session: SessionSummary
  active: boolean
  multiSelect: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  onOpenContextMenu: (session: SessionSummary, anchorRect: DOMRect) => void
}) {
  const t = useTranslate()
  const displayTitle = session.title || t('untitledChat')
  const rowRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const longPressedRef = useRef(false)
  const recentTouchRef = useRef(false)

  const clearLongPress = () => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    startPosRef.current = null
  }

  const triggerMenu = () => {
    const rect = rowRef.current?.getBoundingClientRect()
    if (rect) {
      onOpenContextMenu(session, rect)
    }
  }

  return (
    <div
      ref={rowRef}
      role={multiSelect ? 'checkbox' : 'button'}
      aria-checked={multiSelect ? selected : undefined}
      tabIndex={0}
      data-session-id={session.id}
      data-session-row="true"
      className={clsx(
        styles.item,
        !multiSelect && active && styles.active,
        multiSelect && selected && styles.selectedRow
      )}
      onTouchStart={(event) => {
        if (multiSelect || event.touches.length !== 1) {
          return
        }
        recentTouchRef.current = true
        longPressedRef.current = false
        const touch = event.touches[0]
        startPosRef.current = { x: touch.clientX, y: touch.clientY }
        timerRef.current = setTimeout(() => {
          timerRef.current = undefined
          longPressedRef.current = true
          triggerMenu()
        }, LONG_PRESS_MS)
      }}
      onTouchMove={(event) => {
        const start = startPosRef.current
        const touch = event.touches[0]
        if (!start || !touch) {
          return
        }
        if (
          Math.abs(touch.clientX - start.x) > MOVE_CANCEL_PX ||
          Math.abs(touch.clientY - start.y) > MOVE_CANCEL_PX
        ) {
          clearLongPress()
        }
      }}
      onTouchEnd={() => {
        clearLongPress()
        setTimeout(() => {
          recentTouchRef.current = false
        }, 500)
      }}
      onTouchCancel={() => {
        clearLongPress()
        recentTouchRef.current = false
      }}
      onMouseDown={(event) => {
        if (recentTouchRef.current || multiSelect || event.button !== 0) {
          return
        }
        longPressedRef.current = false
        startPosRef.current = { x: event.clientX, y: event.clientY }
        timerRef.current = setTimeout(() => {
          timerRef.current = undefined
          longPressedRef.current = true
          triggerMenu()
        }, LONG_PRESS_MS)
      }}
      onMouseMove={(event) => {
        const start = startPosRef.current
        if (!start) {
          return
        }
        if (
          Math.abs(event.clientX - start.x) > MOVE_CANCEL_PX ||
          Math.abs(event.clientY - start.y) > MOVE_CANCEL_PX
        ) {
          clearLongPress()
        }
      }}
      onMouseUp={clearLongPress}
      onMouseLeave={clearLongPress}
      onContextMenu={(event) => {
        if (multiSelect) {
          return
        }
        event.preventDefault()
        clearLongPress()
        triggerMenu()
      }}
      onClick={() => {
        if (longPressedRef.current) {
          longPressedRef.current = false
          return
        }
        if (multiSelect) {
          onToggleSelect(session.id)
          return
        }
        selectSession(session.id)
        leaveMobileSearch()
        closeMobileSider()
      }}
    >
      {multiSelect ? (
        <span
          aria-hidden="true"
          className={clsx(styles.checkbox, selected && styles.checkboxChecked)}
        >
          {selected ? <IconCheckOutline16 /> : null}
        </span>
      ) : null}
      <div className={styles.textWrap}>
        <div className={styles.title}>{displayTitle}</div>
      </div>
    </div>
  )
})
