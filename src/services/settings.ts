import { create } from 'zustand'
import { TTS_VOICES, type TtsVoice } from './speech/voices.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；0.2.0 默认浅色 */
export type ThemePreference = 'light' | 'dark' | 'system'

export type VoiceLanguage = 'auto' | 'zh-CN' | 'en-US'

export type FontScaleMode = 'system' | 'custom'

export type UserProfile = {
  name: string
  avatar: string | null
}

/** 7 档字体缩放倍率，索引 2 为「标准」1.0 */
export const FONT_SCALE_STOPS = [0.85, 0.92, 1, 1.08, 1.16, 1.25, 1.35] as const
export const DEFAULT_FONT_SCALE_INDEX = 2

/** 本机设置，存 localStorage */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  ttsVoiceUri: string | null
  voiceLanguage: VoiceLanguage
  autoRead: boolean
  fontScaleMode: FontScaleMode
  fontScaleIndex: number
  customInstructions: string
  autoCollapseThinking: boolean
  profile: UserProfile
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  ttsVoiceUri: 'chat-demo:tts-voice-uri',
  voiceLanguage: 'chat-demo:voice-language',
  autoRead: 'chat-demo:auto-read',
  fontScaleMode: 'chat-demo:font-scale-mode',
  fontScaleIndex: 'chat-demo:font-scale-index',
  customInstructions: 'chat-demo:custom-instructions',
  autoCollapseThinking: 'chat-demo:auto-collapse-thinking',
  profile: 'chat-demo:profile',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时默认浅色 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'dark' || saved === 'system' ? saved : 'light'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => {
  const saved = read(KEYS.ttsVoice)
  return TTS_VOICES.some((voice) => voice.id === saved) ? (saved as TtsVoice) : 'stella'
}

/** 思考内容自动折叠：未保存过时默认开启（与官方一致） */
const initialAutoCollapseThinking = (): boolean =>
  read(KEYS.autoCollapseThinking) !== 'false'

const initialVoiceLanguage = (): VoiceLanguage => {
  const saved = read(KEYS.voiceLanguage)
  return saved === 'zh-CN' || saved === 'en-US' ? saved : 'auto'
}

const initialFontScaleMode = (): FontScaleMode =>
  read(KEYS.fontScaleMode) === 'custom' ? 'custom' : 'system'

const initialFontScaleIndex = (): number => {
  const parsed = Number(read(KEYS.fontScaleIndex))
  return Number.isInteger(parsed) && parsed >= 0 && parsed < FONT_SCALE_STOPS.length
    ? parsed
    : DEFAULT_FONT_SCALE_INDEX
}

const initialProfile = (): UserProfile => {
  try {
    const raw = JSON.parse(read(KEYS.profile) ?? 'null') as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>
      return {
        name: typeof record.name === 'string' ? record.name : '',
        avatar: typeof record.avatar === 'string' ? record.avatar : null,
      }
    }
  } catch {
    // 忽略损坏的本地资料
  }
  return { name: '', avatar: null }
}

export const getChatFontScale = (mode: FontScaleMode, index: number): number =>
  mode === 'system' ? 1 : (FONT_SCALE_STOPS[index] ?? 1)

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  ttsVoiceUri: read(KEYS.ttsVoiceUri),
  voiceLanguage: initialVoiceLanguage(),
  autoRead: read(KEYS.autoRead) === 'true',
  fontScaleMode: initialFontScaleMode(),
  fontScaleIndex: initialFontScaleIndex(),
  customInstructions: read(KEYS.customInstructions) ?? '',
  autoCollapseThinking: initialAutoCollapseThinking(),
  profile: initialProfile(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setTtsVoiceUri = (ttsVoiceUri: string | null) => {
  write(KEYS.ttsVoiceUri, ttsVoiceUri)
  useSettings.setState({ ttsVoiceUri })
}

export const setVoiceLanguage = (voiceLanguage: VoiceLanguage) => {
  write(KEYS.voiceLanguage, voiceLanguage)
  useSettings.setState({ voiceLanguage })
}

export const setAutoRead = (autoRead: boolean) => {
  write(KEYS.autoRead, String(autoRead))
  useSettings.setState({ autoRead })
}

export const setFontScaleMode = (fontScaleMode: FontScaleMode) => {
  write(KEYS.fontScaleMode, fontScaleMode)
  useSettings.setState({ fontScaleMode })
}

export const setFontScaleIndex = (fontScaleIndex: number) => {
  const clamped = Math.max(0, Math.min(FONT_SCALE_STOPS.length - 1, Math.round(fontScaleIndex)))
  write(KEYS.fontScaleIndex, String(clamped))
  write(KEYS.fontScaleMode, 'custom')
  useSettings.setState({ fontScaleMode: 'custom', fontScaleIndex: clamped })
}

export const setCustomInstructions = (customInstructions: string) => {
  write(KEYS.customInstructions, customInstructions)
  useSettings.setState({ customInstructions })
}

export const setAutoCollapseThinking = (autoCollapseThinking: boolean) => {
  write(KEYS.autoCollapseThinking, String(autoCollapseThinking))
  useSettings.setState({ autoCollapseThinking })
}

export const setProfile = (profile: UserProfile) => {
  write(KEYS.profile, JSON.stringify(profile))
  useSettings.setState({ profile })
}

export const resetProfile = () => {
  write(KEYS.profile, null)
  useSettings.setState({ profile: { name: '', avatar: null } })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

/** 语音识别使用的 BCP-47 语言标签 */
export const resolveVoiceLanguageTag = (
  voiceLanguage: VoiceLanguage,
  locale: Locale
): 'zh-CN' | 'en-US' => (voiceLanguage === 'auto' ? locale : voiceLanguage)
