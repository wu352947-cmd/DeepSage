/** 官方朗读音色：贝壳（mira）、白浪（echo）、海星（stella）、暗潮（tide） */
export type TtsVoice = 'mira' | 'echo' | 'stella' | 'tide'

export type TtsVoicePreset = {
  id: TtsVoice
  nameKey:
    | 'settingsTtsVoiceMira'
    | 'settingsTtsVoiceEcho'
    | 'settingsTtsVoiceStella'
    | 'settingsTtsVoiceTide'
  descKey:
    | 'settingsTtsVoiceMiraDesc'
    | 'settingsTtsVoiceEchoDesc'
    | 'settingsTtsVoiceStellaDesc'
    | 'settingsTtsVoiceTideDesc'
  /** 公开 /v1/tools/tts 仅开放 stella / tide 时自动回退的音色 */
  apiFallback: 'stella' | 'tide'
  /** 本地设备 TTS 降级时区分音色风格 */
  localRate: number
  localPitch: number
}

export const TTS_VOICES: readonly TtsVoicePreset[] = [
  {
    id: 'mira',
    nameKey: 'settingsTtsVoiceMira',
    descKey: 'settingsTtsVoiceMiraDesc',
    apiFallback: 'stella',
    localRate: 1.05,
    localPitch: 1.1,
  },
  {
    id: 'echo',
    nameKey: 'settingsTtsVoiceEcho',
    descKey: 'settingsTtsVoiceEchoDesc',
    apiFallback: 'tide',
    localRate: 1.0,
    localPitch: 0.94,
  },
  {
    id: 'stella',
    nameKey: 'settingsTtsVoiceStella',
    descKey: 'settingsTtsVoiceStellaDesc',
    apiFallback: 'stella',
    localRate: 1.03,
    localPitch: 1.16,
  },
  {
    id: 'tide',
    nameKey: 'settingsTtsVoiceTide',
    descKey: 'settingsTtsVoiceTideDesc',
    apiFallback: 'tide',
    localRate: 0.94,
    localPitch: 0.82,
  },
]

export const getTtsVoicePreset = (voice: TtsVoice): TtsVoicePreset =>
  TTS_VOICES.find((item) => item.id === voice) ?? TTS_VOICES[2]
