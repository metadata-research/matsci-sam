"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode
} from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { INTERFACE_VIEW_COOKIE, type InterfaceView } from "@/lib/interface-view"
import { cn } from "@/lib/utils"

type ViewPreference = {
  view: InterfaceView
  setView: (view: InterfaceView) => void
}

const ViewPreferenceContext = createContext<ViewPreference | null>(null)
// Set only below a page control. Pages without one keep their full detail.
const ViewScopeContext = createContext<InterfaceView | null>(null)

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const VIEWS: readonly InterfaceView[] = ["simple", "advanced"]

/** One remembered Simple or Advanced choice for every page that offers it. */
export function ViewPreferenceProvider({
  initialView,
  children
}: {
  initialView: InterfaceView
  children: ReactNode
}) {
  const [view, setViewState] = useState(initialView)
  const setView = useCallback((next: InterfaceView) => {
    setViewState(next)
    const secure = window.location.protocol === "https:" ? "; Secure" : ""
    document.cookie = `${INTERFACE_VIEW_COOKIE}=${next}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`
  }, [])
  const value = useMemo(() => ({ view, setView }), [view, setView])
  return (
    <ViewPreferenceContext.Provider value={value}>
      {children}
    </ViewPreferenceContext.Provider>
  )
}

/** The remembered choice, for a component that owns a view control. */
export function useViewPreference(): ViewPreference {
  const shared = useContext(ViewPreferenceContext)
  const [view, setView] = useState<InterfaceView>("simple")
  return shared ?? { view, setView }
}

/** The view a component presents. Outside a page control it stays complete. */
export function usePresentedView(): InterfaceView {
  return useContext(ViewScopeContext) ?? "advanced"
}

export function ViewScope({
  view,
  children
}: {
  view: InterfaceView
  children: ReactNode
}) {
  return (
    <ViewScopeContext.Provider value={view}>
      {children}
    </ViewScopeContext.Provider>
  )
}

/**
 * The labelled Simple and Advanced tabs. Render inside a Tabs root. Radix
 * reports no change for the selected tab, so `onSelect` also hears that click.
 */
export function ViewTabList({
  label,
  onSelect
}: {
  label: string
  onSelect?: (view: InterfaceView) => void
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 self-end">
      <span className="text-xs font-medium text-muted-foreground">View</span>
      <TabsList aria-label={label}>
        {VIEWS.map((view) => (
          <TabsTrigger key={view} value={view} onClick={() => onSelect?.(view)}>
            {view === "simple" ? "Simple" : "Advanced"}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  )
}

const VIEW_ONLY_ATTRIBUTE = "data-view-only"

/** The element the address names, when a hidden view-only wrapper holds it. */
const hiddenLinkedTarget = () => {
  try {
    const id = decodeURIComponent(window.location.hash.slice(1))
    const target = id ? document.getElementById(id) : null
    const wrapper = target?.closest<HTMLElement>(`[${VIEW_ONLY_ATTRIBUTE}]`)
    const view = wrapper?.getAttribute(VIEW_ONLY_ATTRIBUTE)
    return target &&
      wrapper?.hidden &&
      (view === "simple" || view === "advanced")
      ? { target, view: view as InterfaceView }
      : null
  } catch {
    return null
  }
}

/** One mounted page body: a change of view never resets drafts or disclosures. */
export function ViewTabs({
  label,
  heading,
  children,
  className,
  contentClassName,
  simpleClassName,
  advancedClassName
}: {
  label: string
  heading: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  simpleClassName?: string
  advancedClassName?: string
}) {
  const { view: preferred, setView } = useViewPreference()
  // A link to detail that only one view shows opens that view for this visit
  // without changing the remembered choice. A tab click ends the override.
  const [override, setOverride] = useState<InterfaceView | null>(null)
  const scrollTo = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const reveal = () => {
      const linked = hiddenLinkedTarget()
      if (!linked) return
      scrollTo.current = linked.target
      setOverride(linked.view)
    }
    // A Next.js Link navigates with pushState, which fires no hashchange, so a
    // click on a link with a fragment is checked again once it has applied.
    let timer = 0
    const revealAfterClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement) || !anchor.hash) return
      window.clearTimeout(timer)
      timer = window.setTimeout(reveal, 250)
    }
    window.addEventListener("hashchange", reveal)
    document.addEventListener("click", revealAfterClick, true)
    const frame = requestAnimationFrame(reveal)
    return () => {
      window.removeEventListener("hashchange", reveal)
      document.removeEventListener("click", revealAfterClick, true)
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [])
  // Scroll once the view that shows the target has rendered.
  useEffect(() => {
    const target = scrollTo.current
    if (!override || !target) return
    scrollTo.current = null
    target.scrollIntoView()
  }, [override])
  const view = override ?? preferred
  const choose = (next: InterfaceView) => {
    setOverride(null)
    setView(next)
  }
  return (
    <ViewScope view={view}>
      <Tabs
        value={view}
        onValueChange={(value) => choose(value as InterfaceView)}
        className={cn(
          "mx-auto w-full gap-5",
          className,
          view === "advanced" ? advancedClassName : simpleClassName
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">{heading}</div>
          <ViewTabList label={label} onSelect={choose} />
        </div>
        <TabsContent
          value={view}
          forceMount
          className={cn("m-0", contentClassName)}
        >
          {children}
        </TabsContent>
      </Tabs>
    </ViewScope>
  )
}

type ViewOnlyElement =
  | "div"
  | "span"
  | "p"
  | "code"
  | "section"
  | "nav"
  | "footer"
  | "aside"
  | "details"

type ViewOnlyProps = Omit<HTMLAttributes<HTMLElement>, "hidden"> & {
  as?: ViewOnlyElement
}

/** Content for one view, kept mounted in the other so descendants keep state. */
function ViewOnly({
  view,
  as = "div",
  ...props
}: ViewOnlyProps & { view: InterfaceView }) {
  const Element = as
  return (
    <Element
      {...props}
      {...{ [VIEW_ONLY_ATTRIBUTE]: view }}
      hidden={usePresentedView() !== view}
    />
  )
}

export function AdvancedOnly(props: ViewOnlyProps) {
  return <ViewOnly view="advanced" {...props} />
}

export function SimpleOnly(props: ViewOnlyProps) {
  return <ViewOnly view="simple" {...props} />
}

/** Grid columns that only Advanced needs, such as a context sidebar. */
export function ViewColumns({
  children,
  className,
  advancedClassName
}: {
  children: ReactNode
  className?: string
  advancedClassName?: string
}) {
  const view = usePresentedView()
  return (
    <div className={cn(className, view === "advanced" && advancedClassName)}>
      {children}
    </div>
  )
}
