import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置页面栈中的页面标识 */
export type SettingsPage =
  | 'root'
  | 'account'
  | 'data'
  | 'fontSize'
  | 'personalization'
  | 'location'
  | 'voiceLanguage'
  | 'ttsVoices'
  | 'terms'
  | 'help'

export type SettingsSection = SettingsPage

type SettingsDialogState = {
  open: boolean
  stack: SettingsPage[]
}

export const useSettingsDialog = create<SettingsDialogState>(() => ({
  open: false,
  stack: ['root'],
}))

export const openSettings = (page: SettingsPage = 'root') =>
  useSettingsDialog.setState({
    open: true,
    stack: page === 'root' ? ['root'] : ['root', page],
  })

export const pushSettingsPage = (page: SettingsPage) =>
  useSettingsDialog.setState((state) => ({
    open: true,
    stack: state.stack.at(-1) === page ? state.stack : [...state.stack, page],
  }))

export const backSettingsPage = (): boolean => {
  const state = useSettingsDialog.getState()
  if (!state.open) {
    return false
  }
  if (state.stack.length > 1) {
    useSettingsDialog.setState({ stack: state.stack.slice(0, -1) })
    return true
  }
  useSettingsDialog.setState({ open: false, stack: ['root'] })
  return true
}

export const closeSettings = () => useSettingsDialog.setState({ open: false, stack: ['root'] })

/** 没有 API Key 时打开「设置 -> 账号管理」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  openSettings('account')
  return false
}
