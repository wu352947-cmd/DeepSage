import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconSoundWaveOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import type { VoiceInputStatus } from './useVoiceInput.js'
import styles from './VoiceButton.module.css'

/**
 * 按住说话按钮：圆圈内声波图标；按住期间显示品牌色呼吸光圈，松开完成语音转文字。
 */
export const VoiceButton = ({
  status,
  disabled = false,
  onStartHold,
  onStopHold,
  onCancel,
}: {
  status: VoiceInputStatus
  disabled?: boolean
  onStartHold: () => void
  onStopHold: () => void
  onCancel: () => void
}) => {
  const t = useTranslate()
  const recording = status === 'recording'
  const pressedRef = useRef(false)

  useEffect(() => {
    const handleGlobalRelease = () => {
      if (pressedRef.current) {
        pressedRef.current = false
        onStopHold()
      }
    }
    window.addEventListener('pointerup', handleGlobalRelease)
    window.addEventListener('pointercancel', handleGlobalRelease)
    return () => {
      window.removeEventListener('pointerup', handleGlobalRelease)
      window.removeEventListener('pointercancel', handleGlobalRelease)
    }
  }, [onStopHold])

  const label = recording
    ? t('voiceInputListening')
    : status === 'transcribing'
      ? t('voiceInputCancel')
      : t('voiceInput')

  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={clsx(
          styles.button,
          recording && styles.recording,
          disabled && styles.disabled
        )}
        aria-label={label}
        aria-pressed={recording}
        aria-disabled={disabled}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (disabled || event.button > 0) {
            return
          }
          if (status === 'transcribing') {
            onCancel()
            return
          }
          event.preventDefault()
          pressedRef.current = true
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // 忽略不支持指针捕获的合成事件
          }
          onStartHold()
        }}
        onPointerUp={() => {
          if (pressedRef.current) {
            pressedRef.current = false
            onStopHold()
          }
        }}
        onPointerCancel={() => {
          if (pressedRef.current) {
            pressedRef.current = false
            onStopHold()
          }
        }}
      >
        {recording ? (
          <span className={styles.active}>
            <span className={styles.halo} />
            <span className={styles.core} />
            <span className={styles.glyph}>
              <IconSoundWaveOutline16 />
            </span>
          </span>
        ) : status === 'transcribing' ? (
          <span className={styles.loading} />
        ) : (
          <IconSoundWaveOutline16 />
        )}
      </button>
    </Tooltip>
  )
}
