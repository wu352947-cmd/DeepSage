import { create } from 'zustand'

export type EditingMessageTarget = {
  sessionId: string
  messageId: string
  text: string
  fileCount: number
}

type EditMessageState = {
  editing: EditingMessageTarget | null
}

/**
 * 底部输入栏的「修改输入」状态：
 * 点击用户消息编辑按钮时进入，复用底部固定输入栏修改并重新发送，取消后恢复原有未发送草稿。
 */
export const useEditMessage = create<EditMessageState>(() => ({
  editing: null,
}))

export const startEditingMessage = (
  sessionId: string,
  messageId: string,
  content: string,
  fileCount: number
) => {
  useEditMessage.setState({
    editing: {
      sessionId,
      messageId,
      text: content,
      fileCount,
    },
  })
}

export const setEditingMessageText = (text: string) => {
  useEditMessage.setState((state) =>
    state.editing ? { editing: { ...state.editing, text } } : state
  )
}

export const cancelEditingMessage = () => {
  if (useEditMessage.getState().editing !== null) {
    useEditMessage.setState({ editing: null })
  }
}
