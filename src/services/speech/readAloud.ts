import { Capacitor } from '@capacitor/core'
import { QueueStrategy, TextToSpeech, type SpeechSynthesisVoice } from '@capacitor-community/text-to-speech'
import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize, TTS_SAMPLE_RATE } from '../api/speech.js'
import { resolveVoiceLanguageTag, useSettings } from '../settings.js'
import { stripMarkdownForSpeech, extractSpeakableSlice } from './stripMarkdown.js'
import { getTtsVoicePreset, type TtsVoice } from './voices.js'

export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

export type TtsVoiceItem = {
  index: number
  voiceURI: string
  name: string
  lang: string
  localService: boolean
  default: boolean
}

type ReadAloudState = {
  /** 正在朗读的回复 id，试听音色时为 '__preview__' */
  messageId: string | null
  status: ReadAloudStatus
  /** 正在试听的官方音色 */
  previewVoice: TtsVoice | null
}

export const useReadAloud = create<ReadAloudState>(() => ({
  messageId: null,
  status: 'idle',
  previewVoice: null,
}))

type QueuedUtterance = {
  text: string
  voice: TtsVoice
  isPreview?: boolean
}

const START_DELAY = 0.08
const MAX_LOCAL_CHUNK = 400

let generation = 0
let queue: QueuedUtterance[] = []
let running = false
let autoStream: { messageId: string; spokenOffset: number } | null = null
let cachedLanguages: string[] | null = null
let activeApi: { controller: AbortController; context: AudioContext } | null = null
const unsupportedApiVoices = new Set<TtsVoice>()

const isDeviceSpeechSupported = () =>
  Capacitor.isNativePlatform() || (typeof window !== 'undefined' && 'speechSynthesis' in window)

const isAudioPlaybackSupported = () =>
  typeof AudioContext !== 'undefined' ||
  (typeof window !== 'undefined' &&
    'webkitAudioContext' in (window as unknown as Record<string, unknown>))

const pickLanguageForText = (text: string): 'zh-CN' | 'en-US' => {
  const { voiceLanguage, locale } = useSettings.getState()
  if (voiceLanguage !== 'auto') {
    return voiceLanguage
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'zh-CN'
  }
  if (/[a-zA-Z]{2,}/.test(text)) {
    return 'en-US'
  }
  return locale
}

/** 列出可用系统 TTS 音色（备用）。 */
export const listTtsVoices = async (): Promise<TtsVoiceItem[]> => {
  if (!isDeviceSpeechSupported()) {
    return []
  }
  try {
    let { voices } = await TextToSpeech.getSupportedVoices()
    if (!Capacitor.isNativePlatform() && voices.length === 0 && 'speechSynthesis' in window) {
      await new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
          if (!done) {
            done = true
            window.speechSynthesis.removeEventListener('voiceschanged', finish)
            resolve()
          }
        }
        window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true })
        setTimeout(finish, 300)
      })
      voices = (await TextToSpeech.getSupportedVoices()).voices
    }
    return voices.map((voice: SpeechSynthesisVoice, index: number) => ({
      index,
      voiceURI: voice.voiceURI,
      name: voice.name || voice.voiceURI,
      lang: voice.lang,
      localService: voice.localService,
      default: voice.default,
    }))
  } catch {
    return []
  }
}

const getSupportedLangs = async (): Promise<string[]> => {
  if (cachedLanguages) {
    return cachedLanguages
  }
  try {
    const { languages } = await TextToSpeech.getSupportedLanguages()
    cachedLanguages = languages
    return languages
  } catch {
    return []
  }
}

const resolveBestLang = async (desired: string): Promise<string> => {
  if (!Capacitor.isNativePlatform()) {
    return desired
  }
  const supported = await getSupportedLangs()
  if (supported.length === 0 || supported.includes(desired)) {
    return desired
  }
  const prefix = desired.split('-')[0]?.toLowerCase() ?? ''
  const partial = supported.find((tag) => tag.toLowerCase().startsWith(prefix))
  return partial ?? supported[0] ?? desired
}

/** 16-bit 小端 PCM 转成 Float32；奇数字节留到下一段 */
const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

const closeActiveApi = (controller?: AbortController) => {
  if (!activeApi || (controller && activeApi.controller !== controller)) {
    return
  }
  const { controller: currentController, context } = activeApi
  activeApi = null
  currentController.abort()
  void context.close().catch(() => {})
}

const createAudioContext = (): AudioContext => {
  const Ctor =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  return new Ctor({ sampleRate: TTS_SAMPLE_RATE })
}

const speakViaApi = async (
  text: string,
  voice: TtsVoice,
  apiKey: string,
  gen: number
): Promise<void> => {
  if (gen !== generation || !text.trim()) {
    return
  }
  const preset = getTtsVoicePreset(voice)
  const controller = new AbortController()
  const context = createAudioContext()
  activeApi = { controller, context }

  try {
    if (context.state === 'suspended') {
      await context.resume().catch(() => {})
    }
    const targetVoice = unsupportedApiVoices.has(voice) ? preset.apiFallback : voice
    let stream: ReadableStream<Uint8Array>
    try {
      stream = await synthesize(apiKey, text, targetVoice, controller.signal)
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        targetVoice !== preset.apiFallback &&
        !controller.signal.aborted
      ) {
        unsupportedApiVoices.add(voice)
        stream = await synthesize(apiKey, text, preset.apiFallback, controller.signal)
      } else {
        throw error
      }
    }

    if (gen !== generation || controller.signal.aborted) {
      return
    }

    const reader = stream.getReader()
    const onAbort = () => void reader.cancel().catch(() => {})
    controller.signal.addEventListener('abort', onAbort, { once: true })

    let nextTime = 0
    let lastSource: AudioBufferSourceNode | null = null
    let rest = new Uint8Array(0)

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done || gen !== generation || controller.signal.aborted) {
          break
        }
        const bytes = new Uint8Array(rest.length + value.length)
        bytes.set(rest)
        bytes.set(value, rest.length)
        const samples = toFloat32(bytes)
        rest = bytes.slice(samples.length * 2)
        if (samples.length === 0) {
          continue
        }
        const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
        source.start(nextTime)
        nextTime += buffer.duration
        lastSource = source
        if (gen === generation && useReadAloud.getState().status === 'loading') {
          useReadAloud.setState({ status: 'playing' })
        }
      }
      if (lastSource && gen === generation && !controller.signal.aborted) {
        const finalSource = lastSource
        await new Promise<void>((resolve) => {
          const done = () => resolve()
          finalSource.onended = done
          controller.signal.addEventListener('abort', done, { once: true })
        })
      }
    } finally {
      controller.signal.removeEventListener('abort', onAbort)
    }
  } finally {
    closeActiveApi(controller)
  }
}

const speakViaDevice = async (text: string, voice: TtsVoice, gen: number): Promise<void> => {
  if (gen !== generation || !text.trim() || !isDeviceSpeechSupported()) {
    return
  }
  const preset = getTtsVoicePreset(voice)
  const desiredLang = pickLanguageForText(text)
  const lang = await resolveBestLang(desiredLang)
  if (gen !== generation) {
    return
  }

  if (gen === generation && useReadAloud.getState().status === 'loading') {
    useReadAloud.setState({ status: 'playing' })
  }

  if (!Capacitor.isNativePlatform() && 'speechSynthesis' in window) {
    await new Promise<void>((resolve, reject) => {
      try {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = lang
        utterance.rate = preset.localRate
        utterance.pitch = preset.localPitch
        let settled = false
        const done = () => {
          if (!settled) {
            settled = true
            resolve()
          }
        }
        utterance.onend = done
        utterance.onerror = (event) => {
          if (!settled) {
            settled = true
            reject(new Error(event.error || 'tts_error'))
          }
        }
        window.speechSynthesis.speak(utterance)
        // 无语音引擎时部分无头浏览器既不触发 onend 也不触发 onerror，保底超时防止死锁
        setTimeout(() => {
          if (!settled && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            done()
          }
        }, 1200)
      } catch (error) {
        reject(error)
      }
    })
    return
  }

  await TextToSpeech.speak({
    text: text.slice(0, MAX_LOCAL_CHUNK),
    lang,
    rate: preset.localRate,
    pitch: preset.localPitch,
    volume: 1.0,
    queueStrategy: QueueStrategy.Add,
  })
}

const isAuthOrQuotaError = (error: unknown) => {
  const kind = classifyApiError(error)
  return kind === 'unauthorized' || kind === 'insufficientBalance' || kind === 'rateLimited'
}

const speakSingleUtterance = async (item: QueuedUtterance, gen: number): Promise<void> => {
  if (gen !== generation || !item.text.trim()) {
    return
  }
  const { apiKey } = useSettings.getState()
  if (apiKey && isAudioPlaybackSupported()) {
    try {
      await speakViaApi(item.text, item.voice, apiKey, gen)
      return
    } catch (error) {
      if (gen !== generation) {
        return
      }
      if (!item.isPreview && isAuthOrQuotaError(error)) {
        throw error
      }
      if (!isDeviceSpeechSupported()) {
        if (item.isPreview) {
          return
        }
        throw error
      }
    }
  }
  await speakViaDevice(item.text, item.voice, gen)
}

const drainQueue = async (gen: number, onError?: (error: unknown) => void) => {
  if (running) {
    return
  }
  running = true
  try {
    while (gen === generation && queue.length > 0) {
      const next = queue.shift()
      if (!next) {
        continue
      }
      try {
        await speakSingleUtterance(next, gen)
      } catch (error) {
        if (gen === generation) {
          onError?.(error)
        }
        break
      }
    }
  } finally {
    running = false
    if (gen === generation && queue.length === 0) {
      useReadAloud.setState({ messageId: null, status: 'idle', previewVoice: null })
    }
  }
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  if (error instanceof ApiError && error.kind === 'protocol') {
    return error.message
  }
  if (error instanceof ApiError && error.status === 400) {
    return { key: 'ttsUnavailable' }
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return { key: 'apiKeyInvalidRetry' }
    case 'insufficientBalance':
      return { key: 'insufficientBalance' }
    case 'rateLimited':
      return { key: 'rateLimited' }
    default:
      return error instanceof Error && error.message === 'TTS unavailable'
        ? { key: 'ttsUnavailable' }
        : { key: 'ttsFailed' }
  }
}

/** 停止当前朗读并清空排队内容。 */
export const stopReadAloud = () => {
  generation += 1
  queue = []
  running = false
  autoStream = null
  closeActiveApi()
  useReadAloud.setState({ messageId: null, status: 'idle', previewVoice: null })
  if (isDeviceSpeechSupported()) {
    if (!Capacitor.isNativePlatform() && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        // 忽略
      }
    } else {
      void TextToSpeech.stop().catch(() => {})
    }
  }
}

const splitSpeakableSentences = (cleaned: string): string[] => {
  const sentences = cleaned
    .split(/(?<=[。！？；.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return sentences.length > 0 ? sentences : [cleaned]
}

/** 朗读指定回答正文；再次点击同一条则停止。 */
export const toggleReadAloud = (
  messageId: string,
  markdownText: string,
  onError: (error: unknown) => void
) => {
  const reading = useReadAloud.getState().messageId
  stopReadAloud()
  if (reading === messageId) {
    return
  }
  const { apiKey, ttsVoice } = useSettings.getState()
  if (!(apiKey && isAudioPlaybackSupported()) && !isDeviceSpeechSupported()) {
    onError(new Error('TTS unavailable'))
    return
  }
  const cleaned = stripMarkdownForSpeech(markdownText)
  if (!cleaned) {
    return
  }
  const gen = generation
  useReadAloud.setState({ messageId, status: 'loading', previewVoice: null })
  queue = splitSpeakableSentences(cleaned).map((text) => ({ text, voice: ttsVoice }))
  void drainQueue(gen, onError)
}

const PREVIEW_SAMPLES: Record<TtsVoice, { zh: string; en: string }> = {
  mira: {
    zh: '你好，我是贝壳，很高兴陪你聊天和朗读内容。',
    en: 'Hi, I am Mira. Happy to chat and read aloud with you.',
  },
  echo: {
    zh: '你好，我是白浪，为你清晰朗读每一段内容。',
    en: 'Hello, I am Echo. I will read every message clearly for you.',
  },
  stella: {
    zh: '你好，我是海星，一起来听听今天的回答吧。',
    en: 'Hi there, I am Stella. Let us listen to today’s answer together.',
  },
  tide: {
    zh: '你好，我是暗潮，很高兴为你朗读这段内容。',
    en: 'Hello, I am Tide. Glad to read this passage aloud for you.',
  },
}

/** 试听指定官方音色（设置 -> 语音 -> 朗读音色）。 */
export const previewTtsVoice = (voice: TtsVoice) => {
  stopReadAloud()
  const { apiKey, locale, voiceLanguage } = useSettings.getState()
  if (!(apiKey && isAudioPlaybackSupported()) && !isDeviceSpeechSupported()) {
    return
  }
  const resolvedLang = resolveVoiceLanguageTag(voiceLanguage, locale)
  const isZh = resolvedLang.toLowerCase().startsWith('zh')
  const sampleText = isZh ? PREVIEW_SAMPLES[voice].zh : PREVIEW_SAMPLES[voice].en
  const gen = generation
  useReadAloud.setState({ messageId: '__preview__', status: 'loading', previewVoice: voice })
  queue = [{ text: sampleText, voice, isPreview: true }]
  void drainQueue(gen)
}

/** 重置自动朗读跟踪状态（切换会话或取消自动朗读时调用）。 */
export const resetAutoReadTracking = () => {
  autoStream = null
}

/**
 * 流式生成过程中调用：开启自动朗读时，随回答流式输出剥除 Markdown 与代码后逐句朗读。
 */
export const syncAutoReadReply = (
  messageId: string,
  fullAnswerMarkdown: string,
  isStreaming: boolean
) => {
  const { autoRead, apiKey, ttsVoice } = useSettings.getState()
  if (!autoRead || (!(apiKey && isAudioPlaybackSupported()) && !isDeviceSpeechSupported())) {
    return
  }
  if (autoStream === null || autoStream.messageId !== messageId) {
    if (!fullAnswerMarkdown.trim()) {
      return
    }
    stopReadAloud()
    autoStream = { messageId, spokenOffset: 0 }
    useReadAloud.setState({ messageId, status: 'loading', previewVoice: null })
  }
  for (;;) {
    const slice = extractSpeakableSlice(fullAnswerMarkdown, autoStream.spokenOffset, !isStreaming)
    if (!slice) {
      break
    }
    autoStream.spokenOffset = slice.nextOffset
    if (slice.text) {
      queue.push({ text: slice.text, voice: ttsVoice })
    }
    if (!isStreaming || autoStream.spokenOffset >= fullAnswerMarkdown.length) {
      break
    }
  }
  if (queue.length > 0 && !running) {
    if (useReadAloud.getState().messageId !== messageId) {
      useReadAloud.setState({ messageId, status: 'loading', previewVoice: null })
    }
    void drainQueue(generation)
  }
  if (!isStreaming) {
    autoStream = null
  }
}
