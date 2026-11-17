import type { DeployedApp } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { useQuery } from "@tanstack/solid-query"
import { createMemo, createSignal, For, Match, Show, Switch as Branch } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"

// Apps change outside this page (crashes, the `apps` CLI, the agent), so keep polling.
const REFRESH_MS = 5000

type Status = "all" | DeployedApp["status"]

export default function DeployedAppsPage() {
  const serverSDK = useServerSDK()
  const server = useServer()
  const language = useLanguage()
  const [search, setSearch] = createSignal("")
  const [status, setStatus] = createSignal<Status>("all")
  const [busy, setBusy] = createSignal<string>()
  const [confirming, setConfirming] = createSignal<string>()

  const apps = useQuery(() => ({
    queryKey: ["deployed-apps", server.current?.http.url ?? "none"] as const,
    queryFn: async () => {
      const response = await serverSDK().client.deployedApp.list()
      if (!response.data) throw new Error(errorMessage(response.error) ?? language.t("common.requestFailed"))
      return response.data
    },
    refetchInterval: () => (busy() ? false : REFRESH_MS),
    refetchIntervalInBackground: false,
  }))

  const visible = createMemo(() => {
    const query = search().trim().toLowerCase()
    return (apps.data ?? []).filter(
      (app) =>
        (status() === "all" || app.status === status()) &&
        (!query || app.name.toLowerCase().includes(query) || title(app.name).toLowerCase().includes(query)),
    )
  })

  const statusOptions = createMemo(() =>
    (["all", "running", "stopped"] as const).map((value) => ({
      value,
      label: language.t(`deployedApps.filter.${value}`),
    })),
  )

  const act = async (name: string, run: () => Promise<{ error?: unknown }>) => {
    setBusy(name)
    const response = await run().catch((error: unknown) => ({ error }))
    if (response.error)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: errorMessage(response.error),
      })
    setBusy(undefined)
    await apps.refetch()
  }

  const client = () => serverSDK().client.deployedApp
  const openUrl = (app: DeployedApp) =>
    new URL(app.path, server.current?.http.url ?? window.location.origin).toString()

  return (
    <div data-component="deployed-apps" class="size-full overflow-y-auto bg-background-base">
      <div class="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-8 sm:px-8">
        <header class="flex flex-col gap-1">
          <h1 class="text-20-medium text-text-strong">{language.t("deployedApps.title")}</h1>
          <p class="text-14-regular text-text-weak">{language.t("deployedApps.subtitle")}</p>
        </header>

        <div class="flex flex-wrap items-center gap-3">
          <div class="min-w-[220px] flex-1">
            <TextField
              type="search"
              value={search()}
              onChange={setSearch}
              placeholder={language.t("deployedApps.search")}
              aria-label={language.t("deployedApps.search")}
              spellcheck={false}
              autocomplete="off"
            />
          </div>
          <Select
            options={statusOptions()}
            current={statusOptions().find((option) => option.value === status())}
            value={(option) => option.value}
            label={(option) => option.label}
            onSelect={(option) => option && setStatus(option.value)}
            variant="secondary"
            size="normal"
            aria-label={language.t("deployedApps.filter.label")}
          />
          <span class="whitespace-nowrap text-13-regular text-text-weak">
            {language.t("deployedApps.count", { shown: visible().length, total: apps.data?.length ?? 0 })}
          </span>
        </div>

        <Branch>
          <Match when={apps.isError && !apps.data}>
            <Empty>{apps.error?.message}</Empty>
          </Match>
          <Match when={apps.isPending}>
            <Empty>{language.t("deployedApps.loading")}</Empty>
          </Match>
          <Match when={!visible().length}>
            <Empty>
              {apps.data?.length ? language.t("deployedApps.noMatch") : language.t("deployedApps.empty")}
            </Empty>
          </Match>
          <Match when={visible().length}>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,400px),1fr))] gap-4">
              <For each={visible()}>
                {(app) => {
                  const running = () => app.status === "running"
                  const locked = () => busy() === app.name
                  return (
                    <article
                      data-slot="deployed-app"
                      class="flex flex-col gap-3.5 rounded-xl border border-border-weak-base bg-surface-raised-base p-5"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <h2 class="break-words text-16-medium text-text-strong">{title(app.name)}</h2>
                          <div class="break-all text-13-regular text-text-weak">{app.path}</div>
                        </div>
                        <span class="flex shrink-0 items-center gap-1.5 text-13-regular text-text-weak">
                          <span
                            class="size-2 rounded-full"
                            classList={{
                              "bg-icon-success-base": running(),
                              "bg-icon-weak-base": !running(),
                            }}
                          />
                          <span classList={{ "text-text-strong": running() }}>
                            {language.t(running() ? "deployedApps.status.running" : "deployedApps.status.stopped")}
                          </span>
                        </span>
                      </div>

                      <dl class="flex flex-wrap gap-x-5 gap-y-1 text-13-regular">
                        <Meta label={language.t("deployedApps.framework")}>
                          {app.framework ?? language.t("deployedApps.unknown")}
                        </Meta>
                        <Meta label={language.t("deployedApps.port")}>{app.port}</Meta>
                        <Meta label={language.t("deployedApps.deployed")}>
                          {relative(app.deployedAt, language.locale()) ?? language.t("deployedApps.unknown")}
                        </Meta>
                      </dl>

                      <Switch
                        checked={app.autoRestart}
                        disabled={locked() || !app.startable}
                        onChange={(autoRestart) =>
                          act(app.name, () => client().update({ name: app.name, autoRestart }))
                        }
                      >
                        {language.t("deployedApps.autoRestart")}
                      </Switch>

                      <div class="flex flex-wrap items-center gap-2">
                        <Show
                          when={running()}
                          fallback={
                            <Button variant="secondary" size="small" disabled>
                              {language.t("deployedApps.open")} ↗
                            </Button>
                          }
                        >
                          <a href={openUrl(app)} target="_blank" rel="noopener">
                            <Button variant="secondary" size="small" tabIndex={-1}>
                              {language.t("deployedApps.open")} ↗
                            </Button>
                          </a>
                        </Show>
                        <Button
                          variant="secondary"
                          size="small"
                          disabled={locked() || (!running() && !app.startable)}
                          title={app.startable ? undefined : language.t("deployedApps.notStartable")}
                          onClick={() =>
                            act(app.name, () =>
                              running() ? client().stop({ name: app.name }) : client().start({ name: app.name }),
                            )
                          }
                        >
                          {running() ? `■ ${language.t("deployedApps.stop")}` : `▶ ${language.t("deployedApps.start")}`}
                        </Button>
                        <Show
                          when={confirming() === app.name}
                          fallback={
                            <Button
                              variant="secondary"
                              size="small"
                              // The variant sets the text color, so the critical color must be inline.
                              style={{ color: "var(--text-on-critical-base)" }}
                              disabled={locked()}
                              onClick={() => setConfirming(app.name)}
                            >
                              {language.t("deployedApps.remove")}
                            </Button>
                          }
                        >
                          <Button
                            variant="primary"
                            size="small"
                            disabled={locked()}
                            onClick={() => {
                              setConfirming(undefined)
                              act(app.name, () => client().remove({ name: app.name }))
                            }}
                          >
                            {language.t("deployedApps.remove.confirm")}
                          </Button>
                          <Button variant="ghost" size="small" onClick={() => setConfirming(undefined)}>
                            {language.t("common.cancel")}
                          </Button>
                          <span class="text-13-regular text-text-weak">{language.t("deployedApps.remove.note")}</span>
                        </Show>
                      </div>
                    </article>
                  )
                }}
              </For>
            </div>
          </Match>
        </Branch>
      </div>
    </div>
  )
}

function Empty(props: { children: unknown }) {
  return (
    <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-10 text-center text-14-regular text-text-weak">
      {props.children as string}
    </div>
  )
}

function Meta(props: { label: string; children: unknown }) {
  return (
    <div class="flex gap-1">
      <dt class="text-text-weak">{props.label}:</dt>
      <dd class="text-text-base">{props.children as string}</dd>
    </div>
  )
}

// "prism-chat" -> "Prism Chat"
function title(name: string) {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ")
}

function relative(ms: number | undefined, locale: string) {
  if (!ms) return undefined
  const seconds = Math.max(0, (Date.now() - ms) / 1000)
  const step = (
    [
      [60, "second", 1],
      [3600, "minute", 60],
      [86400, "hour", 3600],
      [2592000, "day", 86400],
      [31536000, "month", 2592000],
      [Infinity, "year", 31536000],
    ] as const
  ).find(([limit]) => seconds < limit)!
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.floor(seconds / step[2]), step[1])
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message
  if (error instanceof Error) return error.message
  return undefined
}
