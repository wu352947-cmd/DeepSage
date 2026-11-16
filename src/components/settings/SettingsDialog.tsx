import clsx from 'clsx'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getRegionName, provinces } from '../../services/location.js'
import { getTtsVoicePreset } from '../../services/speech/voices.js'
import {
  DEFAULT_FONT_SCALE_INDEX,
  FONT_SCALE_STOPS,
  isChineseBrowser,
  resetProfile,
  setApiKey,
  setLocale,
  setThemePreference,
  setVoiceLanguage,
  useSettings,
  type Locale,
  type ThemePreference,
  type VoiceLanguage,
} from '../../services/settings.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { Button } from '../base/Button.js'
import {
  IconArrowLeftOutline20,
  IconBrowseOutline16,
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDataOutline16,
  IconFontSizeOutline16,
  IconGlobeLanguageOutline14,
  IconHelpOutline16,
  IconLogoutOutline16,
  IconMicOutline16,
  IconPlayMediaOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSparklesOutline16,
  IconUserOutline16,
} from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { FontSizePage } from './FontSizePage.js'
import {
  AccountPage,
  DataManagementPage,
  getAppVersion,
  HelpPage,
  LocationPage,
  PersonalizationPage,
  TermsPage,
  TtsVoicesPage,
  VoiceLanguagePage,
} from './SettingsSubPages.js'
import {
  backSettingsPage,
  closeSettings,
  pushSettingsPage,
  useSettingsDialog,
  type SettingsPage,
} from './settingsDialogState.js'
import styles from './Settings.module.css'

type ActivePicker = 'locale' | 'appearance' | 'voiceLanguage' | null

type PickerOption<T extends string> = {
  value: T
  label: string
}

const PickerSheet = <T extends string>({
  title,
  value,
  options,
  onSelect,
  onClose,
}: {
  title: string
  value: T
  options: PickerOption<T>[]
  onSelect: (value: T) => void
  onClose: () => void
}) => (
  <div className={styles.pickerBackdrop} onClick={onClose}>
    <div
      className={styles.pickerSheet}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.pickerTitle}>{title}</div>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            className={clsx(styles.pickerOption, selected && styles.pickerOptionSelected)}
            onClick={() => {
              onSelect(option.value)
              onClose()
            }}
          >
            <span>{option.label}</span>
            {selected && <IconCheckOutline16 />}
          </button>
        )
      })}
    </div>
  </div>
)

type MenuRowProps = {
  icon: ReactNode
  label: string
  value?: string
  showChevron?: boolean
  onClick: () => void
}

const MenuRow = ({ icon, label, value, showChevron = true, onClick }: MenuRowProps) => (
  <button type="button" className={styles.menuRow} onClick={onClick}>
    <span className={styles.menuRowLeft}>
      <span className={styles.menuRowIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.menuRowLabel}>{label}</span>
    </span>
    <span className={styles.menuRowRight}>
      {value && <span className={styles.menuRowValue}>{value}</span>}
      {showChevron && (
        <span className={styles.menuRowChevron} aria-hidden="true">
          <IconChevronRightOutline14 />
        </span>
      )}
    </span>
  </button>
)

const pageTitleKey = (page: SettingsPage) => {
  switch (page) {
    case 'root':
      return 'settings' as const
    case 'account':
      return 'settingsAccountManagement' as const
    case 'data':
      return 'settingDialogAsideDataOptionLabel' as const
    case 'fontSize':
      return 'settingsFontSize' as const
    case 'personalization':
      return 'settingsPersonalization' as const
    case 'location':
      return 'settingsLocation' as const
    case 'voiceLanguage':
      return 'settingsPrimaryLanguage' as const
    case 'ttsVoices':
      return 'settingsTtsVoice' as const
    case 'terms':
      return 'settingsTerms' as const
    case 'help':
      return 'settingsHelpFeedback' as const
  }
}

export const SettingsDialog = () => {
  const t = useTranslate()
  const open = useSettingsDialog((state) => state.open)
  const stack = useSettingsDialog((state) => state.stack)
  const currentPage = stack.at(-1) ?? 'root'

  const apiKey = useSettings((state) => state.apiKey)
  const profile = useSettings((state) => state.profile)
  const locale = useSettings((state) => state.locale)
  const themePreference = useSettings((state) => state.themePreference)
  const fontScaleMode = useSettings((state) => state.fontScaleMode)
  const fontScaleIndex = useSettings((state) => state.fontScaleIndex)
  const customInstructions = useSettings((state) => state.customInstructions)
  const location = useSettings((state) => state.location)
  const voiceLanguage = useSettings((state) => state.voiceLanguage)
  const ttsVoice = useSettings((state) => state.ttsVoice)

  const [picker, setPicker] = useState<ActivePicker>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)

  useEffect(() => {
    if (!open) {
      setPicker(null)
      setConfirmLogout(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (confirmLogout) {
        setConfirmLogout(false)
        return
      }
      if (picker) {
        setPicker(null)
        return
      }
      backSettingsPage()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, picker, confirmLogout])

  if (!open) {
    return null
  }

  const localeLabel = locale === 'zh-CN' ? t('settingsLocaleZhCN') : t('settingsLocaleEnUS')
  const appearanceLabel =
    themePreference === 'dark'
      ? t('avatarMenuSettingsDialogThemeSelectDarkOption')
      : themePreference === 'system'
        ? t('avatarMenuSettingsDialogThemeSelectSystemOption')
        : t('avatarMenuSettingsDialogThemeSelectLightOption')

  const fontScaleValue = FONT_SCALE_STOPS[fontScaleIndex] ?? 1
  const fontLabel =
    fontScaleMode === 'system'
      ? t('fontSizeFollowSystem')
      : fontScaleIndex === DEFAULT_FONT_SCALE_INDEX
        ? t('fontSizeStandard')
        : `${Math.round(fontScaleValue * 100)}%`

  const locationValue = (() => {
    if (!location?.region) {
      return t('settingsLocationUnset')
    }
    const displayLocale = locale === 'zh-CN' || isChineseBrowser() ? 'zh-CN' : 'en-US'
    const regionLabel = getRegionName(location.region, displayLocale)
    const province =
      location.region === 'CN' && location.province
        ? provinces.find((item) => item.code === location.province)
        : undefined
    const city = province?.cities.find((item) => item.code === location.city)
    return [regionLabel, province?.name, city?.name].filter(Boolean).join(' · ')
  })()

  const voiceLangLabel =
    voiceLanguage === 'zh-CN'
      ? t('settingsVoiceLangZh')
      : voiceLanguage === 'en-US'
        ? t('settingsVoiceLangEn')
        : t('settingsVoiceLangAuto')

  const ttsVoiceLabel = t(getTtsVoicePreset(ttsVoice).nameKey)

  const accountSummary = apiKey
    ? profile.name.trim() || t('settingsApiKeyConfigured')
    : t('settingsApiKeyNotConfigured')

  const appVersion = getAppVersion()

  const renderPage = () => {
    switch (currentPage) {
      case 'fontSize':
        return <FontSizePage />
      case 'account':
        return (
          <div className={styles.scrollBody}>
            <AccountPage onKeySaved={backSettingsPage} />
          </div>
        )
      case 'data':
        return (
          <div className={styles.scrollBody}>
            <DataManagementPage />
          </div>
        )
      case 'personalization':
        return (
          <div className={styles.scrollBody}>
            <PersonalizationPage />
          </div>
        )
      case 'location':
        return (
          <div className={styles.scrollBody}>
            <LocationPage />
          </div>
        )
      case 'voiceLanguage':
        return (
          <div className={styles.scrollBody}>
            <VoiceLanguagePage />
          </div>
        )
      case 'terms':
        return (
          <div className={styles.scrollBody}>
            <TermsPage />
          </div>
        )
      case 'help':
        return (
          <div className={styles.scrollBody}>
            <HelpPage />
          </div>
        )
      case 'ttsVoices':
      case 'root':
        return (
          <div className={styles.scrollBody}>
            <div className={styles.sectionTitle}>{t('settingsSectionAccount')}</div>
            <div className={styles.card}>
              <MenuRow
                icon={<IconUserOutline16 />}
                label={t('settingsAccountManagement')}
                value={accountSummary}
                onClick={() => pushSettingsPage('account')}
              />
              <MenuRow
                icon={<IconDataOutline16 />}
                label={t('settingDialogAsideDataOptionLabel')}
                onClick={() => pushSettingsPage('data')}
              />
            </div>

            <div className={styles.sectionTitle}>{t('settingsSectionApp')}</div>
            <div className={styles.card}>
              <MenuRow
                icon={<IconGlobeLanguageOutline14 />}
                label={t('settingsLocalePreference')}
                value={localeLabel}
                onClick={() => setPicker('locale')}
              />
              <MenuRow
                icon={<IconDarkOutline16 />}
                label={t('settingsAppearance')}
                value={appearanceLabel}
                onClick={() => setPicker('appearance')}
              />
              <MenuRow
                icon={<IconFontSizeOutline16 />}
                label={t('settingsFontSize')}
                value={fontLabel}
                onClick={() => pushSettingsPage('fontSize')}
              />
              <MenuRow
                icon={<IconSparklesOutline16 />}
                label={t('settingsPersonalization')}
                value={customInstructions ? t('settingsCustomSet') : t('settingsCustomUnset')}
                onClick={() => pushSettingsPage('personalization')}
              />
              <MenuRow
                icon={<IconSearchOutline16 />}
                label={t('settingsLocation')}
                value={locationValue}
                onClick={() => pushSettingsPage('location')}
              />
            </div>

            <div className={styles.sectionTitle}>{t('settingsSectionVoice')}</div>
            <div className={styles.card}>
              <MenuRow
                icon={<IconMicOutline16 />}
                label={t('settingsPrimaryLanguage')}
                value={voiceLangLabel}
                onClick={() => setPicker('voiceLanguage')}
              />
              <MenuRow
                icon={<IconPlayMediaOutline16 />}
                label={t('settingsTtsVoice')}
                value={ttsVoiceLabel}
                onClick={() => pushSettingsPage('ttsVoices')}
              />
            </div>
            <div className={styles.cardCaption}>{t('settingsVoiceCaption')}</div>

            <div className={styles.sectionTitle}>{t('settingsSectionAbout')}</div>
            <div className={styles.card}>
              <MenuRow
                icon={<IconRefreshOutline16 />}
                label={t('settingsCheckUpdate')}
                value={appVersion}
                showChevron={false}
                onClick={() =>
                  showToast({
                    key: 'settingsUpToDate',
                    params: { version: appVersion },
                  })
                }
              />
              <MenuRow
                icon={<IconBrowseOutline16 />}
                label={t('settingsTerms')}
                onClick={() => pushSettingsPage('terms')}
              />
            </div>

            <div className={clsx(styles.card, styles.standaloneCard)}>
              <MenuRow
                icon={<IconHelpOutline16 />}
                label={t('settingsHelpFeedback')}
                onClick={() => pushSettingsPage('help')}
              />
            </div>

            <div className={clsx(styles.card, styles.standaloneCard)}>
              <button
                type="button"
                className={clsx(styles.menuRow, styles.logoutRow)}
                onClick={() => setConfirmLogout(true)}
              >
                <span className={styles.menuRowLeft}>
                  <span className={styles.menuRowIcon} style={{ color: 'inherit' }} aria-hidden="true">
                    <IconLogoutOutline16 />
                  </span>
                  <span>{t('settingsLogout')}</span>
                </span>
              </button>
            </div>
          </div>
        )
    }
  }

  const displayHeaderPage = currentPage === 'ttsVoices' ? 'root' : currentPage

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeSettings()
        }
      }}
    >
      <div
        className={styles.shell}
        role="dialog"
        aria-modal="true"
        aria-label={t(pageTitleKey(currentPage))}
      >
        <div className={styles.header}>
          <button
            type="button"
            className={styles.backButton}
            aria-label={t('back')}
            onClick={() => backSettingsPage()}
          >
            <IconArrowLeftOutline20 />
          </button>
          <span className={styles.headerTitle}>{t(pageTitleKey(displayHeaderPage))}</span>
        </div>

        {renderPage()}
      </div>

      {currentPage === 'ttsVoices' && (
        <div
          className={styles.pickerBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label={t('settingsTtsVoice')}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              backSettingsPage()
            }
          }}
        >
          <TtsVoicesPage />
        </div>
      )}

      {picker === 'locale' && (
        <PickerSheet<Locale>
          title={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN') },
            { value: 'en-US', label: t('settingsLocaleEnUS') },
          ]}
          onSelect={setLocale}
          onClose={() => setPicker(null)}
        />
      )}

      {picker === 'appearance' && (
        <PickerSheet<ThemePreference>
          title={t('settingsAppearance')}
          value={themePreference}
          options={[
            { value: 'system', label: t('avatarMenuSettingsDialogThemeSelectSystemOption') },
            { value: 'light', label: t('avatarMenuSettingsDialogThemeSelectLightOption') },
            { value: 'dark', label: t('avatarMenuSettingsDialogThemeSelectDarkOption') },
          ]}
          onSelect={setThemePreference}
          onClose={() => setPicker(null)}
        />
      )}

      {picker === 'voiceLanguage' && (
        <PickerSheet<VoiceLanguage>
          title={t('settingsPrimaryLanguage')}
          value={voiceLanguage}
          options={[
            { value: 'auto', label: t('settingsVoiceLangAuto') },
            { value: 'zh-CN', label: t('settingsVoiceLangZh') },
            { value: 'en-US', label: t('settingsVoiceLangEn') },
          ]}
          onSelect={setVoiceLanguage}
          onClose={() => setPicker(null)}
        />
      )}

      {confirmLogout && (
        <Modal
          title={t('settingsLogoutConfirmTitle')}
          closable={false}
          onClose={() => setConfirmLogout(false)}
          footer={
            <>
              <Button variant="outlined" size="l" onClick={() => setConfirmLogout(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="l"
                onClick={() => {
                  stopReadAloud()
                  resetProfile()
                  setApiKey(null)
                  setConfirmLogout(false)
                  closeSettings()
                  showToast({ key: 'settingsLoggedOut' })
                }}
              >
                {t('confirm')}
              </Button>
            </>
          }
        >
          {t('settingsLogoutConfirmDesc')}
        </Modal>
      )}
    </div>
  )
}
