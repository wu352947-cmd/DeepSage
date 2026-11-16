import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslationMessage } from '../../i18n/index.js'
import { transcribe } from '../../services/api/speech.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { resolveVoiceLanguageTag, useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing'

type BrowserSpeechRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type BrowserSpeechRecognitionEvent = {
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition
}

const getBrowserSpeechCtor = () => {
  if (typeof window === 'undefined') {
    return undefined
  }
  const win = window as SpeechRecognitionWindow
  return win.SpeechRecognition ?? win.webkitSpeechRecognition
}

type PermissionMap = Record<string, unknown> & { speechRecognition?: string }

const isMicPermissionGranted = (perm: PermissionMap | null | undefined) => {
  if (!perm) {
    return false
  }
  if (perm.speechRecognition === 'granted') {
    return true
  }
  return Object.values(perm).includes('granted')
}

const hasAndroidRecordAudioPermission = (): boolean | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const native = (
      window as unknown as {
        DeepSageNative?: { hasRecordAudioPermission?: () => boolean }
      }
    ).DeepSageNative
    if (typeof native?.hasRecordAudioPermission !== 'function') {
      return null
    }
    return Boolean(native.hasRecordAudioPermission())
  } catch {
    return null
  }
}

const describeRecordingError = (error: unknown): TranslationMessage => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return { key: 'voiceInputPermissionDenied' }
    }
    if (error.name === 'NotFoundError') {
      return { key: 'voiceInputNoDevice' }
    }
  }
  return { key: 'voiceInputFailed' }
}

const MIN_HOLD_MS = 180

/**
 * 按住说话（Hold-to-speak）语音转文字：
 * 1) Android 原生端优先使用 Capacitor SpeechRecognition 插件；
 * 2) Web 端或原生不可用时降级到浏览器 Web Speech API；
 * 3) 若均不可用且处于安全上下文并已配置 API Key，则降级到录音 + /v1/tools/asr；
 * 4) 以上均不可用时优雅提示，不报错崩溃。
 */
export const useVoiceInput = (onText: (text: string) => void) => {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [seconds, setSeconds] = useState(0)
  const [interimText, setInterimText] = useState('')

  const statusRef = useRef<VoiceInputStatus>('idle')
  statusRef.current = status
  const holdingRef = useRef(false)
  const holdStartRef = useRef(0)
  const operationRef = useRef(0)
  const modeRef = useRef<'none' | 'capacitor' | 'webspeech' | 'recorder'>('none')
  const partialRef = useRef('')
  const listenersRef = useRef<PluginListenerHandle[]>([])
  const browserRecRef = useRef<BrowserSpeechRecognition | null>(null)
  const browserEndResolveRef = useRef<(() => void) | null>(null)
  const recordingRef = useRef<Recording | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const clearNativeListeners = useCallback(async () => {
    const handles = listenersRef.current.splice(0)
    await Promise.all(handles.map((h) => h.remove().catch(() => {})))
  }, [])

  const cancel = useCallback(() => {
    operationRef.current += 1
    holdingRef.current = false
    modeRef.current = 'none'
    partialRef.current = ''
    setInterimText('')

    void clearNativeListeners()
    if (Capacitor.isNativePlatform()) {
      void SpeechRecognition.stop().catch(() => {})
    }
    try {
      browserRecRef.current?.abort()
    } catch {
      // 忽略
    }
    browserRecRef.current = null
    browserEndResolveRef.current?.()
    browserEndResolveRef.current = null

    recordingRef.current?.cancel()
    recordingRef.current = null
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus('idle')
  }, [clearNativeListeners])

  const commitTranscript = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (trimmed) {
      onTextRef.current(trimmed)
    } else {
      showToast({ key: 'voiceInputEmpty' })
    }
  }, [])

  const stopHold = useCallback(async () => {
    if (!holdingRef.current) {
      return
    }
    holdingRef.current = false
    const heldMs = Date.now() - holdStartRef.current
    const operation = operationRef.current
    const mode = modeRef.current

    if (statusRef.current !== 'recording') {
      return
    }

    if (heldMs < MIN_HOLD_MS && !partialRef.current.trim()) {
      cancel()
      showToast({ key: 'voiceInputHoldHint' })
      return
    }

    if (mode === 'capacitor') {
      setStatus('transcribing')
      // SpeechRecognition.java 7.0.1 的 stop() 不会 resolve Promise，不能无超时 await
      void SpeechRecognition.stop().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 420))
      if (operationRef.current !== operation) {
        return
      }
      const finalText = partialRef.current
      await clearNativeListeners()
      modeRef.current = 'none'
      partialRef.current = ''
      setInterimText('')
      setStatus('idle')
      commitTranscript(finalText)
      return
    }

    if (mode === 'webspeech') {
      setStatus('transcribing')
      const rec = browserRecRef.current
      if (rec) {
        await new Promise<void>((resolve) => {
          browserEndResolveRef.current = resolve
          try {
            rec.stop()
          } catch {
            resolve()
          }
          setTimeout(resolve, 450)
        })
      }
      if (operationRef.current !== operation) {
        return
      }
      const finalText = partialRef.current
      browserRecRef.current = null
      browserEndResolveRef.current = null
      modeRef.current = 'none'
      partialRef.current = ''
      setInterimText('')
      setStatus('idle')
      commitTranscript(finalText)
      return
    }

    if (mode === 'recorder') {
      const recording = recordingRef.current
      recordingRef.current = null
      modeRef.current = 'none'
      if (!recording) {
        setStatus('idle')
        return
      }
      let controller: AbortController | null = null
      try {
        let audio: Blob | null
        try {
          audio = await recording.stop()
        } finally {
          recording.cancel()
        }
        if (operationRef.current !== operation || !audio) {
          return
        }
        controller = new AbortController()
        controllerRef.current = controller
        setStatus('transcribing')
        const text = await transcribe(
          useSettings.getState().apiKey ?? '',
          audio,
          controller.signal
        )
        if (controller.signal.aborted || operationRef.current !== operation) {
          return
        }
        commitTranscript(text)
      } catch {
        if (operationRef.current === operation && !controller?.signal.aborted) {
          showToast({ key: 'voiceInputFailed' })
        }
      } finally {
        if (operationRef.current === operation) {
          controllerRef.current = null
          setStatus('idle')
        }
      }
      return
    }

    setStatus('idle')
  }, [cancel, clearNativeListeners, commitTranscript])

  const startHold = useCallback(async () => {
    if (statusRef.current !== 'idle' || holdingRef.current) {
      return
    }
    holdingRef.current = true
    holdStartRef.current = Date.now()
    const operation = ++operationRef.current
    partialRef.current = ''
    setInterimText('')

    const { voiceLanguage, locale, apiKey } = useSettings.getState()
    const sttLang = resolveVoiceLanguageTag(voiceLanguage, locale)

    // 1. 原生端先确认麦克风权限，再尝试系统语音识别
    if (Capacitor.isNativePlatform()) {
      try {
        let perm = (await SpeechRecognition.checkPermissions()) as PermissionMap
        if (!isMicPermissionGranted(perm) && hasAndroidRecordAudioPermission() !== true) {
          perm = (await SpeechRecognition.requestPermissions()) as PermissionMap
        }
        if (!holdingRef.current || operationRef.current !== operation) {
          return
        }
        const androidGranted = hasAndroidRecordAudioPermission()
        if (!isMicPermissionGranted(perm) && androidGranted !== true) {
          holdingRef.current = false
          showToast({ key: 'voiceInputPermissionDenied', type: 'error' })
          return
        }

        const { available } = await SpeechRecognition.available()
        if (!holdingRef.current || operationRef.current !== operation) {
          return
        }
        if (available) {
          await clearNativeListeners()
          const partialHandle = await SpeechRecognition.addListener('partialResults', (data) => {
            if (operationRef.current !== operation) {
              return
            }
            const text = data.matches?.[0] ?? ''
            if (text) {
              partialRef.current = text
              setInterimText(text)
            }
          })
          const stateHandle = await SpeechRecognition.addListener('listeningState', (data) => {
            if (operationRef.current !== operation) {
              return
            }
            if (data.status === 'stopped' && holdingRef.current) {
              void stopHold()
            }
          })
          listenersRef.current.push(partialHandle, stateHandle)
          modeRef.current = 'capacitor'
          setStatus('recording')

          try {
            const res = await SpeechRecognition.start({
              language: sttLang,
              maxResults: 1,
              partialResults: true,
              popup: false,
            })
            if (res.matches?.[0]) {
              partialRef.current = res.matches[0]
              setInterimText(res.matches[0])
            }
            return
          } catch {
            // 小米等机型上系统识别服务常不可用，不要误报成没权限，改走备用录音识别
            await clearNativeListeners()
            modeRef.current = 'none'
            setStatus('idle')
          }
        }
      } catch {
        if (operationRef.current !== operation) {
          return
        }
        await clearNativeListeners()
        modeRef.current = 'none'
        setStatus('idle')
      }
    }

    // 2. 浏览器 Web Speech API 降级（Android WebView 里经常只有空壳，会把服务不可用误报成没权限，因此跳过）
    const BrowserSpeech = getBrowserSpeechCtor()
    if (BrowserSpeech && Capacitor.getPlatform() !== 'android') {
      try {
        const rec = new BrowserSpeech()
        rec.lang = sttLang
        rec.interimResults = true
        rec.continuous = true
        rec.onresult = (event) => {
          if (operationRef.current !== operation) {
            return
          }
          let combined = ''
          for (let i = 0; i < event.results.length; i += 1) {
            combined += event.results[i]?.[0]?.transcript ?? ''
          }
          partialRef.current = combined
          setInterimText(combined)
        }
        rec.onerror = (event) => {
          if (operationRef.current !== operation) {
            return
          }
          if (event.error === 'not-allowed') {
            cancel()
            showToast({ key: 'voiceInputPermissionDenied', type: 'error' })
          }
        }
        rec.onend = () => {
          browserEndResolveRef.current?.()
        }
        browserRecRef.current = rec
        modeRef.current = 'webspeech'
        setStatus('recording')
        rec.start()
        return
      } catch {
        browserRecRef.current = null
        modeRef.current = 'none'
      }
    }

    // 3. 安全上下文 + 已配置 API Key 时降级到录音 + ASR 接口
    const canRecordAsr =
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      Boolean(apiKey)

    if (canRecordAsr) {
      modeRef.current = 'recorder'
      setStatus('recording')
      try {
        const recording = await startRecording(() => {
          if (operationRef.current === operation) {
            showToast({ key: 'voiceInputLimitReached' })
            void stopHold()
          }
        })
        if (!holdingRef.current || operationRef.current !== operation) {
          recording.cancel()
          setStatus('idle')
          modeRef.current = 'none'
          return
        }
        recordingRef.current = recording
      } catch (error) {
        if (operationRef.current === operation) {
          holdingRef.current = false
          modeRef.current = 'none'
          setStatus('idle')
          showToast(describeRecordingError(error))
        }
      }
      return
    }

    // 4. 所有语音识别路径均不可用时优雅提示
    holdingRef.current = false
    modeRef.current = 'none'
    setStatus('idle')
    showToast({ key: 'voiceInputUnavailable' })
  }, [cancel, clearNativeListeners, stopHold])

  useEffect(() => {
    if (status !== 'recording') {
      return
    }
    const startedAt = Date.now()
    setSeconds(0)
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => cancel, [cancel])

  const getAnalyser = useCallback(() => recordingRef.current?.analyser ?? null, [])

  return {
    status,
    seconds,
    interimText,
    getAnalyser,
    startHold,
    stopHold,
    cancel,
  }
}
