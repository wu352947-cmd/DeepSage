import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile, useKeyboardOpen } from '../../app/viewport.js'
import { useEditMessage } from '../chatInput/editMessageState.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import {
  clearPendingScrollTarget,
  selectMessageVersion,
  useChatStore,
} from '../../services/chat/store.js'
import type { Message, Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import styles from './MessageList.module.css'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
/** 超长会话首次只渲染末尾 10 条（5 轮对话），上滑时按批增量挂载更早消息。 */
const FULL_RENDER_LIMIT = 20
const INITIAL_TAIL_COUNT = 10
const PREPEND_BATCH_SIZE = 10
const PREPEND_TRIGGER_TOP = 600
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const keyboardOpen = useKeyboardOpen()
  const editingMessageId = useEditMessage((state) =>
    state.editing?.sessionId === session.id ? state.editing.messageId : null
  )
  const pendingScrollTarget = useChatStore((state) =>
    state.pendingScrollTarget?.sessionId === session.id ? state.pendingScrollTarget : null
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const editingMessageIdRef = useRef<string | null>(editingMessageId)
  editingMessageIdRef.current = editingMessageId
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const pendingPrependHeightRef = useRef<number | null>(null)
  const versionsCacheRef = useRef<ReadonlyMap<string, MessageVersions>>(new Map())

  const messages = useMemo(() => getVisibleMessages(session), [session])
  const versions = useMemo(() => {
    const next = buildMessageVersions(session, versionsCacheRef.current)
    versionsCacheRef.current = next
    return next
  }, [session])

  const [renderedStart, setRenderedStart] = useState(() => {
    const defaultStart =
      messages.length > FULL_RENDER_LIMIT ? messages.length - INITIAL_TAIL_COUNT : 0
    if (!pendingScrollTarget) {
      return defaultStart
    }
    const targetIdx = messages.findIndex((m) => m.id === pendingScrollTarget.messageId)
    return targetIdx >= 0 ? Math.min(defaultStart, Math.max(0, targetIdx - 2)) : defaultStart
  })

  const clampedStart = Math.min(renderedStart, Math.max(0, messages.length - 1))
  const visibleSlice = useMemo(
    () => (clampedStart > 0 ? messages.slice(clampedStart) : messages),
    [messages, clampedStart]
  )

  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 上滑增量加载更早消息后，补偿高度增量以保持当前阅读位置不变。
  useLayoutEffect(() => {
    const prevHeight = pendingPrependHeightRef.current
    const el = scrollRef.current
    if (prevHeight !== null && el) {
      pendingPrependHeightRef.current = null
      const delta = el.scrollHeight - prevHeight
      if (delta > 0) {
        el.scrollTop += delta
        scrollTopRef.current = el.scrollTop
      }
    }
  }, [clampedStart])

  // 视口或内容尺寸变化时，仅在原本贴底且未锁定搜索跳转或编辑目标时跟随底部；非贴底阅读位置保持原位，不强行滚动。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const handleResize = () => {
      const hasJumpTarget = useChatStore.getState().pendingScrollTarget?.sessionId === session.id
      if (stickyRef.current && !editingMessageIdRef.current && !hasJumpTarget) {
        scroll.scrollTop = scroll.scrollHeight
      }
      scrollTopRef.current = scroll.scrollTop
    }
    const observer = new ResizeObserver(handleResize)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, session.id])

  // 搜索命中打开会话后定位到目标消息（如有需要先行展开更早的消息分片）。
  useLayoutEffect(() => {
    if (!pendingScrollTarget) {
      return
    }
    const targetIdx = messages.findIndex((m) => m.id === pendingScrollTarget.messageId)
    if (targetIdx === -1) {
      return
    }
    if (targetIdx < clampedStart) {
      setRenderedStart(Math.max(0, targetIdx - 2))
      return
    }
    const scroll = scrollRef.current
    if (!scroll) {
      return
    }
    const target = scroll.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(pendingScrollTarget.messageId)}"]`
    )
    if (!target) {
      return
    }
    stickyRef.current = false
    const scrollRect = scroll.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    scroll.scrollTop = Math.max(0, scroll.scrollTop + (targetRect.top - scrollRect.top - 16))
    scrollTopRef.current = scroll.scrollTop
    clearPendingScrollTarget(pendingScrollTarget.nonce)
  }, [pendingScrollTarget, messages, clampedStart])

  // 移动端键盘弹出或进入编辑态时，确保当前末尾消息（贴底态）或被编辑消息留在可见区域上方。
  useEffect(() => {
    if (!isMobile || (!keyboardOpen && !editingMessageId)) {
      return
    }
    const align = () => {
      const scroll = scrollRef.current
      if (!scroll) {
        return
      }
      if (editingMessageId) {
        const target = scroll.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(editingMessageId)}"]`
        )
        if (target) {
          const scrollRect = scroll.getBoundingClientRect()
          const targetRect = target.getBoundingClientRect()
          if (targetRect.bottom > scrollRect.bottom - 8) {
            scroll.scrollTop += targetRect.bottom - (scrollRect.bottom - 8)
            scrollTopRef.current = scroll.scrollTop
          } else if (targetRect.top < scrollRect.top + 8) {
            scroll.scrollTop -= scrollRect.top + 8 - targetRect.top
            scrollTopRef.current = scroll.scrollTop
          }
          return
        }
      }
      if (
        stickyRef.current &&
        useChatStore.getState().pendingScrollTarget?.sessionId !== session.id
      ) {
        scroll.scrollTop = scroll.scrollHeight
        scrollTopRef.current = scroll.scrollTop
      }
    }
    const frame = requestAnimationFrame(align)
    const timer = setTimeout(align, 100)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [isMobile, keyboardOpen, editingMessageId, session.id])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    if (useChatStore.getState().pendingScrollTarget?.sessionId === session.id) {
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  const maybeLoadEarlier = useCallback(
    (el: HTMLDivElement) => {
      if (
        clampedStart > 0 &&
        !stickyRef.current &&
        pendingPrependHeightRef.current === null &&
        el.scrollTop < PREPEND_TRIGGER_TOP
      ) {
        pendingPrependHeightRef.current = el.scrollHeight
        setRenderedStart((prev) => Math.max(0, Math.min(prev, messages.length - 1) - PREPEND_BATCH_SIZE))
      }
    },
    [clampedStart, messages.length]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
      maybeLoadEarlier(el)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom, maybeLoadEarlier])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {visibleSlice.map((message, localIndex) => {
              const index = clampedStart + localIndex
              return message.role === 'user' ? (
                <UserMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  retryUploadId={uploadRetryId}
                  isFirst={index === 0}
                  isLast={index === lastIndex || index === lastIndex - 1}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              ) : (
                <AssistantMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  isLast={index === lastIndex}
                  streaming={streaming && index === lastIndex}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              )
            })}
          </div>
        </div>
        {footer}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
