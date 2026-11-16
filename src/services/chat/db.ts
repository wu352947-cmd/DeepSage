import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { buildMessageVersions, type MessageVersions } from './branches.js'
import { toSessionSummary, type Message, type Session, type SessionSummary } from './types.js'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 11

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

interface ChatDB extends DBSchema {
  /** 当前使用的会话，界面读写都在这里 */
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件 */
  files: { key: string; value: StoredFile }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后在一个事务中替换正式数据并清空暂存，失败时只清空暂存。
   */
  sessionsStaging: { key: string; value: Session }
  filesStaging: { key: string; value: StoredFile }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

const storedSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user' ? message.files.map((file) => file.id) : []
      )
    ),
  ],
})

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of ['sessions', 'files', 'sessionsStaging', 'filesStaging'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

export const loadSessionSummaries = async (): Promise<SessionSummary[]> =>
  (await (await getDB()).getAll('sessionSummaries')).map(toSessionSummary)

export const loadSession = async (id: string): Promise<Session | undefined> =>
  (await getDB()).get('sessions', id)

export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  const summary = storedSummary(session)
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(session)
        await tx.objectStore('sessionSummaries').put(summary)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。 */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          session.title = title
          await sessions.put(session)
          await tx.objectStore('sessionSummaries').put(storedSummary(session))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也可置顶/取消置顶，只更新目标记录，原子同步详情和列表。 */
export const setSessionsPinned = async (ids: string[], pinned: boolean): Promise<void> => {
  if (ids.length === 0) {
    return
  }
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const summaries = tx.objectStore('sessionSummaries')
        for (const id of ids) {
          const session = await sessions.get(id)
          if (session) {
            session.pinned = pinned
            await sessions.put(session)
            await summaries.put(storedSummary(session))
          } else {
            const summary = await summaries.get(id)
            if (summary) {
              summary.pinned = pinned
              await summaries.put(summary)
            }
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

export type HighlightRange = {
  start: number
  end: number
}

export type SessionSearchHit = {
  hitKey: string
  sessionId: string
  sessionTitle: string
  sessionUpdatedAt: number
  messageId: string | null
  messageTimestamp: number
  matchSource: 'body' | 'title'
  matchKind?: 'user' | 'assistant' | 'thinking'
  snippet: string | null
  snippetHighlights: HighlightRange[]
  titleHighlights: HighlightRange[]
  matchScore: number
  versionIndex?: number
  versionTotal?: number
}

type SearchSegment = {
  kind: 'user' | 'assistant' | 'thinking'
  text: string
}

const HAN_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/
const PUNCT_OR_SPACE_RE =
  /[\s。！？!?，,、；;：:“”"‘’'（）()【】[\]《》<>·—…~～\-_/\\|]/
const TIGHT_CJK_MAX_GAP = 2

const readStringField = (value: unknown): string => (typeof value === 'string' ? value : '')

const extractFromPartsArray = (parts: unknown[]): SearchSegment[] => {
  const segments: SearchSegment[] = []
  let textRun = ''
  let thinkingRun = ''
  const flushText = () => {
    if (textRun) {
      segments.push({ kind: 'assistant', text: textRun })
      textRun = ''
    }
  }
  const flushThinking = () => {
    if (thinkingRun) {
      segments.push({ kind: 'thinking', text: thinkingRun })
      thinkingRun = ''
    }
  }
  for (const part of parts) {
    if (typeof part === 'string') {
      flushThinking()
      textRun += part
      continue
    }
    if (!part || typeof part !== 'object') {
      continue
    }
    const record = part as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    if (type === 'thinking' || type === 'THINK') {
      flushText()
      thinkingRun +=
        readStringField(record.thinking) ||
        readStringField(record.content) ||
        readStringField(record.text)
    } else if (type === 'REQUEST') {
      flushText()
      flushThinking()
      const req = readStringField(record.content) || readStringField(record.text)
      if (req) {
        segments.push({ kind: 'user', text: req })
      }
    } else if (
      type === 'text' ||
      type === 'RESPONSE' ||
      type === 'TEMPLATE_RESPONSE' ||
      type === 'TEXT' ||
      !type
    ) {
      flushThinking()
      textRun += readStringField(record.text) || readStringField(record.content)
    } else {
      flushText()
      flushThinking()
    }
  }
  flushText()
  flushThinking()
  return segments
}

const extractMessageSearchSegments = (message: Message): SearchSegment[] => {
  const raw = message as unknown as Record<string, unknown>
  const role = typeof raw.role === 'string' ? raw.role.toLowerCase() : ''

  if (role === 'user') {
    const segments: SearchSegment[] = []
    if (typeof raw.content === 'string' && raw.content) {
      segments.push({ kind: 'user', text: raw.content })
    } else if (Array.isArray(raw.content)) {
      const joined = raw.content
        .map((part) => {
          if (typeof part === 'string') {
            return part
          }
          if (part && typeof part === 'object') {
            const p = part as Record<string, unknown>
            return readStringField(p.text) || readStringField(p.content)
          }
          return ''
        })
        .join('')
      if (joined) {
        segments.push({ kind: 'user', text: joined })
      }
    }
    if (typeof raw.text === 'string' && raw.text && raw.text !== raw.content) {
      segments.push({ kind: 'user', text: raw.text })
    }
    if (Array.isArray(raw.fragments)) {
      for (const seg of extractFromPartsArray(raw.fragments)) {
        segments.push({ kind: 'user', text: seg.text })
      }
    }
    return segments
  }

  const segments: SearchSegment[] = []
  if (Array.isArray(raw.blocks)) {
    segments.push(...extractFromPartsArray(raw.blocks))
  }
  if (typeof raw.thinking === 'string' && raw.thinking) {
    segments.push({ kind: 'thinking', text: raw.thinking })
  }
  if (Array.isArray(raw.fragments)) {
    segments.push(...extractFromPartsArray(raw.fragments))
  }
  if (typeof raw.content === 'string' && raw.content) {
    segments.push({ kind: 'assistant', text: raw.content })
  } else if (Array.isArray(raw.content)) {
    segments.push(...extractFromPartsArray(raw.content))
  }
  if (typeof raw.text === 'string' && raw.text && raw.text !== raw.content) {
    segments.push({ kind: 'assistant', text: raw.text })
  }
  return segments
}

type CodePointIndex = {
  chars: string[]
  starts: number[]
  ends: number[]
}

const toCodePointIndex = (text: string): CodePointIndex => {
  const chars: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let i = 0
  while (i < text.length) {
    const cp = text.codePointAt(i) ?? 0
    const len = cp > 0xffff ? 2 : 1
    chars.push(text.slice(i, i + len))
    starts.push(i)
    ends.push(i + len)
    i += len
  }
  return { chars, starts, ends }
}

const findTightCjkMatches = (
  lowerText: string,
  tokenLower: string,
  firstOnly: boolean
): HighlightRange[] => {
  const qChars = Array.from(tokenLower)
  if (qChars.length < 2 || !HAN_RE.test(tokenLower)) {
    return []
  }
  for (const ch of qChars) {
    if (!lowerText.includes(ch)) {
      return []
    }
  }
  const indexed = toCodePointIndex(lowerText)
  const { chars, starts, ends } = indexed
  const maxTotalExtra = Math.max(2, qChars.length)
  const results: HighlightRange[] = []
  let i = 0

  while (i < chars.length) {
    if (chars[i] !== qChars[0]) {
      i += 1
      continue
    }
    let qi = 1
    let pos = i
    let extra = 0
    let ok = true
    while (qi < qChars.length) {
      const target = qChars[qi]
      let found = -1
      const limit = Math.min(chars.length - 1, pos + 1 + TIGHT_CJK_MAX_GAP)
      for (let scan = pos + 1; scan <= limit; scan += 1) {
        if (chars[scan] === target) {
          found = scan
          break
        }
        if (PUNCT_OR_SPACE_RE.test(chars[scan])) {
          break
        }
      }
      if (found === -1) {
        ok = false
        break
      }
      extra += found - pos - 1
      if (extra > maxTotalExtra) {
        ok = false
        break
      }
      pos = found
      qi += 1
    }
    if (ok) {
      results.push({ start: starts[i], end: ends[pos] })
      if (firstOnly) {
        return results
      }
      i = pos + 1
    } else {
      i += 1
    }
  }
  return results
}

type TextMatch = {
  start: number
  end: number
  score: number
}

const findSingleTokenMatch = (lowerText: string, tokenLower: string): TextMatch | null => {
  const exactIdx = lowerText.indexOf(tokenLower)
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + tokenLower.length, score: 100 }
  }
  const tight = findTightCjkMatches(lowerText, tokenLower, true)
  if (tight.length > 0) {
    return { start: tight[0].start, end: tight[0].end, score: 70 }
  }
  return null
}

const splitCjkChunks = (tokenLower: string): string[] => {
  const chars = Array.from(tokenLower)
  if (chars.length < 4 || !HAN_RE.test(tokenLower)) {
    return []
  }
  const chunks: string[] = []
  for (let i = 0; i + 1 < chars.length; i += 2) {
    chunks.push(chars[i] + chars[i + 1])
  }
  if (chars.length % 2 === 1) {
    chunks.push(chars[chars.length - 2] + chars[chars.length - 1])
  }
  return chunks
}

const findQueryMatch = (text: string, rawQuery: string): TextMatch | null => {
  const needle = rawQuery.trim().toLowerCase()
  if (!needle || !text) {
    return null
  }
  const lowerText = text.toLowerCase()
  const exactIdx = lowerText.indexOf(needle)
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + needle.length, score: 100 }
  }

  const tokens = needle.split(/\s+/).filter(Boolean)
  if (tokens.length > 1) {
    const tokenMatches: TextMatch[] = []
    for (const token of tokens) {
      const m = findSingleTokenMatch(lowerText, token)
      if (!m) {
        return null
      }
      tokenMatches.push(m)
    }
    tokenMatches.sort((a, b) => a.start - b.start)
    return {
      start: tokenMatches[0].start,
      end: tokenMatches[0].end,
      score: 85,
    }
  }

  const tight = findTightCjkMatches(lowerText, needle, true)
  if (tight.length > 0) {
    return { start: tight[0].start, end: tight[0].end, score: 70 }
  }

  const chunks = splitCjkChunks(needle)
  if (chunks.length >= 2) {
    const chunkMatches: TextMatch[] = []
    for (const chunk of chunks) {
      const m = findSingleTokenMatch(lowerText, chunk)
      if (!m) {
        return null
      }
      chunkMatches.push(m)
    }
    chunkMatches.sort((a, b) => a.start - b.start)
    const spanStart = chunkMatches[0].start
    const spanEnd = chunkMatches[chunkMatches.length - 1].end
    if (spanEnd - spanStart <= 48 && !/[。！？!?\n\r]/.test(text.slice(spanStart, spanEnd))) {
      return { start: spanStart, end: spanEnd, score: 55 }
    }
  }

  return null
}

const mergeHighlightRanges = (ranges: HighlightRange[]): HighlightRange[] => {
  if (ranges.length <= 1) {
    return ranges
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: HighlightRange[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = merged[merged.length - 1]
    const curr = sorted[i]
    if (curr.start <= prev.end) {
      prev.end = Math.max(prev.end, curr.end)
    } else {
      merged.push({ ...curr })
    }
  }
  return merged
}

const findExactOccurrences = (lowerText: string, needleLower: string): HighlightRange[] => {
  if (!needleLower) {
    return []
  }
  const ranges: HighlightRange[] = []
  let cursor = 0
  for (;;) {
    const idx = lowerText.indexOf(needleLower, cursor)
    if (idx === -1) {
      break
    }
    ranges.push({ start: idx, end: idx + needleLower.length })
    cursor = idx + needleLower.length
  }
  return ranges
}

export const findHighlightRanges = (text: string, rawQuery: string): HighlightRange[] => {
  const needle = rawQuery.trim().toLowerCase()
  if (!needle || !text) {
    return []
  }
  const lowerText = text.toLowerCase()
  const tokens = needle.split(/\s+/).filter(Boolean)
  const terms = tokens.length > 1 ? tokens : [needle]
  const collected: HighlightRange[] = []

  for (const term of terms) {
    const exact = findExactOccurrences(lowerText, term)
    if (exact.length > 0) {
      collected.push(...exact)
    }
    const tight = findTightCjkMatches(lowerText, term, false)
    if (tight.length > 0) {
      collected.push(...tight)
    }
  }

  if (collected.length === 0 && tokens.length === 1) {
    const chunks = splitCjkChunks(needle)
    for (const chunk of chunks) {
      collected.push(...findExactOccurrences(lowerText, chunk))
      collected.push(...findTightCjkMatches(lowerText, chunk, false))
    }
  }

  return mergeHighlightRanges(collected)
}

const buildSearchSnippet = (rawText: string, matchStart: number, matchLen: number): string => {
  const start = Math.max(0, matchStart - 20)
  const end = Math.min(rawText.length, matchStart + matchLen + 48)
  const slice = rawText.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${end < rawText.length ? '…' : ''}`
}

const kindPriority: Record<SearchSegment['kind'], number> = {
  assistant: 3,
  user: 2,
  thinking: 1,
}

export const matchSessionContent = (
  session: Session,
  rawQuery: string,
  untitledTitle = ''
): SessionSearchHit[] => {
  const query = rawQuery.trim()
  if (!query) {
    return []
  }
  const displayTitle = session.title || untitledTitle
  const titleHighlights = findHighlightRanges(displayTitle, query)
  const versions = buildMessageVersions(session, new Map<string, MessageVersions>())
  const hits: SessionSearchHit[] = []

  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i]
    const segments = extractMessageSearchSegments(message)
    let best: { segment: SearchSegment; match: TextMatch } | null = null

    for (const segment of segments) {
      const match = findQueryMatch(segment.text, query)
      if (!match) {
        continue
      }
      if (
        !best ||
        match.score > best.match.score ||
        (match.score === best.match.score &&
          kindPriority[segment.kind] > kindPriority[best.segment.kind])
      ) {
        best = { segment, match }
      }
    }

    if (!best) {
      continue
    }

    const snippet = buildSearchSnippet(
      best.segment.text,
      best.match.start,
      best.match.end - best.match.start
    )
    const versionInfo = versions.get(message.id)
    const hasVersions = versionInfo && versionInfo.ids.length > 1
    hits.push({
      hitKey: `${session.id}:${message.id}`,
      sessionId: session.id,
      sessionTitle: displayTitle,
      sessionUpdatedAt: session.updatedAt,
      messageId: message.id,
      messageTimestamp: message.createdAt || session.updatedAt,
      matchSource: 'body',
      matchKind: best.segment.kind,
      snippet,
      snippetHighlights: findHighlightRanges(snippet, query),
      titleHighlights,
      matchScore: best.match.score,
      ...(hasVersions
        ? { versionIndex: versionInfo.index + 1, versionTotal: versionInfo.ids.length }
        : {}),
    })
  }

  if (hits.length === 0) {
    const titleMatch = findQueryMatch(displayTitle, query)
    if (titleMatch) {
      hits.push({
        hitKey: `${session.id}:title`,
        sessionId: session.id,
        sessionTitle: displayTitle,
        sessionUpdatedAt: session.updatedAt,
        messageId: null,
        messageTimestamp: session.updatedAt,
        matchSource: 'title',
        snippet: null,
        snippetHighlights: [],
        titleHighlights,
        matchScore: titleMatch.score,
      })
    }
  }

  return hits
}

/**
 * 搜索全部会话标题与消息正文：返回所有命中的消息级结果，先检查内存缓存，再游标流式扫描持久化会话，
 * 不把大量会话详情同时装入内存。
 */
export const searchSessionsContent = async (
  query: string,
  cachedSessions: Record<string, Session>,
  isCancelled: () => boolean = () => false,
  untitledTitle = ''
): Promise<SessionSearchHit[]> => {
  const trimmed = query.trim()
  const hits: SessionSearchHit[] = []
  if (!trimmed) {
    return hits
  }
  const checked = new Set<string>()
  for (const [id, session] of Object.entries(cachedSessions)) {
    checked.add(id)
    hits.push(...matchSessionContent(session, trimmed, untitledTitle))
  }
  if (isCancelled()) {
    return hits
  }
  const db = await getDB()
  const tx = db.transaction('sessions', 'readonly')
  for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
    if (isCancelled()) {
      break
    }
    const session = cursor.value
    if (!checked.has(session.id)) {
      hits.push(...matchSessionContent(session, trimmed, untitledTitle))
    }
  }
  hits.sort((a, b) => {
    const aExact = a.matchScore >= 85 ? 1 : 0
    const bExact = b.matchScore >= 85 ? 1 : 0
    if (aExact !== bExact) {
      return bExact - aExact
    }
    const aBody = a.matchSource === 'body' ? 1 : 0
    const bBody = b.matchSource === 'body' ? 1 : 0
    if (aBody !== bBody) {
      return bBody - aBody
    }
    if (a.messageTimestamp !== b.messageTimestamp) {
      return b.messageTimestamp - a.messageTimestamp
    }
    return b.sessionUpdatedAt - a.sessionUpdatedAt
  })
  return hits
}

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(sessionId)
        await tx.objectStore('sessions').delete(sessionId)
        await summaries.delete(sessionId)
        for (const id of summary?.fileIds ?? []) {
          if ((await summaries.index('fileIds').count(id)) === 0) {
            await tx.objectStore('files').delete(id)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const saveFiles = (files: StoredFile[]): Promise<void> => putFiles('files', files)

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('files', id))?.blob

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

export const addStagingSession = async (session: Session): Promise<void> => {
  await (await getDB()).add('sessionsStaging', session)
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。 */
export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>): Promise<void> => {
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([
    (async () => {
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        const session = cursor.value
        let changed = false
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const file of message.files) {
            const type = types.get(file.id) ?? ''
            if (file.mimeType !== type) {
              file.mimeType = type
              changed = true
            }
          }
        }
        if (changed) {
          await cursor.update(session)
        }
      }
    })(),
    tx.done,
  ])
}

/**
 * 导入完成后用暂存替换正式数据：同一事务中替换会话、摘要和原件，并清空暂存。
 * 逐条游标复制，同一时间只读取一条记录；事务失败时整体回滚，正式数据不变。
 */
export const commitStaging = async (): Promise<SessionSummary[]> => {
  const summaries: SessionSummary[] = []
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging'],
    'readwrite'
  )
  const move = async (from: 'sessionsStaging' | 'filesStaging', to: 'sessions' | 'files') => {
    try {
      const target = tx.objectStore(to)
      await target.clear()
      if (to === 'sessions') {
        await tx.objectStore('sessionSummaries').clear()
      }
      for (
        let cursor = await tx.objectStore(from).openCursor();
        cursor;
        cursor = await cursor.continue()
      ) {
        await target.put(cursor.value)
        if (to === 'sessions') {
          const summary = storedSummary(cursor.value as Session)
          await tx.objectStore('sessionSummaries').put(summary)
          summaries.push(toSessionSummary(summary))
        }
      }
      await tx.objectStore(from).clear()
    } catch (error) {
      // 同步抛出的错误不会让事务自动回滚，需显式中止，避免只提交清空和部分移入。
      abortTransaction(tx)
      throw error
    }
  }
  await Promise.all([move('sessionsStaging', 'sessions'), move('filesStaging', 'files'), tx.done])
  // 直接返回本次提交的列表，调用方无需在替换成功后再发起可能失败的读取。
  return summaries
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}
