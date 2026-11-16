import { useEffect, useState, type RefObject } from 'react'

/**
 * 监听元素是否进入视口附近（默认上下预留 600px 缓冲）；
 * 一旦进入过视口就锁定为 true，避免滚动时反复销毁重绘重组件（如 Mermaid）。
 */
export const useNearViewport = (
  ref: RefObject<Element | null>,
  eager = false,
  rootMargin = '600px 0px'
): boolean => {
  const [visible, setVisible] = useState(
    () => eager || typeof IntersectionObserver === 'undefined'
  )

  useEffect(() => {
    if (eager || visible) {
      return
    }
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, eager, visible, rootMargin])

  return visible
}
