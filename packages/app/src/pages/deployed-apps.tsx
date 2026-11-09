import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"

// The dashboard is itself a deployed app: the container entrypoint launches it from
// /opt/opencode-dashboard and opencode proxies it at /apps/dashboard/ (see container/README.md).
const DASHBOARD_PATH = "/apps/dashboard/"

export default function DeployedAppsPage() {
  const server = useServer()
  const language = useLanguage()
  const src = () => new URL(DASHBOARD_PATH, server.current?.http.url ?? window.location.origin).toString()

  return (
    <iframe
      src={src()}
      title={language.t("deployedApps.title")}
      data-component="deployed-apps"
      class="size-full border-0 bg-background-base"
    />
  )
}
