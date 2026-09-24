import './lib/nestify-host'
import { useEffect, useRef, useState, type UIEvent } from 'react'
import ReactDOM from 'react-dom/client'
import { Check, File, Folder, Loader2, Search } from 'lucide-react'
import { MagicParameterInput } from '@/components/rules/MagicParameterInput'
import { ALL_LIBRARIES_ID, callNestify, getNestifyApi, type SearchHit } from '@/lib/ipc'
import { kindLabel } from '@/lib/labels'
import { formatTime } from '@/lib/utils'
import './index.css'

// 固定窗口高度：无论输入多少内容、结果多少条，Spotlight 尺寸保持不变。
const SPOTLIGHT_HEIGHT = 520
// 无限滚动分页：每页条数，滚动接近底部时自动加载下一页。
const PAGE_SIZE = 50
const LOAD_MORE_THRESHOLD = 96
const SPOTLIGHT_SORT = { field: 'mtime' as const, direction: 'desc' as const }

type Counts = { total: number; fileCount: number; directoryCount: number }

const EMPTY_COUNTS: Counts = { total: 0, fileCount: 0, directoryCount: 0 }

function reportSpotlightEvent(
  event: string,
  payload: unknown,
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  const details = payload instanceof Error
    ? { name: payload.name, message: payload.message, stack: payload.stack }
    : payload
  void getNestifyApi()?.logEvent?.(event, details, level).catch(() => undefined)
}

function SpotlightApp() {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [statsReady, setStatsReady] = useState(false)
  const [status, setStatus] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [resultCounts, setResultCounts] = useState<Counts>(EMPTY_COUNTS)
  const [overallCounts, setOverallCounts] = useState<Counts>(EMPTY_COUNTS)
  const [kindCounts, setKindCounts] = useState<Record<string, number>>({})
  const [activeKind, setActiveKind] = useState('all')
  const [activeIndex, setActiveIndex] = useState(0)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)
  const serverRequestSeqRef = useRef(0)
  const searchClientId = useRef('')
  const debounceRef = useRef(300)

  useEffect(() => {
    void getNestifyApi()?.settingsGet?.().then((settings) => {
      const value = Number(settings.searchDebounceMs)
      debounceRef.current = Number.isFinite(value) ? Math.min(2000, Math.max(0, value)) : 300
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    reportSpotlightEvent('spotlight.loaded')
    const onFocus = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // 只在挂载时固定一次窗口高度，输入过程中不再触发任何 resize。
  useEffect(() => {
    void getNestifyApi()?.resizeSpotlight?.({ height: SPOTLIGHT_HEIGHT })
  }, [])

  const close = () => void getNestifyApi()?.closeSpotlight?.()
  const openHit = (hit: SearchHit) => {
    void callNestify((api) => api.shellOpen({ path: hit.path })).finally(close)
  }

  const countsFor = (values: SearchHit[]): Counts => ({
    total: values.length,
    fileCount: values.filter((hit) => hit.kind !== 'dir').length,
    directoryCount: values.filter((hit) => hit.kind === 'dir').length,
  })

  const fetchExactStats = (text: string, requestId: number, requestSeq: number, visibleCount: number) => {
    void callNestify((api) => api.searchQuery({
      libraryId: ALL_LIBRARIES_ID,
      text,
      searchClientId: ensureSearchClientId(searchClientId),
      requestSeq,
      limit: 1,
      resultMode: 'hits-and-exact-stats',
      sort: SPOTLIGHT_SORT,
    })).then(({ result }) => {
      if (requestRef.current !== requestId) return
      setResultCounts({
        total: result.total,
        fileCount: result.fileCount,
        directoryCount: result.directoryCount,
      })
      setOverallCounts({
        total: result.total,
        fileCount: result.fileCount,
        directoryCount: result.directoryCount,
      })
      setKindCounts(result.kindCounts)
      setStatsReady(true)
      setStatus(result.total > 0
        ? `已显示 ${visibleCount} / ${result.total} 项`
        : '没有找到匹配文件')
    }).catch((error: unknown) => {
      if (requestRef.current !== requestId) return
      console.warn('[Nestify Spotlight] exact stats failed', error)
      reportSpotlightEvent('spotlight.stats.failed', error, 'warn')
    })
  }

  const submit = (rawQuery = query) => {
    const text = rawQuery.trim()
    requestRef.current += 1
    const requestId = requestRef.current
    const requestSeq = ++serverRequestSeqRef.current
    setActiveIndex(0)
    setHasMore(false)
    if (!text) {
      void getNestifyApi()?.searchCancel?.({
        searchClientId: ensureSearchClientId(searchClientId),
        requestSeq,
      }).catch(() => undefined)
      setBusy(false)
      setHits([])
      setResultCounts(EMPTY_COUNTS)
      setOverallCounts(EMPTY_COUNTS)
      setKindCounts({})
      setActiveKind('all')
      setStatsReady(false)
      setStatus('')
      return
    }
    setBusy(true)
    setLoadingMore(false)
    setActiveKind('all')
    setStatus('正在搜索…')
    setStatsReady(false)
    void callNestify((api) => api.searchQuery({
      libraryId: ALL_LIBRARIES_ID,
      text,
      searchClientId: ensureSearchClientId(searchClientId),
      requestSeq,
      limit: PAGE_SIZE,
      sort: SPOTLIGHT_SORT,
      resultMode: 'hits-only',
    })).then(({ result }) => {
      if (requestRef.current !== requestId) return
      setHits(result.hits)
      const loadedCounts = countsFor(result.hits)
      setResultCounts(loadedCounts)
      setOverallCounts(loadedCounts)
      setKindCounts({})
      setHasMore(result.hasMore && result.hits.length > 0)
      fetchExactStats(text, requestId, requestSeq, result.hits.length)
      void getNestifyApi()?.logEvent?.('spotlight.search.result', {
        text,
        total: result.total,
        hits: result.hits.length,
      })
      setStatus(result.hits.length > 0
        ? result.hasMore ? `已显示最近修改的 ${result.hits.length} 项` : `已显示全部 ${result.hits.length} 项`
        : '没有找到匹配文件')
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (requestRef.current !== requestId || /query cancelled|query worker exited|sidecar connection failed/i.test(message)) return
      console.error('[Nestify Spotlight] search failed', error)
      void getNestifyApi()?.logEvent?.('spotlight.search.failed', { text, message })
      setHits([])
      setResultCounts(EMPTY_COUNTS)
      setOverallCounts(EMPTY_COUNTS)
      setKindCounts({})
      setHasMore(false)
      setStatus('搜索失败，请稍后重试')
    }).finally(() => {
      if (requestRef.current === requestId) setBusy(false)
    })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => submit(query), query.trim() ? debounceRef.current : 0)
    return () => {
      window.clearTimeout(timer)
      requestRef.current += 1
    }
  }, [query])

  useEffect(() => () => {
    serverRequestSeqRef.current += 1
    void getNestifyApi()?.searchCancel?.({
      searchClientId: ensureSearchClientId(searchClientId),
      requestSeq: serverRequestSeqRef.current,
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    const onBlur = () => close()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // 切换类型只重新拉取当前类型的命中列表，类型 tabs 的计数保持来自全量查询。
  const selectKind = (kind: string) => {
    if (kind === activeKind && hits.length > 0) return
    const text = query.trim()
    if (!text) return
    setActiveKind(kind)
    setActiveIndex(0)
    setHasMore(false)
    const requestId = ++requestRef.current
    setBusy(true)
    setLoadingMore(false)
    setStatus('正在筛选…')
    void callNestify((api) => api.searchQuery({
      libraryId: ALL_LIBRARIES_ID,
      text,
      searchClientId: ensureSearchClientId(searchClientId),
      requestSeq: serverRequestSeqRef.current,
      ...(kind !== 'all' ? { kinds: [kind] } : {}),
      limit: PAGE_SIZE,
      sort: SPOTLIGHT_SORT,
      resultMode: 'hits-only',
    })).then(({ result }) => {
      if (requestRef.current !== requestId) return
      setHits(result.hits)
      setResultCounts(countsFor(result.hits))
      // Keep the exact overall counts and type tabs from the stats pass.
      setHasMore(result.hasMore && result.hits.length > 0)
      setStatus(result.hits.length > 0
        ? result.hasMore ? `已显示最近修改的 ${result.hits.length} 项` : `已显示全部 ${result.hits.length} 项`
        : `没有找到${kindLabel(kind)}结果`)
    }).catch((error: unknown) => {
      if (requestRef.current !== requestId) return
      console.error('[Nestify Spotlight] kind filter failed', error)
      reportSpotlightEvent('spotlight.kind-filter.failed', error, 'error')
      setHits([])
      setResultCounts(EMPTY_COUNTS)
      setHasMore(false)
      setStatus('筛选失败，请稍后重试')
    }).finally(() => {
      if (requestRef.current === requestId) setBusy(false)
    })
  }

  const loadMore = () => {
    if (busy || loadingMore || !hasMore) return
    const text = query.trim()
    if (!text) return
    const requestId = requestRef.current
    setLoadingMore(true)
    void callNestify((api) => api.searchQuery({
      libraryId: ALL_LIBRARIES_ID,
      text,
      searchClientId: ensureSearchClientId(searchClientId),
      requestSeq: serverRequestSeqRef.current,
      ...(activeKind !== 'all' ? { kinds: [activeKind] } : {}),
      limit: PAGE_SIZE,
      offset: hits.length,
      sort: SPOTLIGHT_SORT,
      resultMode: 'hits-only',
    })).then(({ result }) => {
      if (requestRef.current !== requestId) return
      const seen = new Set(hits.map((hit) => hit.entryId))
      const merged = [...hits]
      for (const hit of result.hits) {
        if (!seen.has(hit.entryId)) merged.push(hit)
      }
      setHits(merged)
      // 结果全为重复或本页为空时终止分页，避免重复触发加载。
      setHasMore(result.hasMore && result.hits.length > 0 && merged.length > hits.length)
      setStatus(!statsReady && hasMore
        ? `已显示最近修改的 ${merged.length} 项`
        : merged.length >= resultCounts.total
          ? `已显示全部 ${merged.length} 项`
          : `已显示 ${merged.length} / ${resultCounts.total} 项`)
    }).catch((error: unknown) => {
      if (requestRef.current !== requestId) return
      console.error('[Nestify Spotlight] load more failed', error)
      reportSpotlightEvent('spotlight.load-more.failed', error, 'error')
      setHasMore(false)
    }).finally(() => {
      if (requestRef.current === requestId) setLoadingMore(false)
    })
  }

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    markScrolling(element)
    if (!hasMore || loadingMore || busy) return
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_MORE_THRESHOLD) {
      loadMore()
    }
  }

  // macOS 风格：滚动时显示滚动条，停止后自动淡出。
  const markScrolling = (element: HTMLElement) => {
    element.classList.add('scrolling')
    const previous = Number(element.dataset.fadeTimer ?? 0)
    window.clearTimeout(previous)
    element.dataset.fadeTimer = String(window.setTimeout(() => {
      element.classList.remove('scrolling')
      delete element.dataset.fadeTimer
    }, 800))
  }

  // 键盘导航时保证选中项可见。
  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // 类型切换后把选中的 chip 滚动到可视区域。
  useEffect(() => {
    const element = activeKind === 'all'
      ? chipsRef.current?.querySelector<HTMLElement>('button')
      : chipsRef.current?.querySelector<HTMLElement>(`[data-kind="${activeKind}"]`)
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKind])

  const hasQuery = query.trim().length > 0
  const typeGroups = Object.entries(kindCounts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => kindLabel(left).localeCompare(kindLabel(right), 'zh-CN'))

  const statusLine = busy
    ? (activeKind === 'all' ? '正在搜索…' : '正在筛选…')
    : hasQuery && !status
      ? '没有找到匹配文件'
      : status

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-transparent p-2 text-foreground">
      {/* 顶部搜索栏：高度固定，输入多少内容都不变化；加载指示不放在这里。 */}
      <div className="flex h-16 min-h-16 shrink-0 items-center gap-3 rounded-lg border bg-background/95 px-3 shadow-md backdrop-blur-xl">
        <MagicParameterInput
          inputRef={inputRef}
          value={query}
          placeholder="搜索文件"
          context="search"
          inputClassName="h-11 w-full rounded-md border bg-background px-3 pl-10 pr-10 text-base shadow-none placeholder:text-muted-foreground focus-visible:ring-1"
          leadingIcon={<Search className="h-5 w-5" />}
          onChange={setQuery}
          onOpenChange={setAssistantOpen}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); close(); return }
            // 左右键在类型 tab 之间循环切换（全部 → 各类型），上下键选择具体行。
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              const kinds = ['all', ...typeGroups.map(([kind]) => kind)]
              const currentIndex = kinds.indexOf(activeKind)
              if (typeGroups.length > 0 && currentIndex >= 0) {
                event.preventDefault()
                const delta = event.key === 'ArrowRight' ? 1 : -1
                const nextKind = kinds[(currentIndex + delta + kinds.length) % kinds.length]
                if (nextKind !== activeKind) selectKind(nextKind)
                return
              }
            }
            if (event.key === 'ArrowDown' && hits.length > 0) {
              event.preventDefault()
              setActiveIndex((current) => (current + 1) % hits.length)
              return
            }
            if (event.key === 'ArrowUp' && hits.length > 0) {
              event.preventDefault()
              setActiveIndex((current) => (current - 1 + hits.length) % hits.length)
              return
            }
            if (event.key === 'Home' && hits.length > 0) {
              event.preventDefault()
              setActiveIndex(0)
              return
            }
            if (event.key === 'End' && hits.length > 0) {
              event.preventDefault()
              setActiveIndex(hits.length - 1)
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              if (hits[activeIndex]) openHit(hits[activeIndex])
              else submit(query)
            }
          }}
        />
      </div>
      {/* 结果面板：窗口高度固定，面板常驻；加载状态显示在面板内部。 */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background/95 p-2 shadow-md backdrop-blur-xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/80 px-3 pb-2 pt-1 text-xs text-slate-500">
          {(busy || loadingMore) && !assistantOpen ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{statusLine}</span>
          {hasQuery && !busy && resultCounts.total > 0 ? (
            <span className="shrink-0">文件 {resultCounts.fileCount} · 文件夹 {resultCounts.directoryCount}</span>
          ) : null}
        </div>
        {/* 类型条常驻：statsReady 只在新查询时重置，切换类型触发的重查期间保持显示不闪烁。 */}
        {hasQuery && statsReady && overallCounts.total > 0 ? (
          <div
            ref={chipsRef}
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200/80 px-2 py-2"
            onScroll={(event) => markScrolling(event.currentTarget)}
            onWheel={(event) => {
              // 鼠标滚轮默认只能竖向滚，这里把竖向滚动映射为类型条横向滑动。
              const element = event.currentTarget
              if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
              if (element.scrollWidth <= element.clientWidth) return
              event.preventDefault()
              element.scrollLeft += event.deltaY
            }}
          >
            <button
              type="button"
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${activeKind === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
              onClick={() => {
                selectKind('all')
              }}
            >
              全部 {overallCounts.total}
            </button>
            {typeGroups.map(([kind, count]) => (
              <button
                key={kind}
                type="button"
                data-kind={kind}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${activeKind === kind ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                onClick={() => {
                  selectKind(kind)
                }}
              >
                {kindLabel(kind)} {count}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-1" onScroll={handleListScroll}>
          {hits.length > 0 ? (
            <div className="grid gap-1 pb-2 pt-1">
              {hits.map((hit, index) => {
                const isDirectory = hit.kind === 'dir'
                return (
                  <button
                    key={hit.entryId}
                    data-index={index}
                    type="button"
                    className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => openHit(hit)}
                  >
                    {isDirectory ? <Folder className="h-4 w-4 shrink-0 text-amber-500" /> : <File className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" title={hit.name}>{hit.name}</span>
                      <span className="block truncate text-xs text-muted-foreground" title={hit.path}>{hit.path}</span>
                    </span>
                    <span
                      className="hidden shrink-0 text-xs text-muted-foreground sm:block"
                      title={`最近修改：${formatTime(hit.mtime)}`}
                    >
                      {formatTime(hit.mtime)}
                    </span>
                    {index === activeIndex ? <Check className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
                  </button>
                )
              })}
              {loadingMore ? (
                <div className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在加载更多…
                </div>
              ) : hasMore ? (
                <button
                  type="button"
                  className="flex items-center justify-center rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-accent/60"
                  onClick={loadMore}
                >
                  加载更多
                </button>
              ) : (
                <div className="px-3 pb-1 pt-1 text-center text-xs text-muted-foreground">
                  已显示全部 {hits.length} 项
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              {busy ? (
                <span>正在搜索…</span>
              ) : status.startsWith('搜索失败') || status.startsWith('筛选失败') ? (
                <span>{status}</span>
              ) : hasQuery ? (
                <span>{activeKind === 'all' ? '没有找到匹配文件' : `没有找到${kindLabel(activeKind)}结果`}</span>
              ) : (
                <>
                  <Search className="h-6 w-6 opacity-40" />
                  <span>输入关键词搜索全部资料库</span>
                  <span className="text-xs">↑ ↓ 选择文件 · ← → 切换类型 · Enter 打开 · Esc 关闭</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function ensureSearchClientId(ref: { current: string }): string {
  ref.current ||= globalThis.crypto?.randomUUID?.() ?? `spotlight-${Math.random().toString(36).slice(2)}`
  return ref.current
}

reportSpotlightEvent('spotlight.start')
ReactDOM.createRoot(document.getElementById('root')!).render(<SpotlightApp />)
