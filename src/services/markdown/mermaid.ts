type Mermaid = typeof import('mermaid').default

let mermaidPromise: Promise<Mermaid> | null = null
let renderQueue = Promise.resolve()
let nextId = 0

const loadMermaid = () => {
  mermaidPromise ??= import('mermaid')
    .then((module) => module.default)
    .catch((error: unknown) => {
      mermaidPromise = null
      throw error
    })
  return mermaidPromise
}

/** 转义图片标签，对同一图中的全部标签生效。 */
const sanitizeMermaid = (code: string) => code.replace(/<((?:img|image)\s+)/gi, '&lt;$1')

const MAX_SVG_CACHE = 120
const svgCache = new Map<string, string>()

/** 串行执行初始化和绘制，避免不同图表互相覆盖 Mermaid 的全局配置；已渲染过的图表直接命中 LRU 缓存。 */
export const renderMermaid = (
  code: string,
  dark: boolean,
  isCancelled: () => boolean
): Promise<string | null> => {
  const trimmed = code.trim()
  if (!trimmed) {
    return Promise.resolve(null)
  }
  const cacheKey = `${dark ? '1' : '0'}:${code}`
  const cached = svgCache.get(cacheKey)
  if (cached !== undefined) {
    svgCache.delete(cacheKey)
    svgCache.set(cacheKey, cached)
    return Promise.resolve(cached)
  }

  const result = renderQueue.then(async () => {
    if (isCancelled() || !code.trim()) {
      return null
    }
    const hit = svgCache.get(cacheKey)
    if (hit !== undefined) {
      return hit
    }

    const mermaid = await loadMermaid()
    if (isCancelled()) {
      return null
    }

    mermaid.initialize({
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
    })

    const { svg } = await mermaid.render(`standalone-mermaid-${nextId++}`, sanitizeMermaid(code))
    if (svg) {
      if (svgCache.size >= MAX_SVG_CACHE) {
        const oldest = svgCache.keys().next().value
        if (oldest !== undefined) {
          svgCache.delete(oldest)
        }
      }
      svgCache.set(cacheKey, svg)
    }
    return isCancelled() ? null : svg
  })

  // 某张图失败不阻塞后续图表；调用方仍收到原始任务的错误。
  renderQueue = result.then(
    () => {},
    () => {}
  )
  return result
}
