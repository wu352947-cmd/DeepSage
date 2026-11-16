import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  DEFAULT_FONT_SCALE_INDEX,
  FONT_SCALE_STOPS,
  getChatFontScale,
  setFontScaleIndex,
  setFontScaleMode,
  useSettings,
} from '../../services/settings.js'
import styles from './Settings.module.css'

/**
 * 字体大小设置页：
 * 顶部为实时缩放的对话预览（用户气泡「预览文字大小」+ AI 回复）；
 * 底部抽屉含「跟随系统」绿色开关与 7 档滑块（默认档位标注「标准」），全局缩放对话文字。
 */
export const FontSizePage = () => {
  const t = useTranslate()
  const fontScaleMode = useSettings((state) => state.fontScaleMode)
  const fontScaleIndex = useSettings((state) => state.fontScaleIndex)
  const followSystem = fontScaleMode === 'system'
  const effectiveIndex = followSystem ? DEFAULT_FONT_SCALE_INDEX : fontScaleIndex
  const previewScale = getChatFontScale(fontScaleMode, fontScaleIndex)

  return (
    <div className={styles.fontPage}>
      <div className={styles.fontPreviewArea}>
        <div className={styles.previewUserWrap}>
          <div
            className={styles.previewUserBubble}
            style={{
              fontSize: `${16 * previewScale}px`,
              lineHeight: `${24 * previewScale}px`,
            }}
          >
            {t('fontSizePreviewUser')}
          </div>
        </div>
        <div
          className={styles.previewAssistantText}
          style={{
            fontSize: `${16 * previewScale}px`,
            lineHeight: `${28 * previewScale}px`,
          }}
        >
          {t('fontSizePreviewAssistant')}
        </div>
      </div>

      <div className={styles.fontSheet}>
        <div className={styles.switchRow}>
          <span className={styles.switchLabel}>{t('fontSizeFollowSystem')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={followSystem}
            aria-label={t('fontSizeFollowSystem')}
            className={clsx(styles.greenSwitch, followSystem && styles.greenSwitchOn)}
            onClick={() => setFontScaleMode(followSystem ? 'custom' : 'system')}
          >
            <span className={styles.greenSwitchThumb} />
          </button>
        </div>

        <div className={styles.sliderWrap}>
          <div className={styles.sliderRow}>
            <span className={styles.sliderSmallA}>A</span>
            <div className={styles.sliderTrackBox}>
              <div className={styles.sliderRail}>
                <div className={styles.sliderTicks}>
                  {FONT_SCALE_STOPS.map((_, index) => (
                    <span
                      key={index}
                      className={styles.sliderTick}
                      style={{ left: `${(index / (FONT_SCALE_STOPS.length - 1)) * 100}%` }}
                    />
                  ))}
                </div>
                <span
                  className={styles.sliderStandardLabel}
                  style={{
                    left: `${(DEFAULT_FONT_SCALE_INDEX / (FONT_SCALE_STOPS.length - 1)) * 100}%`,
                  }}
                >
                  {t('fontSizeStandard')}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={FONT_SCALE_STOPS.length - 1}
                step={1}
                value={effectiveIndex}
                aria-label={t('settingsFontSize')}
                className={styles.sliderInput}
                onChange={(event) => setFontScaleIndex(Number(event.target.value))}
              />
            </div>
            <span className={styles.sliderLargeA}>A</span>
          </div>
        </div>
      </div>
    </div>
  )
}
