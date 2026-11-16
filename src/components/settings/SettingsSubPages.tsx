import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import mitLicenseText from '../../../LICENSE'
import deepsageIcon from '../../assets/deepsage-icon.png'
import { useTranslate } from '../../i18n/index.js'
import { saveBlobOnNative } from '../../native/capacitor.js'
import { BackupError, clearHistory, exportHistory, importHistory } from '../../services/chat/backup.js'
import { getRegionName, provinces, regionCodes } from '../../services/location.js'
import {
  isChineseBrowser,
  setAutoCollapseThinking,
  setCustomInstructions,
  setLocation,
  setProfile,
  setVoiceLanguage,
  useSettings,
  type VoiceLanguage,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconCheckOutline16, IconTrashOutline16, IconUploadOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import styles from './Settings.module.css'

export const APP_VERSION_CODE = 5

/** 读取构建注入的应用版本号，默认返回 0.2.3 */
export const getAppVersionName = () => {
  const version = document
    .querySelector('meta[name="application-version"]')
    ?.getAttribute('content')
    ?.trim()
  return version && version.length > 0 ? version : '0.2.3'
}

export const getAppVersion = () => `${getAppVersionName()}(${APP_VERSION_CODE})`

const readErrorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : String(error)

const resizeAvatarToDataUrl = async (file: File): Promise<string> => {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('image_load_failed'))
      image.src = url
    })
    const size = 160
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('canvas_unavailable')
    }
    const minSide = Math.min(img.naturalWidth || size, img.naturalHeight || size)
    const sx = ((img.naturalWidth || size) - minSide) / 2
    const sy = ((img.naturalHeight || size) - minSide) / 2
    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const AccountPage = ({ onKeySaved }: { onKeySaved: () => void }) => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const profile = useSettings((state) => state.profile)
  const [nameDraft, setNameDraft] = useState(profile.name)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const hadKeyRef = useRef(Boolean(apiKey))
  const editor = useApiKeyEditor()

  useEffect(() => {
    setNameDraft(profile.name)
  }, [profile.name])

  useEffect(() => {
    if (!hadKeyRef.current && apiKey) {
      onKeySaved()
    }
    hadKeyRef.current = Boolean(apiKey)
  }, [apiKey, onKeySaved])

  const displayName = profile.name.trim() || t('defaultUserName')
  const avatarLetter = displayName.slice(0, 1).toUpperCase() || 'D'

  const saveName = () => {
    setProfile({ ...profile, name: nameDraft.trim() })
    showToast({ key: 'saved' })
  }

  const pickAvatar = async (file: File | undefined) => {
    if (!file) {
      return
    }
    try {
      const avatar = await resizeAvatarToDataUrl(file)
      setProfile({ ...useSettings.getState().profile, avatar })
    } catch {
      showToast({ key: 'unknownError', type: 'error' })
    }
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.subCell}>
          <div className={styles.profileHeader}>
            <div className={styles.profileAvatarWrap}>
              {profile.avatar ? (
                <img src={profile.avatar} alt={displayName} className={styles.profileAvatarImg} />
              ) : (
                <span className={styles.profileAvatar} aria-hidden="true">
                  {avatarLetter}
                </span>
              )}
              <div className={styles.text}>
                <span className={styles.label}>{t('settingsProfileAvatar')}</span>
                <span className={styles.description}>{displayName}</span>
              </div>
            </div>
            <div className={styles.profileActions}>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void pickAvatar(file)
                }}
              />
              <Button
                variant="outlined"
                size="s"
                onClick={() => avatarInputRef.current?.click()}
              >
                {t('settingsProfileChooseAvatar')}
              </Button>
              {profile.avatar && (
                <Button
                  variant="outlined"
                  size="s"
                  onClick={() => setProfile({ ...profile, avatar: null })}
                >
                  {t('settingsProfileResetAvatar')}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className={styles.subCell}>
          <div className={styles.label}>{t('settingsProfileName')}</div>
          <div className={styles.textInputRow}>
            <input
              type="text"
              className={styles.textInput}
              value={nameDraft}
              maxLength={40}
              placeholder={t('settingsProfileNamePlaceholder')}
              onChange={(event) => setNameDraft(event.target.value)}
            />
            <Button
              variant="primary"
              size="m"
              disabled={nameDraft.trim() === profile.name}
              onClick={saveName}
            >
              {t('save')}
            </Button>
          </div>
        </div>
      </div>

      <div className={clsx(styles.card, styles.standaloneCard)}>
        <div className={styles.subCell}>
          <ApiKeyField editor={editor} />
          <ApiKeyConfirm editor={editor} />
        </div>
      </div>
    </>
  )
}

const ImportConfirm = ({
  file,
  busy,
  onClose,
  onConfirm,
}: {
  file: File
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      closable={false}
      onClose={() => {
        if (!busy) {
          onClose()
        }
      }}
      footer={
        <>
          <Button variant="outlined" size="l" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" size="l" disabled={busy} onClick={onConfirm}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
      <div className={styles.description} style={{ marginTop: 8 }}>
        {file.name}
      </div>
    </Modal>
  )
}

const DeleteAllConfirm = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = () => {
    if (deleting) {
      return
    }
    setDeleting(true)
    void clearHistory()
      .then(() => {
        showToast({ key: 'historyDeleted' })
        onClose()
      })
      .catch(() => {
        showToast({ key: 'historyDeleteFailed', type: 'error' })
      })
      .finally(() => setDeleting(false))
  }

  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      closable={false}
      onClose={() => {
        if (!deleting) {
          onClose()
        }
      }}
      footer={
        <>
          <Button variant="outlined" size="l" disabled={deleting} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="danger" size="l" disabled={deleting} onClick={confirmDelete}>
            {deleting ? t('historyDeleting') : t('delete')}
          </Button>
        </>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

export const DataManagementPage = () => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const runImport = () => {
    if (!pendingImport || importing) {
      return
    }
    setImporting(true)
    void importHistory(pendingImport)
      .then((count) => {
        showToast(count === 1 ? { key: 'historyImportedOne' } : { key: 'historyImported', params: { count } })
        setPendingImport(null)
      })
      .catch((error) => {
        showToast({
          key: error instanceof BackupError ? error.key : 'historyImportFailed',
          type: 'error',
        })
        setPendingImport(null)
      })
      .finally(() => setImporting(false))
  }

  const runExport = () => {
    if (exporting) {
      return
    }
    setExporting(true)
    void exportHistory()
      .then(async ({ name, blob }) => {
        if (Capacitor.isNativePlatform()) {
          const savedPath = await saveBlobOnNative(blob, name)
          if (savedPath) {
            showToast({ key: 'historyExportSaved', params: { path: savedPath } })
            return
          }
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      })
      .catch((error) => {
        showToast({
          key: 'historyExportFailed',
          params: { message: readErrorMessage(error) },
          type: 'error',
        })
      })
      .finally(() => setExporting(false))
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cell}>
          <div className={styles.row}>
            <div className={styles.text}>
              <span className={styles.label}>{t('historyImport')}</span>
              <span className={styles.description}>{t('historyImportDescription')}</span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  setPendingImport(file)
                }
              }}
            />
            <Button
              variant="outlined"
              size="m"
              className={clsx(styles.cellButton, styles.uploadButton)}
              disabled={importing}
              onClick={() => inputRef.current?.click()}
            >
              <IconUploadOutline14 />
              {t('upload')}
            </Button>
          </div>
        </div>

        <div className={styles.cell}>
          <div className={styles.row}>
            <div className={styles.text}>
              <span className={styles.label}>{t('exportAllLabel')}</span>
              <span className={styles.description}>{t('historyExportDescription')}</span>
            </div>
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              disabled={exporting}
              onClick={runExport}
            >
              {t('exportAllDownload')}
            </Button>
          </div>
        </div>

        <div className={styles.cell}>
          <div className={styles.row}>
            <div className={styles.text}>
              <span className={styles.label}>{t('deleteAllSessions')}</span>
            </div>
            <Button
              variant="dangerOutlined"
              size="m"
              className={styles.cellButton}
              onClick={() => setConfirmClear(true)}
            >
              <IconTrashOutline16 />
              {t('delete')}
            </Button>
          </div>
        </div>
      </div>

      {pendingImport && (
        <ImportConfirm
          file={pendingImport}
          busy={importing}
          onClose={() => setPendingImport(null)}
          onConfirm={runImport}
        />
      )}
      {confirmClear && <DeleteAllConfirm onClose={() => setConfirmClear(false)} />}
    </>
  )
}

export const PersonalizationPage = () => {
  const t = useTranslate()
  const autoCollapseThinking = useSettings((state) => state.autoCollapseThinking)
  const saved = useSettings((state) => state.customInstructions)
  const [draft, setDraft] = useState(saved)

  useEffect(() => {
    setDraft(saved)
  }, [saved])

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cell}>
          <div className={styles.row}>
            <div className={styles.text}>
              <span className={styles.label}>{t('settingsAutoCollapseThinking')}</span>
              <span className={styles.description}>{t('settingsAutoCollapseThinkingDesc')}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoCollapseThinking}
              aria-label={t('settingsAutoCollapseThinking')}
              className={clsx(styles.greenSwitch, autoCollapseThinking && styles.greenSwitchOn)}
              onClick={() => setAutoCollapseThinking(!autoCollapseThinking)}
            >
              <span className={styles.greenSwitchThumb} />
            </button>
          </div>
        </div>
      </div>

      <div className={clsx(styles.card, styles.standaloneCard)}>
        <div className={styles.subCell}>
          <div className={styles.label}>{t('settingsPersonalization')}</div>
          <div className={styles.description} style={{ marginTop: 4 }}>
            {t('settingsPersonalizationHint')}
          </div>
          <textarea
            className={styles.textareaBox}
            value={draft}
            maxLength={2000}
            placeholder={t('settingsPersonalizationPlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.textareaActions}>
            <Button
              variant="outlined"
              size="m"
              disabled={!draft && !saved}
              onClick={() => {
                setDraft('')
                setCustomInstructions('')
                showToast({ key: 'settingsPersonalizationSaved' })
              }}
            >
              {t('delete')}
            </Button>
            <Button
              variant="primary"
              size="m"
              disabled={draft.trim() === saved}
              onClick={() => {
                setCustomInstructions(draft.trim())
                showToast({ key: 'settingsPersonalizationSaved' })
              }}
            >
              {t('save')}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

export const LocationPage = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const region = location?.region
  const cities = location?.province
    ? provinces.find((p) => p.code === location.province)?.cities
    : undefined
  const labelLocale = locale === 'zh-CN' || isChineseBrowser() ? 'zh-CN' : 'en-US'

  const regionOptions = [
    { value: '', label: t('settingsLocationUnset') },
    ...regionCodes.map((code) => ({ value: code, label: getRegionName(code, labelLocale) })),
  ]
  const provinceOptions = provinces.map((p) => ({ value: p.code, label: p.name }))
  const cityOptions = (cities ?? []).map((city) => ({ value: city.code, label: city.name }))

  return (
    <div className={styles.card}>
      <div className={styles.cell}>
        <div className={clsx(styles.row, styles.locationCell)}>
          <div className={styles.text}>
            <span className={styles.label}>{t('settingsLocation')}</span>
          </div>
          <div className={styles.locationSelectors}>
            <Select
              value={region ?? ''}
              ariaLabel={t('settingsLocationRegion')}
              placeholder={t('settingsLocationRegion')}
              options={regionOptions}
              onChange={(nextRegion) => setLocation(nextRegion ? { region: nextRegion } : null)}
            />
            {region === 'CN' && (
              <>
                <Select
                  value={location?.province ?? ''}
                  ariaLabel={t('settingsLocationProvince')}
                  placeholder={t('settingsLocationProvince')}
                  options={provinceOptions}
                  onChange={(provinceCode) => {
                    const nextCities = provinces.find((p) => p.code === provinceCode)?.cities
                    setLocation({ region: 'CN', province: provinceCode, city: nextCities?.[0]?.code })
                  }}
                />
                {cities && cities.length > 0 && (
                  <Select
                    value={location?.city ?? ''}
                    ariaLabel={t('settingsLocationCity')}
                    placeholder={t('settingsLocationCity')}
                    options={cityOptions}
                    onChange={(cityCode) =>
                      setLocation({ region: 'CN', province: location?.province, city: cityCode })
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const VoiceLanguagePage = () => {
  const t = useTranslate()
  const voiceLanguage = useSettings((state) => state.voiceLanguage)

  const options: Array<{ value: VoiceLanguage; label: string }> = [
    { value: 'auto', label: t('settingsVoiceLangAuto') },
    { value: 'zh-CN', label: t('settingsVoiceLangZh') },
    { value: 'en-US', label: t('settingsVoiceLangEn') },
  ]

  return (
    <>
      <div className={styles.card}>
        {options.map((option) => {
          const selected = voiceLanguage === option.value
          return (
            <button
              key={option.value}
              type="button"
              className={styles.menuRow}
              onClick={() => setVoiceLanguage(option.value)}
            >
              <span className={clsx(styles.menuRowLabel, selected && styles.pickerOptionSelected)}>
                {option.label}
              </span>
              {selected && (
                <span className={styles.pickerOptionSelected}>
                  <IconCheckOutline16 />
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className={styles.cardCaption}>{t('settingsVoiceCaption')}</div>
    </>
  )
}

export { TtsVoicesPage } from './TtsVoicesPage.js'

export const TermsPage = () => {
  const t = useTranslate()
  return (
    <>
      <div className={styles.card}>
        <div className={styles.aboutHero}>
          <img src={deepsageIcon} alt={t('appName')} className={styles.aboutLogo} />
          <div className={styles.aboutIdentity}>
            <span className={styles.aboutTitle}>{t('appName')}</span>
            <span className={styles.description}>{t('aboutAppDescription')}</span>
          </div>
        </div>

        <div className={styles.subCell}>
          <div className={styles.row}>
            <span className={styles.label}>{t('aboutVersionLabel')}</span>
            <span className={styles.aboutValue}>{getAppVersion()}</span>
          </div>
        </div>

        <div className={styles.subCell}>
          <div className={styles.row}>
            <span className={styles.label}>{t('aboutPackageIdLabel')}</span>
            <span className={styles.aboutValue}>com.deepsage.app</span>
          </div>
        </div>

        <div className={styles.subCell}>
          <div className={styles.row}>
            <span className={styles.label}>{t('aboutApiEndpointLabel')}</span>
            <span className={styles.aboutValue}>api.deepseek.com</span>
          </div>
        </div>
      </div>

      <div className={clsx(styles.card, styles.standaloneCard)}>
        <div className={styles.subCell}>
          <div className={styles.label}>{t('aboutLicenseLabel')}</div>
          <div className={styles.description} style={{ marginTop: 4 }}>
            {t('aboutLicenseDescription')}
          </div>
          <pre className={styles.licenseText}>{mitLicenseText}</pre>
        </div>
      </div>
    </>
  )
}

export const HelpPage = () => {
  const t = useTranslate()
  return (
    <div className={styles.card}>
      <div className={styles.subCell}>
        <div className={styles.helpTitle}>{t('settingsHelpIntro')}</div>
      </div>
      <div className={styles.subCell}>
        <div className={styles.helpTitle}>{t('settingsHelpApiKeyTitle')}</div>
        <div className={styles.description}>{t('settingsHelpApiKeyBody')}</div>
      </div>
      <div className={styles.subCell}>
        <div className={styles.helpTitle}>{t('settingsHelpVoiceTitle')}</div>
        <div className={styles.description}>{t('settingsHelpVoiceBody')}</div>
      </div>
      <div className={styles.subCell}>
        <div className={styles.helpTitle}>{t('settingsHelpBackupTitle')}</div>
        <div className={styles.description}>{t('settingsHelpBackupBody')}</div>
      </div>
    </div>
  )
}
