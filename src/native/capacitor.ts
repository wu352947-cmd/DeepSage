import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'

type DeepSageNativeBridge = {
  saveBase64File?: (base64: string, filename: string, mimeType: string) => string
  openBase64File?: (base64: string, filename: string, mimeType: string) => string
  setSystemBarTheme?: (dark: boolean) => void
}

const getBridge = (): DeepSageNativeBridge | undefined =>
  (window as Window & { DeepSageNative?: DeepSageNativeBridge }).DeepSageNative

export const isNativePlatform = () => Capacitor.isNativePlatform()

export const openExternalUrl = async (url?: string | null) => {
  if (!url) {
    return
  }
  if (!isNativePlatform()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  try {
    await Browser.open({ url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export const syncNativeSystemBars = async (theme: 'light' | 'dark') => {
  if (!isNativePlatform()) {
    return
  }
  const dark = theme === 'dark'
  getBridge()?.setSystemBarTheme?.(dark)
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    await StatusBar.setBackgroundColor({ color: dark ? '#151517' : '#ffffff' })
  } catch {
    // Ignore on platforms/APIs that restrict status bar color changes
  }
}

export const hideNativeSplash = () => {
  if (!isNativePlatform()) {
    return
  }
  void SplashScreen.hide().catch(() => {})
}

export const registerAndroidBackHandler = (onBack: () => boolean | Promise<boolean>) => {
  if (!isNativePlatform()) {
    return () => {}
  }
  const handlePromise = CapApp.addListener('backButton', () => {
    void Promise.resolve(onBack()).then((handled) => {
      if (!handled) {
        void CapApp.exitApp()
      }
    })
  })
  return () => {
    void handlePromise.then((handle) => handle.remove()).catch(() => {})
  }
}

export const bindExternalLinkInterceptor = () => {
  if (!isNativePlatform()) {
    return () => {}
  }
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented) {
      return
    }
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(target instanceof HTMLAnchorElement)) {
      return
    }
    if (target.hasAttribute('download')) {
      return
    }
    const rawHref = target.getAttribute('href')
    if (!rawHref) {
      return
    }
    try {
      const parsed = new URL(target.href)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        // Keep same-origin app routes in-app; open all external web links in browser.
        if (parsed.origin === window.location.origin) {
          return
        }
        event.preventDefault()
        void openExternalUrl(parsed.toString())
      } else if (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') {
        event.preventDefault()
        window.location.href = parsed.toString()
      }
    } catch {
      // Ignore malformed URLs
    }
  }
  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })

/** Saves a Blob to Downloads on native Android via JavascriptInterface; returns result label or null if unavailable. */
export const saveBlobOnNative = async (blob: Blob, filename: string): Promise<string | null> => {
  const bridge = getBridge()
  if (!isNativePlatform() || !bridge?.saveBase64File) {
    return null
  }
  const base64 = await blobToBase64(blob)
  const result = bridge.saveBase64File(base64, filename, blob.type || 'application/octet-stream')
  if (result.startsWith('ERROR:')) {
    throw new Error(result.slice(6))
  }
  return result
}

/** Opens a Blob attachment in native Android viewer/chooser; returns true if handled natively. */
export const openBlobOnNative = async (blob: Blob, filename: string): Promise<boolean> => {
  const bridge = getBridge()
  if (!isNativePlatform() || !bridge?.openBase64File) {
    return false
  }
  const base64 = await blobToBase64(blob)
  const result = bridge.openBase64File(base64, filename, blob.type || 'application/octet-stream')
  if (result.startsWith('ERROR:')) {
    throw new Error(result.slice(6))
  }
  return true
}
