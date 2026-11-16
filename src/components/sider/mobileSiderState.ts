import { create } from 'zustand'

type MobileSiderState = {
  open: boolean
  multiSelect: boolean
  selectedIds: string[]
}

/** 移动端侧边栏抽屉及多选状态 */
export const useMobileSider = create<MobileSiderState>(() => ({
  open: false,
  multiSelect: false,
  selectedIds: [],
}))

export const openMobileSider = () => useMobileSider.setState({ open: true })

export const closeMobileSider = () =>
  useMobileSider.setState({ open: false, multiSelect: false, selectedIds: [] })

export const enterMultiSelect = (initialId?: string) =>
  useMobileSider.setState({
    open: true,
    multiSelect: true,
    selectedIds: initialId ? [initialId] : [],
  })

export const exitMultiSelect = () =>
  useMobileSider.setState({ multiSelect: false, selectedIds: [] })

export const toggleSelectSession = (id: string) =>
  useMobileSider.setState((state) => {
    const exists = state.selectedIds.includes(id)
    return {
      selectedIds: exists
        ? state.selectedIds.filter((item) => item !== id)
        : [...state.selectedIds, id],
    }
  })
