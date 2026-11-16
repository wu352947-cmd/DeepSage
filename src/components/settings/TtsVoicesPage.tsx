import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { TTS_VOICES, type TtsVoice } from '../../services/speech/voices.js'
import { setTtsVoice, setTtsVoiceUri, useSettings } from '../../services/settings.js'
import { previewTtsVoice, stopReadAloud, useReadAloud } from '../../services/speech/readAloud.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { backSettingsPage } from './settingsDialogState.js'
import styles from './TtsVoicesPage.module.css'

type LiquidPalette = {
  base: [string, string, string]
  lobes: [string, string, string, string]
  sheen: string
  shadow: string
}

const VOICE_PALETTES: Record<TtsVoice, LiquidPalette> = {
  mira: {
    base: ['#e6f2ff', '#92c5ff', '#3b82f6'],
    lobes: [
      'rgba(59, 130, 246, 0.68)',
      'rgba(96, 165, 250, 0.72)',
      'rgba(147, 197, 253, 0.8)',
      'rgba(232, 244, 255, 0.72)',
    ],
    sheen: 'rgba(255, 255, 255, 0.42)',
    shadow: 'rgba(59, 130, 246, 0.16)',
  },
  echo: {
    base: ['#ecefff', '#a6b3ff', '#6366f1'],
    lobes: [
      'rgba(99, 102, 241, 0.68)',
      'rgba(129, 140, 248, 0.72)',
      'rgba(165, 180, 252, 0.78)',
      'rgba(238, 242, 255, 0.72)',
    ],
    sheen: 'rgba(255, 255, 255, 0.4)',
    shadow: 'rgba(99, 102, 241, 0.16)',
  },
  stella: {
    base: ['#fff9e2', '#fde078', '#f5a623'],
    lobes: [
      'rgba(245, 158, 11, 0.68)',
      'rgba(251, 191, 36, 0.72)',
      'rgba(253, 224, 104, 0.82)',
      'rgba(255, 249, 226, 0.75)',
    ],
    sheen: 'rgba(255, 255, 255, 0.44)',
    shadow: 'rgba(245, 158, 11, 0.16)',
  },
  tide: {
    base: ['#d9e6eb', '#8da8b5', '#647d8d'],
    lobes: [
      'rgba(114, 133, 148, 0.72)',
      'rgba(137, 169, 182, 0.76)',
      'rgba(181, 208, 217, 0.8)',
      'rgba(96, 122, 139, 0.66)',
    ],
    sheen: 'rgba(235, 245, 249, 0.42)',
    shadow: 'rgba(96, 122, 139, 0.18)',
  },
}

const CANVAS_W = 136
const CANVAS_H = 76
const SWIPE_THRESHOLD_PX = 42

const LOBE_PARAMS = [
  { fx: 0.71, fy: 0.53, phase: 0.2, rx: 0.28, ry: 0.22, scaleX: 1.48, scaleY: 0.78, radius: 0.56 },
  { fx: 0.49, fy: 0.79, phase: 1.9, rx: 0.3, ry: 0.24, scaleX: 1.25, scaleY: 0.92, radius: 0.52 },
  { fx: 0.61, fy: 0.41, phase: 3.7, rx: 0.26, ry: 0.24, scaleX: 1.38, scaleY: 0.82, radius: 0.5 },
  { fx: 0.37, fy: 0.67, phase: 5.1, rx: 0.24, ry: 0.2, scaleX: 1.28, scaleY: 0.86, radius: 0.46 },
] as const

const drawLiquidFrame = (
  ctx: CanvasRenderingContext2D,
  palette: LiquidPalette,
  t: number,
  energy: number
) => {
  const w = CANVAS_W
  const h = CANVAS_H

  const baseGrad = ctx.createLinearGradient(0, 0, w, h)
  baseGrad.addColorStop(0, palette.base[0])
  baseGrad.addColorStop(0.5, palette.base[1])
  baseGrad.addColorStop(1, palette.base[2])
  ctx.fillStyle = baseGrad
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < LOBE_PARAMS.length; i += 1) {
    const p = LOBE_PARAMS[i]
    const amp = 1 + energy * 0.22
    const cx = w * (0.5 + Math.sin(t * p.fx + p.phase) * p.rx * amp)
    const cy = h * (0.5 + Math.cos(t * p.fy + p.phase * 1.3) * p.ry * amp)
    const angle = t * (0.3 + i * 0.1) + p.phase
    const r = Math.max(w, h) * p.radius

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    ctx.scale(p.scaleX, p.scaleY)
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    grad.addColorStop(0, palette.lobes[i])
    grad.addColorStop(0.58, palette.lobes[i])
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // 两层横向有机液态丝绸波纹，契合官方横向胶囊液态流动质感
  for (let wave = 0; wave < 2; wave += 1) {
    const offset = wave * 2.3
    const yBase = h * (0.42 + wave * 0.22) + Math.sin(t * 0.85 + offset) * (5 + energy * 4)
    const y1 = yBase + Math.cos(t * 1.1 + offset) * (11 + energy * 6)
    const y2 = yBase - Math.sin(t * 0.8 + offset) * (13 + energy * 6)
    const yEnd = yBase + Math.sin(t * 1.0 + offset + 1.1) * (7 + energy * 5)

    const waveGrad = ctx.createLinearGradient(0, yBase - 18, 0, h)
    waveGrad.addColorStop(0, palette.sheen)
    waveGrad.addColorStop(0.52, 'rgba(255, 255, 255, 0.1)')
    waveGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')

    ctx.fillStyle = waveGrad
    ctx.beginPath()
    ctx.moveTo(-10, yBase)
    ctx.bezierCurveTo(w * 0.34, y1, w * 0.66, y2, w + 10, yEnd)
    ctx.lineTo(w + 10, h + 10)
    ctx.lineTo(-10, h + 10)
    ctx.closePath()
    ctx.fill()
  }
}

const LiquidVoiceBlob = ({
  voice,
  active,
  previewing,
}: {
  voice: TtsVoice
  active: boolean
  previewing: boolean
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewingRef = useRef(previewing)
  previewingRef.current = previewing

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }
    const palette = VOICE_PALETTES[voice]
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!active || reducedMotion) {
      drawLiquidFrame(ctx, palette, 1.4, 0)
      return
    }

    let frame = 0
    let lastTime = performance.now()
    let phase = 1.4
    let energy = previewingRef.current ? 1 : 0

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000))
      lastTime = now
      const targetEnergy = previewingRef.current ? 1 : 0
      energy += (targetEnergy - energy) * Math.min(1, dt * 6)
      phase += dt * (0.95 + energy * 1.15)
      drawLiquidFrame(ctx, palette, phase, energy)
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [voice, active])

  return (
    <div
      className={clsx(styles.blobFrame, active && styles.blobActive, previewing && styles.blobSpeaking)}
      style={{ '--blob-shadow': VOICE_PALETTES[voice].shadow } as React.CSSProperties}
    >
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className={styles.blobCanvas} />
      <div className={styles.blobGloss} aria-hidden="true" />
      {previewing ? (
        <div className={styles.blobWaveBadge} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : null}
    </div>
  )
}

/**
 * 朗读音色选择页（官方液态流动样式）：
 * 中央展示可左右滑动切换的液态流动圆角矩形色块 + 音色名称与性格描述 + 指示点，底部通栏蓝色「确认」按钮。
 */
export const TtsVoicesPage = () => {
  const t = useTranslate()
  const savedVoice = useSettings((state) => state.ttsVoice)
  const messageId = useReadAloud((state) => state.messageId)
  const previewVoice = useReadAloud((state) => state.previewVoice)

  const initialIndex = Math.max(
    0,
    TTS_VOICES.findIndex((item) => item.id === savedVoice)
  )
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const pointerRef = useRef<{
    id: number
    startX: number
    startY: number
    locked: 'x' | 'y' | null
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    return () => {
      if (useReadAloud.getState().messageId === '__preview__') {
        stopReadAloud()
      }
    }
  }, [])

  const activePreset = TTS_VOICES[activeIndex] ?? TTS_VOICES[0]

  const selectIndex = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(TTS_VOICES.length - 1, nextIndex))
    if (clamped !== activeIndex && useReadAloud.getState().messageId === '__preview__') {
      stopReadAloud()
    }
    setActiveIndex(clamped)
  }

  const togglePreview = (voice: TtsVoice) => {
    if (messageId === '__preview__' && previewVoice === voice) {
      stopReadAloud()
    } else {
      previewTtsVoice(voice)
    }
  }

  const confirmSelection = () => {
    if (useReadAloud.getState().messageId === '__preview__') {
      stopReadAloud()
    }
    setTtsVoice(activePreset.id)
    setTtsVoiceUri(null)
    showToast({ key: 'saved' })
    backSettingsPage()
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button > 0) {
      return
    }
    pointerRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      locked: null,
      moved: false,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerRef.current
    if (!drag || drag.id !== event.pointerId) {
      return
    }
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY

    if (drag.locked === null) {
      if (Math.hypot(dx, dy) < 8) {
        return
      }
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.locked = 'y'
        return
      }
      drag.locked = 'x'
      drag.moved = true
      setDragging(true)
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 忽略不支持指针捕获的合成事件
      }
    }

    if (drag.locked === 'x') {
      const atStart = activeIndex === 0 && dx > 0
      const atEnd = activeIndex === TTS_VOICES.length - 1 && dx < 0
      setDragOffset(atStart || atEnd ? dx * 0.3 : dx)
    }
  }

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerRef.current
    if (!drag || drag.id !== event.pointerId) {
      return
    }
    const wasSwipe = drag.locked === 'x' && drag.moved
    const dx = event.clientX - drag.startX
    pointerRef.current = null
    setDragging(false)
    setDragOffset(0)

    if (wasSwipe) {
      suppressClickRef.current = true
      requestAnimationFrame(() => {
        suppressClickRef.current = false
      })
      if (dx <= -SWIPE_THRESHOLD_PX && activeIndex < TTS_VOICES.length - 1) {
        selectIndex(activeIndex + 1)
      } else if (dx >= SWIPE_THRESHOLD_PX && activeIndex > 0) {
        selectIndex(activeIndex - 1)
      }
    }
  }

  return (
    <div className={styles.sheet}>
      <div className={styles.sheetHeader}>
        <span className={styles.sheetTitle}>{t('settingsTtsVoice')}</span>
        <button
          type="button"
          className={styles.closeButton}
          aria-label={t('close')}
          onClick={backSettingsPage}
        >
          <IconCloseOutline16 />
        </button>
      </div>

      <div
        className={styles.stage}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div className={styles.viewport}>
          <div
            className={clsx(styles.track, !dragging && styles.trackAnimated)}
            style={{
              transform: `translate3d(calc(${-activeIndex * 100}% + ${dragOffset}px), 0, 0)`,
            }}
          >
            {TTS_VOICES.map((preset, index) => {
              const isCurrent = index === activeIndex
              const isPreview = messageId === '__preview__' && previewVoice === preset.id
              return (
                <div key={preset.id} className={styles.slide}>
                  <button
                    type="button"
                    className={styles.blobButton}
                    aria-label={`${t(preset.nameKey)} · ${t(preset.descKey)}`}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false
                        return
                      }
                      if (!isCurrent) {
                        selectIndex(index)
                        return
                      }
                      togglePreview(preset.id)
                    }}
                  >
                    <LiquidVoiceBlob voice={preset.id} active={isCurrent} previewing={isPreview} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className={styles.meta}>
          <div className={styles.voiceName}>{t(activePreset.nameKey)}</div>
          <div className={styles.voiceDesc}>{t(activePreset.descKey)}</div>
        </div>

        <div className={styles.dots} role="tablist" aria-label={t('settingsTtsVoice')}>
          {TTS_VOICES.map((preset, index) => {
            const selected = index === activeIndex
            return (
              <button
                key={preset.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={t(preset.nameKey)}
                className={clsx(styles.dot, selected && styles.dotActive)}
                onClick={() => selectIndex(index)}
              />
            )
          })}
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.confirmButton} onClick={confirmSelection}>
          {t('settingsTtsVoiceConfirm')}
        </button>
      </div>
    </div>
  )
}
