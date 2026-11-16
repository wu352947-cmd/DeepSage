import { create } from 'zustand'
import { translate } from '../../i18n/index.js'
import * as db from '../../services/chat/db.js'
import type { SessionSearchHit } from '../../services/chat/db.js'
import { useChatStore } from '../../services/chat/store.js'
import { useMobileSider } from './mobileSiderState.js'

type ChatSearchState = {
  query: string
  searching: boolean
  error: boolean
  hits: SessionSearchHit[]
  searchedQuery: string
  searchOpen: boolean
  listScrollTop: number
}

/**
 * 对话搜索状态提升到全局 store：
 * 切换会话、收起/重新打开移动抽屉、组件重挂载均保留搜索词、搜索模式、滚动位置与结果列表，
 * 直到用户主动清空或点击返回离开搜索。
 */
export const useChatSearch = create<ChatSearchState>(() => ({
  query: '',
  searching: false,
  error: false,
  hits: [],
  searchedQuery: '',
  searchOpen: false,
  listScrollTop: 0,
}))

let searchSeq = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined

const runSearch = async (trimmed: string, seq: number) => {
  if (seq !== searchSeq) {
    return
  }
  try {
    const hits = await db.searchSessionsContent(
      trimmed,
      useChatStore.getState().sessionCache,
      () => seq !== searchSeq,
      translate('untitledChat')
    )
    if (seq !== searchSeq) {
      return
    }
    useChatSearch.setState({
      searching: false,
      error: false,
      hits,
      searchedQuery: trimmed,
    })
  } catch (error) {
    db.reportStorageError('search sessions')(error)
    if (seq !== searchSeq) {
      return
    }
    useChatSearch.setState({
      searching: false,
      error: true,
    })
  }
}

const scheduleSearch = (rawQuery: string, immediate = false) => {
  clearTimeout(debounceTimer)
  const trimmed = rawQuery.trim()
  const seq = ++searchSeq
  if (!trimmed) {
    useChatSearch.setState({
      query: rawQuery,
      searching: false,
      error: false,
      hits: [],
      searchedQuery: '',
      listScrollTop: 0,
    })
    return
  }
  useChatSearch.setState({
    query: rawQuery,
    searching: true,
    error: false,
    searchOpen: true,
    listScrollTop: 0,
  })
  if (immediate) {
    void runSearch(trimmed, seq)
  } else {
    debounceTimer = setTimeout(() => {
      void runSearch(trimmed, seq)
    }, 100)
  }
}

export const enterMobileSearch = () => {
  useChatSearch.setState({ searchOpen: true })
}

export const leaveMobileSearch = () => {
  clearTimeout(debounceTimer)
  searchSeq += 1
  useChatSearch.setState({
    query: '',
    searching: false,
    error: false,
    hits: [],
    searchedQuery: '',
    searchOpen: false,
    listScrollTop: 0,
  })
}

export const setSearchListScrollTop = (listScrollTop: number) => {
  useChatSearch.setState({ listScrollTop })
}

export const setChatSearchQuery = (query: string) => {
  scheduleSearch(query, false)
}

export const clearChatSearch = () => {
  scheduleSearch('', true)
}

export const retryChatSearch = () => {
  const { query } = useChatSearch.getState()
  scheduleSearch(query, true)
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined

// 会话列表变更、初始化完成或流式输出结束时，若当前停留在搜索结果页，静默刷新结果但不闪现空态
useChatStore.subscribe((state, previous) => {
  const { query, searchedQuery } = useChatSearch.getState()
  const trimmed = query.trim()
  if (!trimmed) {
    return
  }
  const streamEnded =
    Object.keys(state.streaming).length < Object.keys(previous.streaming).length
  if (
    state.sessions !== previous.sessions ||
    (state.ready && !previous.ready) ||
    streamEnded
  ) {
    clearTimeout(refreshTimer)
    if (searchedQuery !== trimmed) {
      scheduleSearch(query, true)
    } else {
      refreshTimer = setTimeout(() => {
        const latest = useChatSearch.getState().query.trim()
        if (!latest) {
          return
        }
        const seq = ++searchSeq
        void runSearch(latest, seq)
      }, 200)
    }
  }
})

// 仅在搜索词为空且抽屉收起时退出搜索展开态；有搜索词时保留搜索结果页供下次打开继续浏览。
useMobileSider.subscribe((state, previous) => {
  if (!state.open && previous.open && !useChatSearch.getState().query.trim()) {
    useChatSearch.setState({ searchOpen: false, listScrollTop: 0 })
  }
})
