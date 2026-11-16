import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  newChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { cancelEditingMessage, useEditMessage } from '../components/chatInput/editMessageState.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { backSettingsPage } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { closeTopModal } from '../components/base/Modal.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { leaveMobileSearch, useChatSearch } from '../components/sider/chatSearchState.js'
import {
  closeMobileSider,
  exitMultiSelect,
  useMobileSider,
} from '../components/sider/mobileSiderState.js'
import { Sider } from '../components/sider/Sider.js'
import { useDrawerGesture } from '../components/sider/useDrawerGesture.js'
import {
  bindExternalLinkInterceptor,
  hideNativeSplash,
  registerAndroidBackHandler,
} from '../native/capacitor.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以推拉抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const mobileSearchExpanded = useChatSearch(
    (state) => state.searchOpen || state.query.trim().length > 0
  )
  const frameRef = useMobileViewport(isMobile)
  const { drawerRef, mainRef, veilRef } = useDrawerGesture(
    isMobile,
    frameRef,
    mobileSearchExpanded
  )
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const prevActiveIdRef = useRef<string | null>(activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  useEffect(closeSearchPanel, [activeId])
  useEffect(() => {
    const prev = prevActiveIdRef.current
    prevActiveIdRef.current = activeId
    // 从欢迎页发起首轮提问时，新会话已处于 streaming；此时不能打断它刚启动的自动朗读。
    if (
      prev !== activeId &&
      !(prev === null && activeId !== null && Object.hasOwn(useChatStore.getState().streaming, activeId))
    ) {
      stopReadAloud()
    }
  }, [activeId])
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat().finally(hideNativeSplash)
  }, [])

  useEffect(() => bindExternalLinkInterceptor(), [])

  useEffect(
    () =>
      registerAndroidBackHandler(() => {
        if (document.querySelector('[role="listbox"], [role="menu"]')) {
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
          )
          return true
        }
        if (closeTopModal()) {
          return true
        }
        if (backSettingsPage()) {
          return true
        }
        if (useSearchPanel.getState().entry) {
          closeSearchPanel()
          return true
        }
        if (useMobileSider.getState().multiSelect) {
          exitMultiSelect()
          return true
        }
        if (useMobileSider.getState().open) {
          const searchState = useChatSearch.getState()
          if (searchState.searchOpen || searchState.query.trim().length > 0) {
            leaveMobileSearch()
            return true
          }
          closeMobileSider()
          return true
        }
        if (useEditMessage.getState().editing) {
          cancelEditingMessage()
          return true
        }
        if (useChatStore.getState().activeId !== null) {
          newChat()
          return true
        }
        return false
      }),
    []
  )

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? (
          <div
            ref={drawerRef}
            className={clsx(styles.mobileDrawer, mobileSearchExpanded && styles.mobileDrawerSearch)}
          >
            <Sider mobile />
          </div>
        ) : siderCollapsed ? null : (
          <Sider />
        )}
        <main ref={mainRef} className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
          {isMobile ? (
            <div
              ref={veilRef}
              className={styles.drawerVeil}
              aria-hidden
              onClick={closeMobileSider}
            />
          ) : null}
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <Toast />
    </>
  )
}
