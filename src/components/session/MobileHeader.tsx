import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { setAutoRead, useSettings } from '../../services/settings.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconMenuOutline20,
  IconNewChatCircleOutline20,
  IconSpeakerMutedOutline20,
  IconSpeakerOnOutline20,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/**
 * 移动端顶栏（欢迎页与会话页共用）：
 * 左侧双横线抽屉按钮；中间可选会话标题；右侧自动朗读开关（扬声器/静音）与圆圈加号新对话按钮。
 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  const autoRead = useSettings((state) => state.autoRead)

  const toggleAutoRead = () => {
    const next = !autoRead
    setAutoRead(next)
    if (!next) {
      stopReadAloud()
    }
    showToast({ key: next ? 'autoReadEnabled' : 'autoReadDisabled' })
  }

  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? (
        <div className={styles.spacer} />
      ) : (
        <div className={styles.title}>{title}</div>
      )}
      <div className={styles.rightActions}>
        <IconButton
          size="xl"
          tone="primary"
          className={clsx(autoRead && styles.autoReadActive)}
          icon={autoRead ? <IconSpeakerOnOutline20 /> : <IconSpeakerMutedOutline20 />}
          aria-label={t('autoReadToggle')}
          aria-pressed={autoRead}
          onClick={toggleAutoRead}
        />
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconNewChatCircleOutline20 />}
          aria-label={t('newChat')}
          onClick={newChat}
        />
      </div>
    </div>
  )
}
