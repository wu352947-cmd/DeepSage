/**
 * 语音朗读前的文本清洗：移除代码块、公式块、引用标记与 Markdown 语法，
 * 并支持在流式输出时按完整句边界切分可朗读片段（未闭合代码块暂不推进）。
 */

const FENCE_LINE = /(?:^|\n)[ \t]*(```+|~~~+)/g

/** 找到最后一个未闭合的代码块起点，未闭合时返回其索引，否则返回 -1。 */
export const findUnclosedCodeFence = (markdown: string): number => {
  let openToken: string | null = null
  let openIndex = -1
  FENCE_LINE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FENCE_LINE.exec(markdown)) !== null) {
    const token = match[1]
    const fenceChar = token[0]
    if (openToken === null) {
      openToken = token
      openIndex = match.index + (markdown[match.index] === '\n' ? 1 : 0)
    } else if (openToken[0] === fenceChar && token.length >= openToken.length) {
      openToken = null
      openIndex = -1
    }
  }
  return openIndex
}

/** 剥除代码块、行内代码标记、公式与 Markdown 格式符号，保留自然口语正文。 */
export const stripMarkdownForSpeech = (markdown: string): string => {
  if (!markdown) {
    return ''
  }
  let text = markdown
  // 移除完整与未闭合的围栏代码块
  text = text.replace(/```[\s\S]*?(?:```|$)/g, ' ')
  text = text.replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
  // 移除引用标记 [citation:N]
  text = text.replace(/\[citation:\d+\]/g, '')
  // 移除块级公式，避免朗读 LaTeX 符号
  text = text.replace(/\$\$[\s\S]*?\$\$/g, ' ')
  text = text.replace(/\\\[[\s\S]*?\\\]/g, ' ')
  // 行内公式剥除定界符，保留可读内容或短表达式
  text = text.replace(/\\\(([^)]*)\\\)/g, '$1')
  text = text.replace(/\$([^$\n]+)\$/g, '$1')
  // 图片仅保留替代文本，链接保留锚文本
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // 移除 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ')
  // 移除表格分隔行与竖线
  text = text.replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, ' ')
  text = text.replace(/\|/g, ' ')
  // 移除标题、引用、列表前缀与分割线
  text = text.replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-*_]{3,}[ \t]*$)/gm, '')
  text = text.replace(/^[ \t]*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, '')
  // 去掉行内代码反引号与强调、删除线符号
  text = text.replace(/`([^`]*)`/g, '$1')
  text = text.replace(/(\*\*|__|~~|\*|_)/g, '')
  return text.replace(/\s+/g, ' ').trim()
}

const SENTENCE_END = /(?:[。！？；\n]+|[.!?](?=\s|$))/g

/**
 * 从 `fullMarkdown` 的 `offset` 位置提取下一段可朗读文本。
 * 流式阶段按句末标点切分；结束时（flushAll=true）把剩余文本一并切出。
 */
export const extractSpeakableSlice = (
  fullMarkdown: string,
  offset: number,
  flushAll: boolean
): { text: string; nextOffset: number } | null => {
  const unclosedFence = findUnclosedCodeFence(fullMarkdown)
  const safeEnd = unclosedFence >= 0 ? unclosedFence : fullMarkdown.length
  if (safeEnd <= offset) {
    return null
  }
  const slice = fullMarkdown.slice(offset, safeEnd)
  if (flushAll && unclosedFence < 0) {
    const cleaned = stripMarkdownForSpeech(slice)
    return { text: cleaned, nextOffset: safeEnd }
  }
  SENTENCE_END.lastIndex = 0
  let cutEnd = -1
  let match: RegExpExecArray | null
  while ((match = SENTENCE_END.exec(slice)) !== null) {
    const candidateEnd = match.index + match[0].length
    if (stripMarkdownForSpeech(slice.slice(0, candidateEnd)).length >= 4) {
      cutEnd = candidateEnd
    }
  }
  if (cutEnd < 0) {
    return null
  }
  return {
    text: stripMarkdownForSpeech(slice.slice(0, cutEnd)),
    nextOffset: offset + cutEnd,
  }
}
