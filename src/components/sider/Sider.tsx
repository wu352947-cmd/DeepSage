import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import deepsageIcon from '../../assets/deepsage-icon.png'
import { useTranslate } from '../../i18n/index.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  newChat,
  removeSession,
  removeSessions,
  renameSession,
  setSessionsPinned,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { setSiderCollapsed, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconArrowLeftOutline20,
  IconCloseOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconMultiSelectOutline16,
  IconPanelLeftOutline16,
  IconPinOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  IconUserOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import {
  clearChatSearch,
  enterMobileSearch,
  leaveMobileSearch,
  retryChatSearch,
  setChatSearchQuery,
  setSearchListScrollTop,
  useChatSearch,
} from './chatSearchState.js'
import {
  enterMultiSelect,
  exitMultiSelect,
  toggleSelectSession,
  useMobileSider,
} from './mobileSiderState.js'
import { SearchHitItem, SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

type ContextMenuState = {
  session: SessionSummary
  top: number
  left: number
}

/** 展开的侧边栏（桌面常驻 / 移动端抽屉）：搜索、置顶分组、时间分组、长按菜单、多选管理、底部用户与设置入口 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const profile = useSettings((state) => state.profile)
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const multiSelect = useMobileSider((state) => state.multiSelect)
  const selectedIds = useMobileSider((state) => state.selectedIds)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const [now, setNow] = useState(Date.now)
  const searchQuery = useChatSearch((state) => state.query)
  const searching = useChatSearch((state) => state.searching)
  const searchError = useChatSearch((state) => state.error)
  const searchHits = useChatSearch((state) => state.hits)
  const searchedQuery = useChatSearch((state) => state.searchedQuery)
  const searchOpen = useChatSearch((state) => state.searchOpen)
  const drawerOpen = useMobileSider((state) => state.open)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<SessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingIds, setDeletingIds] = useState<string[] | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const backdropReadyRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const trimmedQuery = searchQuery.trim()
  const isSearchActive = trimmedQuery.length > 0
  const inMobileSearch = mobile && !multiSelect && (searchOpen || isSearchActive)

  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  )

  const searchResults = useMemo(() => {
    if (!isSearchActive) {
      return []
    }
    return searchHits.filter((hit) => sessionById.has(hit.sessionId))
  }, [isSearchActive, searchHits, sessionById])

  useLayoutEffect(() => {
    const listEl = listRef.current
    if (!listEl || !isSearchActive) {
      return
    }
    const savedTop = useChatSearch.getState().listScrollTop
    if (savedTop > 0) {
      listEl.scrollTop = savedTop
    }
  }, [isSearchActive, drawerOpen, searchResults.length])

  const groups = useMemo(
    () => (isSearchActive ? [] : groupSessions(sessions, now, t, locale)),
    [isSearchActive, sessions, now, t, locale]
  )

  const openContextMenu = useCallback((session: SessionSummary, rect: DOMRect) => {
    const menuWidth = 176
    const menuHeight = 184
    const vw = typeof window !== 'undefined' ? window.innerWidth : 390
    const vh = typeof window !== 'undefined' ? window.innerHeight : 844
    const left = Math.max(12, Math.min(rect.left + 16, vw - menuWidth - 12))
    const top = Math.max(12, Math.min(rect.bottom + 4, vh - menuHeight - 16))
    backdropReadyRef.current = false
    setMenu({ session, top, left })
  }, [])

  const selectedSessions = useMemo(
    () => sessions.filter((s) => selectedSet.has(s.id)),
    [sessions, selectedSet]
  )
  const allSelectedPinned =
    selectedSessions.length > 0 && selectedSessions.every((session) => Boolean(session.pinned))

  const displayName = profile.name.trim() || t('defaultUserName')
  const avatarInitial = displayName.slice(0, 1).toUpperCase()
  const hasPinnedGroup = groups.some((group) => group.pinned)

  return (
    <div
      className={clsx(
        styles.sider,
        mobile && styles.mobile,
        inMobileSearch && styles.mobileSearch
      )}
    >
      {!mobile ? (
        <>
          <div className={styles.top}>
            <div className={styles.appName}>
              <img src={deepsageIcon} alt="" className={styles.appLogo} />
              <span>{t('appName')}</span>
            </div>
            <IconButton
              size="m"
              icon={<IconPanelLeftOutline16 />}
              tooltip={t('collapseSiderbarButton')}
              tooltipPlacement="bottom"
              onClick={() => setSiderCollapsed(true)}
            />
          </div>
          <button type="button" className={styles.newChat} onClick={newChat}>
            <span className={styles.newChatIcon}>
              <NewChatIcon />
            </span>
            {t('newChat')}
          </button>
        </>
      ) : null}

      {multiSelect ? (
        <div className={styles.multiSelectHeader}>
          <span className={styles.multiSelectCount}>
            {t('selectedCount', { count: selectedIds.length })}
          </span>
          <IconButton
            size="m"
            tone="primary"
            icon={<IconCloseOutline16 />}
            aria-label={t('close')}
            onClick={exitMultiSelect}
          />
        </div>
      ) : (
        <div className={clsx(styles.searchBarRow, inMobileSearch && styles.searchBarRowDedicated)}>
          {inMobileSearch ? (
            <button
              type="button"
              className={styles.searchBackButton}
              aria-label={t('back')}
              onClick={() => {
                searchInputRef.current?.blur()
                leaveMobileSearch()
              }}
            >
              <IconArrowLeftOutline20 />
            </button>
          ) : null}
          <div className={clsx(styles.searchWrap, inMobileSearch && styles.searchWrapDedicated)}>
            <span className={styles.searchIcon}>
              <IconSearchOutline16 />
            </span>
            <input
              ref={searchInputRef}
              type="search"
              className={styles.searchInput}
              placeholder={t('searchChatsPlaceholder')}
              aria-label={t('searchChatsPlaceholder')}
              value={searchQuery}
              onFocus={() => {
                if (mobile) {
                  enterMobileSearch()
                }
              }}
              onChange={(event) => setChatSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
              }}
            />
            {searchQuery ? (
              <button
                type="button"
                className={clsx(styles.searchClear, inMobileSearch && styles.searchClearPill)}
                aria-label={t('close')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  clearChatSearch()
                  searchInputRef.current?.focus({ preventScroll: true })
                }}
              >
                <IconCloseOutline16 />
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className={styles.listWrap}>
        <div
          ref={listRef}
          className={styles.list}
          onScroll={(event) => {
            if (isSearchActive) {
              setSearchListScrollTop(event.currentTarget.scrollTop)
            }
          }}
        >
          {isSearchActive ? (
            searchResults.length > 0 ? (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span>{t('searchChatsResultsTitle')}</span>
                  {searching ? (
                    <span className={styles.searchStatusMeta}>{t('searchChatsSearching')}</span>
                  ) : null}
                </div>
                {searchResults.map((hit) => {
                  const summary = sessionById.get(hit.sessionId)
                  const title = summary?.title || hit.sessionTitle || t('untitledChat')
                  return (
                    <SearchHitItem
                      key={hit.hitKey}
                      hit={hit}
                      title={title}
                      active={hit.sessionId === activeId}
                      now={now}
                      locale={locale}
                    />
                  )
                })}
              </div>
            ) : searching || (!searchError && searchedQuery !== trimmedQuery) ? (
              <div className={styles.emptySearch} role="status">
                {t('searchChatsSearching')}
              </div>
            ) : searchError ? (
              <div className={styles.searchErrorState} role="alert">
                <span>{t('searchChatsFailed')}</span>
                <Button size="s" variant="outlined" onClick={retryChatSearch}>
                  {t('retry')}
                </Button>
              </div>
            ) : (
              <div className={styles.emptySearch}>{t('searchChatsEmpty')}</div>
            )
          ) : (
            groups.map((group, groupIndex) => (
              <div key={group.key}>
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <span>{group.label}</span>
                    {!multiSelect && (group.pinned || (!hasPinnedGroup && groupIndex === 0)) ? (
                      <button
                        type="button"
                        className={styles.multiSelectTrigger}
                        aria-label={t('multiSelect')}
                        onClick={() => enterMultiSelect()}
                      >
                        <IconMultiSelectOutline16 />
                      </button>
                    ) : null}
                  </div>
                  {group.sessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === activeId}
                      multiSelect={multiSelect}
                      selected={selectedSet.has(session.id)}
                      onToggleSelect={toggleSelectSession}
                      onOpenContextMenu={openContextMenu}
                    />
                  ))}
                </div>
                {group.pinned ? <div className={styles.pinnedDivider} /> : null}
              </div>
            ))
          )}
        </div>
      </div>

      {multiSelect ? (
        <div className={styles.multiSelectBar}>
          <button
            type="button"
            className={styles.multiActionBtn}
            disabled={selectedIds.length === 0}
            onClick={() => {
              setSessionsPinned(selectedIds, !allSelectedPinned)
              exitMultiSelect()
            }}
          >
            {t(allSelectedPinned ? 'unpinChat' : 'pinChat')}
          </button>
          <span className={styles.multiActionDivider} />
          <button
            type="button"
            className={clsx(styles.multiActionBtn, styles.multiActionDanger)}
            disabled={selectedIds.length === 0}
            onClick={() => setDeletingIds([...selectedIds])}
          >
            {t('delete')}
          </button>
        </div>
      ) : !inMobileSearch ? (
        <div className={styles.bottom}>
          <div className={styles.userRow} onClick={() => openSettings('root')}>
            <div className={styles.userInfo}>
              {profile.avatar ? (
                <img src={profile.avatar} alt="" className={styles.userAvatarImg} />
              ) : (
                <span className={styles.userAvatar}>
                  {profile.name.trim() ? avatarInitial : <IconUserOutline16 />}
                </span>
              )}
              <span className={styles.userName}>{displayName}</span>
            </div>
            <IconButton
              size="m"
              tone="primary"
              icon={<IconEllipsisOutline16 />}
              aria-label={t('settings')}
              onClick={(event) => {
                event.stopPropagation()
                openSettings('root')
              }}
            />
          </div>
        </div>
      ) : null}

      {menu
        ? createPortal(
            <div
              className={styles.contextOverlay}
              onPointerDown={(event) => {
                backdropReadyRef.current = event.target === event.currentTarget
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget && backdropReadyRef.current) {
                  setMenu(null)
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                if (event.target === event.currentTarget && backdropReadyRef.current) {
                  setMenu(null)
                }
              }}
            >
              <div
                className={styles.contextCard}
                style={{ top: menu.top, left: menu.left }}
                role="menu"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={styles.contextOption}
                  onClick={() => {
                    const target = menu.session
                    setMenu(null)
                    setRenameValue(target.title || t('untitledChat'))
                    setRenaming(target)
                  }}
                >
                  <IconEditOutline16 />
                  <span>{t('sessionItemMenuRenameOption')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.contextOption}
                  onClick={() => {
                    const target = menu.session
                    setMenu(null)
                    setSessionsPinned([target.id], !target.pinned)
                  }}
                >
                  <IconPinOutline16 />
                  <span>{t(menu.session.pinned ? 'unpinChat' : 'pinChat')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.contextOption}
                  onClick={() => {
                    const target = menu.session
                    setMenu(null)
                    enterMultiSelect(target.id)
                  }}
                >
                  <IconMultiSelectOutline16 />
                  <span>{t('multiSelect')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={clsx(styles.contextOption, styles.contextDanger)}
                  onClick={() => {
                    const target = menu.session
                    setMenu(null)
                    setDeletingIds([target.id])
                  }}
                >
                  <IconTrashOutline16 />
                  <span>{t('delete')}</span>
                </button>
              </div>
            </div>,
            document.body
          )
        : null}

      {renaming ? (
        <Modal
          title={t('renameChatTitle')}
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setRenaming(null)}>
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  const trimmed = renameValue.trim()
                  if (trimmed) {
                    renameSession(renaming.id, trimmed)
                  }
                  setRenaming(null)
                }}
              >
                {t('save')}
              </Button>
            </>
          }
        >
          <input
            type="text"
            className={styles.renameModalInput}
            placeholder={t('renameChatPlaceholder')}
            value={renameValue}
            autoFocus
            onFocus={(event) => event.target.select()}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                const trimmed = renameValue.trim()
                if (trimmed) {
                  renameSession(renaming.id, trimmed)
                }
                setRenaming(null)
              }
            }}
          />
        </Modal>
      ) : null}

      {deletingIds && deletingIds.length > 0 ? (
        <Modal
          title={
            deletingIds.length > 1
              ? t('deleteSelectedTitle')
              : t('deleteSessionModalContentTitle')
          }
          onClose={() => {
            if (!deletePending) {
              setDeletingIds(null)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={deletePending}
                onClick={() => setDeletingIds(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    const ok =
                      deletingIds.length === 1
                        ? await removeSession(deletingIds[0])
                        : await removeSessions(deletingIds)
                    if (ok) {
                      setDeletingIds(null)
                      if (multiSelect) {
                        exitMultiSelect()
                      }
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {deletingIds.length > 1
            ? t('deleteSelectedDescription', { count: deletingIds.length })
            : t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}
