import { createSignal } from "solid-js"

// The Deployed Apps list lives in the session side panel as a built-in tab, like Review.
export const APPS_TAB = "apps"

// The sidebar's Deployed Apps button lives outside the session page and may first have
// to navigate to a project. It records a request here; the session side panel opens the
// Apps tab once it is mounted for that session and clears the request.
const [requested, setRequested] = createSignal(false)

export const appsTabRequested = requested

export function requestAppsTab() {
  setRequested(true)
}

export function clearAppsTabRequest() {
  setRequested(false)
}
