import { useEffect, useRef, type RefObject } from 'react'
import { useSearchPanel } from '../search/searchPanelState.js'
import { useSettingsDialog } from '../settings/settingsDialogState.js'
import { closeMobileSider, openMobileSider, useMobileSider } from './mobileSiderState.js'

const LOCK_THRESHOLD_PX = 8
const VELOCITY_THRESHOLD = 0.3
const SPRING_CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const SPRING_MS = 320

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const isBlockedTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false
  }
  if (target.closest('input[type="range"], [role="dialog"], [role="menu"], [role="listbox"]')) {
    return true
  }
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (
      (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth + 2
    ) {
      return true
    }
  }
  return false
}

/**
 * 60fps 跟手推拉抽屉：
 * - 从聊天页任意位置向右滑动即可跟手推开抽屉，主页面同步右移、微缩圆角并叠加毛玻璃柔光遮罩；
 * - 向左滑动或点击遮罩层收起；松手后按速度与位移阈值弹性吸附。
 * - 拖拽期间直接操作 DOM transform / opacity，不触发 React 重渲染。
 */
export const useDrawerGesture = (
  enabled: boolean,
  frameRef: RefObject<HTMLDivElement | null>,
  fullWidth = false
) => {
  const drawerRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const veilRef = useRef<HTMLDivElement>(null)
  const open = useMobileSider((state) => state.open)
  const draggingRef = useRef(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const applyVisuals = (progress: number, animate: boolean) => {
    const drawer = drawerRef.current
    const main = mainRef.current
    const veil = veilRef.current
    if (!drawer || !main || !veil) {
      return
    }
    clearTimeout(settleTimerRef.current)
    const p = clamp(progress, 0, 1)
    const width = drawer.offsetWidth || 300

    drawer.style.visibility = p > 0 || animate ? 'visible' : 'hidden'
    drawer.style.transition = animate ? `transform ${SPRING_MS}ms ${SPRING_CURVE}` : 'none'
    drawer.style.transform = `translate3d(${(p - 1) * width}px, 0, 0)`
    drawer.style.pointerEvents = p > 0.05 ? 'auto' : 'none'

    const scale = 1 - p * 0.04
    main.style.transition = animate
      ? `transform ${SPRING_MS}ms ${SPRING_CURVE}, border-radius ${SPRING_MS}ms ${SPRING_CURVE}`
      : 'none'
    main.style.transform =
      p > 0.002 ? `translate3d(${p * width}px, 0, 0) scale(${scale})` : 'translate3d(0, 0, 0) scale(1)'
    main.style.borderRadius = p > 0.005 ? '18px' : '0px'
    main.style.overflow = p > 0.005 ? 'hidden' : ''

    veil.style.visibility = p > 0.005 || animate ? 'visible' : 'hidden'
    veil.style.transition = animate ? `opacity ${SPRING_MS}ms ${SPRING_CURVE}` : 'none'
    veil.style.opacity = String(p)
    veil.style.pointerEvents = p > 0.9 ? 'auto' : 'none'

    if (animate && p === 0) {
      settleTimerRef.current = setTimeout(() => {
        if (!draggingRef.current && !useMobileSider.getState().open) {
          drawer.style.visibility = 'hidden'
          veil.style.visibility = 'hidden'
          main.style.transform = ''
          main.style.borderRadius = ''
          main.style.overflow = ''
        }
      }, SPRING_MS + 20)
    }
  }

  useEffect(() => {
    if (!enabled) {
      const drawer = drawerRef.current
      const main = mainRef.current
      const veil = veilRef.current
      if (drawer) {
        drawer.style.cssText = ''
      }
      if (main) {
        main.style.cssText = ''
      }
      if (veil) {
        veil.style.cssText = ''
      }
      return
    }
    if (!draggingRef.current) {
      applyVisuals(open ? 1 : 0, true)
    }
  }, [enabled, open, fullWidth])

  useEffect(() => {
    const frame = frameRef.current
    if (!enabled || !frame) {
      return
    }

    let startX = 0
    let startY = 0
    let lastX = 0
    let lastTime = 0
    let velocityX = 0
    let startOpen = false
    let locked: 'x' | 'y' | null = null
    let progress = 0
    let raf = 0
    let active = false

    const cancelRaf = () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        active = false
        return
      }
      if (
        useSettingsDialog.getState().open ||
        useSearchPanel.getState().entry ||
        document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')
      ) {
        active = false
        return
      }
      const isOpen = useMobileSider.getState().open
      if (!isOpen && isBlockedTarget(event.target)) {
        active = false
        return
      }
      const touch = event.touches[0]
      active = true
      startOpen = isOpen
      startX = touch.clientX
      startY = touch.clientY
      lastX = touch.clientX
      lastTime = performance.now()
      velocityX = 0
      locked = null
      progress = isOpen ? 1 : 0
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!active || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (locked === null) {
        if (Math.hypot(dx, dy) < LOCK_THRESHOLD_PX) {
          return
        }
        if (Math.abs(dy) >= Math.abs(dx) * 1.15) {
          locked = 'y'
          active = false
          return
        }
        if ((!startOpen && dx <= 0) || (startOpen && dx >= 0)) {
          locked = 'y'
          active = false
          return
        }
        locked = 'x'
        draggingRef.current = true
      }

      if (locked === 'x') {
        if (event.cancelable) {
          event.preventDefault()
        }
        const now = performance.now()
        const dt = Math.max(1, now - lastTime)
        velocityX = (touch.clientX - lastX) / dt
        lastX = touch.clientX
        lastTime = now

        const width = drawerRef.current?.offsetWidth || 300
        progress = startOpen ? clamp(1 + dx / width, 0, 1) : clamp(dx / width, 0, 1)
        cancelRaf()
        raf = requestAnimationFrame(() => {
          raf = 0
          applyVisuals(progress, false)
        })
      }
    }

    const finishDrag = () => {
      if (!active || locked !== 'x') {
        active = false
        locked = null
        draggingRef.current = false
        return
      }
      cancelRaf()
      active = false
      locked = null
      draggingRef.current = false

      const shouldOpen =
        velocityX > VELOCITY_THRESHOLD
          ? true
          : velocityX < -VELOCITY_THRESHOLD
            ? false
            : progress >= 0.42
      applyVisuals(shouldOpen ? 1 : 0, true)
      if (shouldOpen !== useMobileSider.getState().open) {
        if (shouldOpen) {
          openMobileSider()
        } else {
          closeMobileSider()
        }
      }
    }

    frame.addEventListener('touchstart', onTouchStart, { passive: true })
    frame.addEventListener('touchmove', onTouchMove, { passive: false })
    frame.addEventListener('touchend', finishDrag, { passive: true })
    frame.addEventListener('touchcancel', finishDrag, { passive: true })
    return () => {
      cancelRaf()
      clearTimeout(settleTimerRef.current)
      frame.removeEventListener('touchstart', onTouchStart)
      frame.removeEventListener('touchmove', onTouchMove)
      frame.removeEventListener('touchend', finishDrag)
      frame.removeEventListener('touchcancel', finishDrag)
    }
  }, [enabled, frameRef])

  return { drawerRef, mainRef, veilRef }
}
