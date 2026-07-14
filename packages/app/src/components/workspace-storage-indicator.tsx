import { makeEventListener } from "@solid-primitives/event-listener"
import { useQuery } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection, useServer } from "@/context/server"
import { Portal } from "solid-js/web"
import {
  FALLBACK_REFRESH_INTERVAL_MS,
  formatStorageBytes,
  formatStoragePercent,
  formatStorageUpdatedAt,
  storageStateColor,
  storageStateLegacyColor,
  type StorageState,
} from "./workspace-storage-utils"

type IdleCallbackHandle = number
type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => IdleCallbackHandle
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void
}

function finiteNumber(value: number | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function createWorkspaceStorageData(conn: Accessor<ServerConnection.Any | undefined>) {
  const global = useGlobal()
  const serverKey = createMemo(() => {
    const current = conn()
    return current ? ServerConnection.key(current) : "none"
  })
  const [ready, setReady] = createSignal(false)
  let interval: number | undefined

  const query = useQuery(() => ({
    queryKey: ["workspace-storage", serverKey()] as const,
    enabled: ready() && !!conn(),
    queryFn: async () => {
      const current = conn()
      if (!current) throw new Error("Server unavailable")
      const response = await global.createServerCtx(current).sdk.client.project.managedStorage()
      if (!response.data) throw new Error("Storage unavailable")
      return response.data
    },
    retry: false,
  }))

  const refreshIntervalMs = createMemo(() => finiteNumber(query.data?.refreshIntervalMs) ?? FALLBACK_REFRESH_INTERVAL_MS)
  const stop = () => {
    if (interval === undefined) return
    window.clearInterval(interval)
    interval = undefined
  }
  const start = () => {
    if (typeof document === "undefined") return
    stop()
    if (!ready()) return
    if (!conn()) return
    if (document.visibilityState === "hidden") return
    interval = window.setInterval(() => void query.refetch(), refreshIntervalMs())
  }
  const state = createMemo(() => query.data?.state)
  const refresh = () => {
    if (!ready()) {
      setReady(true)
      return
    }
    void query.refetch()
  }

  createEffect(() => {
    ready()
    serverKey()
    refreshIntervalMs()
    start()
  })

  onMount(() => {
    makeEventListener(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        stop()
        return
      }
      if (!ready()) return
      void query.refetch()
      start()
    })
  })

  onCleanup(stop)

  return {
    query,
    ready,
    refresh,
    state,
    refreshIntervalMs,
  }
}

function scheduleIdle(callback: () => void) {
  if (typeof window === "undefined") return () => {}
  const idleWindow = window as IdleWindow
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 4_000 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }
  const timeout = window.setTimeout(callback, 1_500)
  return () => window.clearTimeout(timeout)
}

function storageStateLabel(state: StorageState | undefined, language: ReturnType<typeof useLanguage>) {
  if (state === "critical") return language.t("workspace.storage.state.critical")
  if (state === "warning") return language.t("workspace.storage.state.warning")
  return language.t("workspace.storage.state.healthy")
}

function StorageMetric(props: { label: string; value: JSX.Element; style?: JSX.CSSProperties }) {
  return (
    <div class="flex min-w-0 items-center justify-between gap-3 text-[12px] leading-5">
      <span class="text-text-weak">{props.label}</span>
      <span class="min-w-0 truncate text-right text-text-base [font-weight:530]" style={props.style}>
        {props.value}
      </span>
    </div>
  )
}

export function WorkspaceDiskUsageBar(props: { server?: ServerConnection.Any; class?: string }) {
  const server = useServer()
  const language = useLanguage()
  const conn = createMemo(() => props.server ?? server.current)
  const storage = createWorkspaceStorageData(conn)
  const data = () => storage.query.data
  const color = createMemo(() => {
    if (!data() || storage.query.isError) return "var(--icon-weak-base)"
    return storageStateLegacyColor(storage.state())
  })
  const usedPercent = createMemo(() => Math.min(100, Math.max(0, finiteNumber(data()?.usedPercent) ?? 0)))
  const used = createMemo(() => formatStorageBytes(data()?.used, language.intl()))
  const total = createMemo(() => formatStorageBytes(data()?.total, language.intl()))
  const [refreshPressed, setRefreshPressed] = createSignal(false)
  let refreshPressedTimeout: number | undefined
  const showRefreshFeedback = () => {
    if (refreshPressedTimeout !== undefined) window.clearTimeout(refreshPressedTimeout)
    setRefreshPressed(true)
    refreshPressedTimeout = window.setTimeout(() => {
      setRefreshPressed(false)
      refreshPressedTimeout = undefined
    }, 600)
  }
  const refresh = () => {
    showRefreshFeedback()
    storage.refresh()
  }

  onMount(() => {
    const start = () => {
      if (storage.ready()) return
      if (document.visibilityState === "hidden") return
      storage.refresh()
    }
    const cancel = scheduleIdle(start)
    makeEventListener(document, "visibilitychange", start)
    onCleanup(cancel)
  })
  onCleanup(() => {
    if (refreshPressedTimeout !== undefined) window.clearTimeout(refreshPressedTimeout)
  })

  return (
    <div
      data-component="workspace-disk-usage"
      class={`mt-auto shrink-0 border-t border-border-weaker-base px-1 pt-.5 pb-.5 ${props.class ?? ""}`}
    >
      <div class="mb-2 flex items-center gap-2 min-w-0">
        <span class="min-w-0 flex-1 truncate text-12-medium text-text-strong">
          {language.t("workspace.storage.diskUsage")}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <span class="text-12-medium" style={{ color: color() }}>
            {data() ? formatStoragePercent(data()?.usedPercent, language.intl()) : "--"}
          </span>
          <IconButton
            type="button"
            size="small"
            variant="ghost"
            icon="refresh"
            class="!size-6 !rounded-full border border-border-weaker-base bg-background-base transition-[background-color,transform] duration-150"
            classList={{
              "!bg-surface-base-active scale-95": refreshPressed(),
              "[&_[data-slot=icon-svg]]:animate-spin": storage.query.isFetching || refreshPressed(),
            }}
            disabled={storage.query.isFetching}
            aria-label={language.t("workspace.storage.refresh")}
            aria-pressed={refreshPressed()}
            onClick={refresh}
          />
        </div>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-surface-raised-base">
        <div
          class="h-full rounded-full transition-[width,background-color] duration-200"
          style={{
            width: data() ? `${usedPercent()}%` : "0%",
            "background-color": color(),
          }}
        />
      </div>
      <div class="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-11-regular text-text-weak">
        <span class="min-w-0 truncate">
          {storage.query.isError
            ? language.t("workspace.storage.unavailable")
            : data()
              ? language.t("workspace.storage.usedOfTotal", { used: used(), total: total() })
              : language.t("common.loading")}
        </span>
      </div>
    </div>
  )
}

function WorkspaceStorageStatusPanel(props: {
  storage: ReturnType<typeof createWorkspaceStorageData>
  color: string
}) {
  const language = useLanguage()
  const data = () => props.storage.query.data
  const available = () => data()?.available ?? data()?.remaining

  return (
    <div
      data-component="workspace-storage-status-panel"
      class="w-[280px] rounded-xl border border-border-weak-base bg-background-strong p-3 shadow-[var(--shadow-lg-border-base)]"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <IconV2 name="storage" class="shrink-0" style={{ color: props.color }} />
          <span class="min-w-0 truncate text-13-medium text-text-strong">
            {language.t("workspace.storage.title")}
          </span>
        </div>
        <Button
          type="button"
          size="small"
          variant="ghost"
          class="h-6 px-2 text-12-regular"
          disabled={props.storage.query.isFetching}
          onClick={props.storage.refresh}
        >
          {language.t("workspace.storage.refresh")}
        </Button>
      </div>
      <Show
        when={data()}
        fallback={
          <div class="mt-3 text-12-regular text-text-weak">
            {props.storage.query.isError ? language.t("workspace.storage.unavailable") : language.t("common.loading")}
          </div>
        }
      >
        <div class="mt-3 flex flex-col gap-1.5">
          <StorageMetric
            label={language.t("workspace.storage.remaining")}
            value={formatStorageBytes(available(), language.intl())}
            style={{ color: props.color }}
          />
          <StorageMetric label={language.t("workspace.storage.total")} value={formatStorageBytes(data()?.total, language.intl())} />
          <StorageMetric label={language.t("workspace.storage.used")} value={formatStoragePercent(data()?.usedPercent, language.intl())} />
          <StorageMetric
            label={language.t("workspace.storage.state")}
            value={storageStateLabel(data()?.state, language)}
            style={{ color: props.color }}
          />
          <StorageMetric
            label={language.t("workspace.storage.updated")}
            value={formatStorageUpdatedAt(data()?.updatedAt, language.intl())}
          />
        </div>
      </Show>
    </div>
  )
}

export function WorkspaceStorageStatus(props: { server?: ServerConnection.Any; variant?: "classic" | "v2" }) {
  const server = useServer()
  const language = useLanguage()
  const conn = createMemo(() => props.server ?? server.current)
  const storage = createWorkspaceStorageData(conn)
  const [shown, setShown] = createSignal(false)
  const [panelStyle, setPanelStyle] = createSignal<JSX.CSSProperties>({})
  const variant = createMemo(() => props.variant ?? "classic")
  let triggerEl: HTMLDivElement | undefined
  let closeTimer: number | undefined
  const updatePanelPosition = () => {
    if (!triggerEl) return
    const rect = triggerEl.getBoundingClientRect()
    const width = 280
    const left = Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8))
    setPanelStyle({
      position: "fixed",
      left: `${left}px`,
      top: `${rect.bottom}px`,
      "z-index": 2147483647,
    })
  }
  const clearCloseTimer = () => {
    if (closeTimer === undefined) return
    window.clearTimeout(closeTimer)
    closeTimer = undefined
  }
  const open = () => {
    clearCloseTimer()
    if (!storage.ready()) storage.refresh()
    updatePanelPosition()
    setShown(true)
  }
  const close = () => {
    clearCloseTimer()
    closeTimer = window.setTimeout(() => setShown(false), 120)
  }
  const closeNow = () => {
    clearCloseTimer()
    setShown(false)
  }
  const color = createMemo(() => {
    if (!storage.query.data || storage.query.isError) {
      if (variant() === "v2") return "var(--v2-icon-icon-muted)"
      return "var(--icon-weak-base)"
    }
    if (variant() === "v2") return storageStateColor(storage.state())
    return storageStateLegacyColor(storage.state())
  })
  const trigger = () => (
    <div class="relative flex size-4 items-center justify-center">
      <IconV2 name="storage" style={{ color: color() }} />
    </div>
  )
  const onFocusOut = (event: FocusEvent & { currentTarget: HTMLDivElement }) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    closeNow()
  }

  createEffect(() => {
    if (!shown()) return
    updatePanelPosition()
  })

  onCleanup(clearCloseTimer)

  return (
    <div
      ref={(el) => {
        triggerEl = el
      }}
      class="relative shrink-0"
      onPointerEnter={open}
      onPointerLeave={close}
      onFocusIn={open}
      onFocusOut={onFocusOut}
    >
      <Show
        when={variant() === "v2"}
        fallback={
          <Button
            type="button"
            variant="ghost"
            class="titlebar-icon w-8 h-6 p-0 box-border shrink-0"
            aria-label={language.t("workspace.storage.title")}
            onClick={() => {
              if (shown()) {
                closeNow()
                return
              }
              open()
            }}
          >
            {trigger()}
          </Button>
        }
      >
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="large"
          class="!w-9 shrink-0"
          state={shown() ? "pressed" : undefined}
          aria-label={language.t("workspace.storage.title")}
          onClick={() => {
            if (shown()) {
              closeNow()
              return
            }
            open()
          }}
          icon={trigger()}
        />
      </Show>
      <Show when={shown()}>
        <Portal>
          <div
            class="pt-1"
            style={panelStyle()}
            onPointerEnter={open}
            onPointerLeave={close}
            onFocusIn={open}
            onFocusOut={(event) => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
              closeNow()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <WorkspaceStorageStatusPanel storage={storage} color={color()} />
          </div>
        </Portal>
      </Show>
    </div>
  )
}

export function WorkspaceStorageIndicator(props: { server?: ServerConnection.Any; class?: string }) {
  const server = useServer()
  const language = useLanguage()
  const conn = createMemo(() => props.server ?? server.current)
  const storage = createWorkspaceStorageData(conn)
  const query = storage.query
  const color = createMemo(() => storageStateColor(storage.state()))

  return (
    <section
      data-component="workspace-storage-indicator"
      class={`rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 ${props.class ?? ""}`}
      aria-label={language.t("workspace.storage.title")}
    >
      <div class="flex min-w-0 items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="size-2 shrink-0 rounded-full"
            style={{ "background-color": query.isError ? "var(--v2-icon-icon-muted)" : color() }}
            aria-hidden="true"
          />
          <span class="min-w-0 truncate text-[12px] leading-4 text-v2-text-text-muted [font-weight:530]">
            {language.t("workspace.storage.title")}
          </span>
        </div>
        <ButtonV2
          type="button"
          size="small"
          variant="ghost-muted"
          class="h-5 px-1.5 text-[11px]"
          disabled={query.isFetching}
          onClick={storage.refresh}
        >
          {language.t("workspace.storage.refresh")}
        </ButtonV2>
      </div>
      <Show
        when={query.data}
        fallback={
          <div class="mt-2 text-[11px] leading-4 text-v2-text-text-faint">
            {query.isError ? language.t("workspace.storage.unavailable") : language.t("common.loading")}
          </div>
        }
      >
        <div class="mt-2 grid grid-cols-2 gap-2">
          <div class="min-w-0">
            <div class="text-[11px] leading-4 text-v2-text-text-faint">{language.t("workspace.storage.remaining")}</div>
            <div class="truncate text-[13px] leading-5 [font-weight:530]" style={{ color: color() }}>
              {formatStorageBytes(query.data?.available, language.intl())}
            </div>
          </div>
          <div class="min-w-0 text-right">
            <div class="text-[11px] leading-4 text-v2-text-text-faint">{language.t("workspace.storage.total")}</div>
            <div class="truncate text-[13px] leading-5 text-v2-text-text-base [font-weight:530]">
              {formatStorageBytes(query.data?.total, language.intl())}
            </div>
          </div>
          <div class="col-span-2 flex min-w-0 items-center justify-between gap-2 text-[11px] leading-4">
            <span class="text-v2-text-text-faint">{language.t("workspace.storage.used")}</span>
            <span class="text-v2-text-text-muted">{formatStoragePercent(query.data?.usedPercent, language.intl())}</span>
          </div>
          <div class="col-span-2 flex min-w-0 items-center justify-between gap-2 text-[11px] leading-4">
            <span class="text-v2-text-text-faint">{language.t("workspace.storage.updated")}</span>
            <span class="text-v2-text-text-muted">{formatStorageUpdatedAt(query.data?.updatedAt, language.intl())}</span>
          </div>
        </div>
      </Show>
    </section>
  )
}
