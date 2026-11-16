import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  IconCloseOutline16,
  IconGlobeLanguageOutline14,
  IconPlusOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { editMessage, sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import {
  cancelEditingMessage,
  setEditingMessageText,
  useEditMessage,
} from './editMessageState.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 深度思考与智能搜索开关 + 圆圈加号附件 + 按住说话 / 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const editing = useEditMessage((state) =>
    state.editing?.sessionId === sessionId ? state.editing : null
  )
  const isEditing = editing !== null
  const activeText = editing ? editing.text : text
  const setText = (value: string) => setDraftText(sessionId, value)
  const setActiveText = (value: string) => {
    if (editing) {
      setEditingMessageText(value)
    } else {
      setText(value)
    }
  }
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)
  const editingMessageId = editing?.messageId ?? null

  useEffect(() => {
    const current = useEditMessage.getState().editing
    if (current && current.sessionId !== sessionId) {
      cancelEditingMessage()
    }
  }, [sessionId])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!editingMessageId || !textarea) {
      return
    }
    textarea.focus({ preventScroll: true })
    const end = textarea.value.length
    textarea.setSelectionRange(end, end)
  }, [editingMessageId])

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const currentEditing = useEditMessage.getState().editing
    const editingHere =
      currentEditing && currentEditing.sessionId === sessionId ? currentEditing : null
    const current = editingHere ? editingHere.text : getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    const next = current.slice(0, start) + transcript + current.slice(end)
    if (editingHere) {
      setEditingMessageText(next)
    } else {
      setText(next)
    }
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
          cancelEditingMessage()
        }
      }),
    [cancelVoice]
  )

  const recording = voice.status === 'recording'
  const hasContent = isEditing
    ? editing.text.trim().length > 0 || editing.fileCount > 0
    : text.trim().length > 0 || attachments.length > 0
  const canSend = isEditing
    ? !importingHistory && !streaming && voice.status === 'idle' && hasContent
    : !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (useChatStore.getState().importingHistory || voice.status !== 'idle') {
      return
    }
    if (isEditing) {
      if (!sessionId || !editing || !hasContent) {
        return
      }
      if (!ensureApiKey() || !editMessage(sessionId, editing.messageId, editing.text.trim())) {
        return
      }
      cancelEditingMessage()
      stopReadAloud()
    } else {
      if (!prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)) {
        return
      }
      if (!ensureApiKey() || !sendMessage(sessionId)) {
        return
      }
      stopReadAloud()
    }
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      {isEditing ? (
        <div className={styles.editHeader}>
          <span className={styles.editLabel}>{t('editInputHeader')}</span>
          <button
            type="button"
            className={styles.editClose}
            aria-label={t('cancel')}
            onClick={cancelEditingMessage}
          >
            <IconCloseOutline16 />
          </button>
        </div>
      ) : (
        <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      )}
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={clsx(styles.textarea, recording && styles.textareaHidden)}
          placeholder={activeText || recording ? '' : t('chatInputPlaceholderChat')}
          rows={1}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={activeText}
          onChange={(event) => setActiveText(event.target.value)}
          onMouseDown={(event) => {
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return
            }
            if (event.key === 'Escape' && isEditing) {
              event.preventDefault()
              cancelEditingMessage()
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            if (isEditing) {
              return
            }
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        {recording ? (
          voice.getAnalyser() ? (
            <Spectrum getAnalyser={voice.getAnalyser} />
          ) : (
            <div className={styles.listeningOverlay} role="status">
              <span className={styles.listeningDot} />
              <span className={styles.listeningText}>
                {voice.interimText || t('voiceInputListening')}
              </span>
            </div>
          )
        ) : null}
        <div className={styles.mirror} aria-hidden>
          {activeText.endsWith('\n') ? `${activeText}\u200b` : activeText || '\u200b'}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索胶囊开关 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Tooltip content={t('deactivatedThinkTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, thinking && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinking}
              onClick={() => setThinking(!thinking)}
            >
              <IconThinkOutline14 />
              <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
        </div>
        <div className={styles.right}>
          {!isEditing ? (
            <Tooltip content={t('uploadFile')}>
              <button
                type="button"
                className={styles.circlePlusButton}
                aria-label={t('uploadFile')}
                disabled={importingHistory}
                onClick={() => ensureApiKey() && fileInputRef.current?.click()}
              >
                <IconPlusOutline16 />
              </button>
            </Tooltip>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : hasContent ? (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          ) : (
            <VoiceButton
              status={voice.status}
              disabled={importingHistory}
              onStartHold={() => void voice.startHold()}
              onStopHold={() => void voice.stopHold()}
              onCancel={voice.cancel}
            />
          )}
        </div>
      </div>
      {dragging ? <DragMask /> : null}
    </div>
  )
}
