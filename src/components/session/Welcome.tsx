import clsx from 'clsx'
import deepsageIcon from '../../assets/deepsage-icon.png'
import { useIsMobile, useKeyboardOpen } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：居中 DeepSage 图标 + 问候语 + 底部输入栏；移动端顶栏含抽屉、自动朗读与新对话按钮 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const keyboardOpen = useKeyboardOpen()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={clsx(styles.welcome, isMobile && keyboardOpen && styles.welcomeKeyboard)}>
        <div className={styles.hero}>
          <img src={deepsageIcon} alt={t('appName')} className={styles.logo} />
          <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        </div>
        <ChatInput sessionId={null} />
        {isMobile && !keyboardOpen ? (
          <div className={styles.caveat}>{t('contentCaveat')}</div>
        ) : isMobile ? (
          <div className={styles.keyboardSpacer} />
        ) : null}
      </div>
    </div>
  )
}
