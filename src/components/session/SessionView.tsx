import clsx from 'clsx'
import { useIsMobile, useKeyboardOpen } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import type { Session } from '../../services/chat/types.js'
import { setAutoRead, useSettings } from '../../services/settings.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { IconSpeakerMutedOutline20, IconSpeakerOnOutline20 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：顶栏（抽屉、标题、自动朗读、新对话）+ 增量消息列表 + 吸底输入栏 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const keyboardOpen = useKeyboardOpen()
  const autoRead = useSettings((state) => state.autoRead)
  const title = session.title || t('untitledChat')
  const lastVisible = getVisibleMessages(session).at(-1)
  const showFooterCaveat =
    !isMobile ||
    (!keyboardOpen &&
      (streaming || !lastVisible || lastVisible.role !== 'assistant' || lastVisible.stopReason === 'refusal'))

  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.headerActions}>
            <IconButton
              size="m"
              tone="primary"
              className={clsx(autoRead && styles.autoReadActive)}
              icon={autoRead ? <IconSpeakerOnOutline20 /> : <IconSpeakerMutedOutline20 />}
              tooltip={t('autoReadToggle')}
              aria-pressed={autoRead}
              onClick={() => {
                const next = !autoRead
                setAutoRead(next)
                if (!next) {
                  stopReadAloud()
                }
                showToast({ key: next ? 'autoReadEnabled' : 'autoReadDisabled' })
              }}
            />
          </div>
        </div>
      )}
      <MessageList
        key={session.id}
        session={session}
        streaming={streaming}
        footer={
          <div className={clsx(styles.inputContainer, isMobile && keyboardOpen && styles.inputContainerKeyboard)}>
            <ChatInput sessionId={session.id} />
            {showFooterCaveat ? (
              <div className={styles.caveat}>{t('contentCaveat')}</div>
            ) : (
              <div className={clsx(styles.inputSpacer, isMobile && keyboardOpen && styles.inputSpacerCompact)} />
            )}
          </div>
        }
      />
    </div>
  )
}
