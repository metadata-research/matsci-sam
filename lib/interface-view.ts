export type InterfaceView = "simple" | "advanced"

/** A presentation preference only. It never changes what a request submits. */
export const INTERFACE_VIEW_COOKIE = "matsci-sam-view"

export const parseInterfaceView = (value: string | undefined): InterfaceView =>
  value === "advanced" ? "advanced" : "simple"
