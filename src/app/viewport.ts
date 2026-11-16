import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { create } from 'zustand'

/** 窄于 768px 按移动端布局 */
const query = window.matchMedia('not all and (min-width: 768px)')

const subscribe = (onChange: () => void) => {
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const useIsMobile = () => useSyncExternalStore(subscribe, () => query.matches)

const useKeyboardStore = create<{ open: boolean }>(() => ({ open: false }))

/** 移动端软键盘是否处于展开状态 */
export const useKeyboardOpen = () => useKeyboardStore((state) => state.open)

const preventPageScroll = (event: TouchEvent) => {
  if (event.touches.length !== 1) {
    return
  }
  for (
    let element = event.target instanceof Element ? event.target : null;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element)
    const scrollsY =
      /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight
    const scrollsX =
      /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth
    if (scrollsY || scrollsX) {
      return
    }
  }
  event.preventDefault()
}

/** 阻止移动端整页滚动，保留内部可滚动区域的滚动和双指缩放。 */
export const usePreventPageScroll = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    document.addEventListener('touchmove', preventPageScroll, { passive: false })
    return () => document.removeEventListener('touchmove', preventPageScroll)
  }, [enabled])
}

/** 移动端页面跟随视觉视口，键盘弹出后顶栏和输入框仍留在可见区域。 */
export const useMobileViewport = (enabled: boolean) => {
  const frameRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!enabled || !frame) {
      useKeyboardStore.setState({ open: false })
      return
    }
    const viewport = window.visualViewport
    const rootStyle = document.documentElement.style
    const inputSelector = 'textarea, input:not([type="file"])'
    let animationFrame = 0
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let lateSettleTimer: ReturnType<typeof setTimeout> | undefined
    let lastWidth = window.innerWidth
    let maxFullHeight = Math.max(window.innerHeight, viewport?.height ?? 0)
    let nativeKeyboardOpen: boolean | null = null
    let nativeKeyboardHeight = 0
    let nativeHiding = false

    const reset = () => {
      rootStyle.removeProperty('--app-viewport-height')
      rootStyle.removeProperty('--app-viewport-top')
      frame.style.removeProperty('--app-viewport-height')
      frame.style.removeProperty('--app-viewport-top')
    }

    const update = () => {
      // 双指缩放由浏览器处理，保持当前布局尺寸。
      if (viewport && viewport.scale !== 1) {
        return
      }
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0)
      }
      if (Math.abs(window.innerWidth - lastWidth) > 2) {
        lastWidth = window.innerWidth
        maxFullHeight = Math.max(window.innerHeight, viewport?.height ?? 0)
        nativeKeyboardOpen = null
        nativeKeyboardHeight = 0
        nativeHiding = false
      }

      const viewportHeight = viewport?.height ?? window.innerHeight
      const effectiveHeight = Math.min(viewportHeight, window.innerHeight)
      const isInputFocused = Boolean(document.activeElement?.matches(inputSelector))

      // 仅在非键盘展开/收起过渡期更新基准满屏高度，严禁将动画期或已缩减的视口高度写入基准值导致二次扣减
      if (nativeKeyboardOpen !== true && !nativeHiding) {
        if (maxFullHeight - effectiveHeight <= 100) {
          maxFullHeight = effectiveHeight
        } else {
          maxFullHeight = Math.max(maxFullHeight, effectiveHeight)
        }
      }

      const heightReduced = maxFullHeight - effectiveHeight > 100

      if (nativeKeyboardOpen === false && !heightReduced) {
        useKeyboardStore.setState({ open: false })
        reset()
        return
      }

      if (!isInputFocused && nativeKeyboardOpen !== true && !heightReduced) {
        useKeyboardStore.setState({ open: false })
        reset()
        return
      }

      // 部分 Android WebView 上报了 keyboardHeight 但尚未缩减窗口高度时，仅在未缩减且剩余高度合理时兜底避让，避免重复扣减
      const needsNativeFallback =
        nativeKeyboardOpen === true &&
        nativeKeyboardHeight > 0 &&
        maxFullHeight - effectiveHeight < 40 &&
        maxFullHeight - nativeKeyboardHeight >= 280
      const height = needsNativeFallback ? maxFullHeight - nativeKeyboardHeight : effectiveHeight

      const kbOpen =
        nativeKeyboardOpen === true ||
        heightReduced ||
        (isInputFocused && nativeKeyboardOpen !== false && maxFullHeight - effectiveHeight > 40)

      useKeyboardStore.setState({ open: kbOpen })

      if (!kbOpen && !heightReduced) {
        reset()
        return
      }

      const safeTop = Math.max(
        0,
        Math.min(viewport?.offsetTop ?? 0, Math.max(0, window.innerHeight - height))
      )
      rootStyle.setProperty('--app-viewport-height', `${height}px`)
      rootStyle.setProperty('--app-viewport-top', `${safeTop}px`)
    }

    const scheduleFrame = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(update)
    }

    const schedule = () => {
      // 先同步跟上键盘动画，下一帧和动画末再校准一次视口读数。
      update()
      scheduleFrame()
      clearTimeout(settleTimer)
      clearTimeout(lateSettleTimer)
      settleTimer = setTimeout(update, 80)
      lateSettleTimer = setTimeout(update, 260)
    }

    const onFocusIn = () => {
      if (document.activeElement?.matches(inputSelector)) {
        schedule()
      }
    }

    const listenerPromises: Promise<PluginListenerHandle>[] = []
    let disposed = false

    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Keyboard')) {
      const bindNative = (promise: Promise<PluginListenerHandle>) => {
        listenerPromises.push(
          promise.then((handle) => {
            if (disposed) {
              void handle.remove().catch(() => {})
            }
            return handle
          })
        )
      }
      bindNative(
        Keyboard.addListener('keyboardWillShow', (info) => {
          nativeKeyboardOpen = true
          nativeHiding = false
          nativeKeyboardHeight = info.keyboardHeight
          schedule()
        })
      )
      bindNative(
        Keyboard.addListener('keyboardDidShow', (info) => {
          nativeKeyboardOpen = true
          nativeHiding = false
          nativeKeyboardHeight = info.keyboardHeight
          schedule()
        })
      )
      bindNative(
        Keyboard.addListener('keyboardWillHide', () => {
          nativeKeyboardOpen = false
          nativeHiding = true
          nativeKeyboardHeight = 0
          schedule()
        })
      )
      bindNative(
        Keyboard.addListener('keyboardDidHide', () => {
          nativeKeyboardOpen = false
          nativeHiding = false
          nativeKeyboardHeight = 0
          schedule()
        })
      )
    }

    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', onFocusIn)
    // 等点击和焦点切换完成，避免按钮移动、或切换输入框时短暂恢复全高。
    document.addEventListener('focusout', scheduleFrame)
    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      clearTimeout(settleTimer)
      clearTimeout(lateSettleTimer)
      for (const promise of listenerPromises) {
        void promise.then((handle) => handle.remove()).catch(() => {})
      }
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', scheduleFrame)
      useKeyboardStore.setState({ open: false })
      reset()
    }
  }, [enabled])

  return frameRef
}
