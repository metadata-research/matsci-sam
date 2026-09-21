import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import ts from "typescript"

// Exercise the action shell without mounting network-owning children or a DOM.
// Its real JSX and event handlers run with a small state harness; child markers
// let these checks distinguish an unmounted workspace from a merely hidden one.
const require = createRequire(import.meta.url)
const Button = () => null
const Link = () => null
const RevisionSuggestionForm = () => null
const TermCommentBox = () => null
type Props = {
  definitionId: number
  revisionId: number
  sourceDefinition: string
  term: string
  contributorAccess: "anonymous" | "profile-required" | "ready"
}
type StateOwner = { values: unknown[]; cursor: number }
let activeOwner: StateOwner

const source = readFileSync(resolve("app/discussion/comment-box.tsx"), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true
  }
}).outputText
const compiledModule = {
  exports: {} as { DiscussionCommentBox: (props: Props) => ReactNode }
}
runInNewContext(compiled, {
  exports: compiledModule.exports,
  require: (name: string) => {
    if (name === "react/jsx-runtime") return require(name)
    if (name === "react")
      return {
        useState(initial: unknown) {
          const owner = activeOwner
          const index = owner.cursor++
          if (index >= owner.values.length) owner.values[index] = initial
          return [
            owner.values[index],
            (update: unknown) => {
              owner.values[index] =
                typeof update === "function"
                  ? update(owner.values[index])
                  : update
            }
          ]
        }
      }
    if (name === "next/link") return { __esModule: true, default: Link }
    if (name === "@/components/ui/button") return { Button }
    if (name === "@/components/definition/revision-suggestion-form")
      return { RevisionSuggestionForm }
    if (name === "@/components/term/comment-box") return { TermCommentBox }
    throw new Error(`Unexpected dependency: ${name}`)
  }
})

type Element = ReactElement<{
  children?: ReactNode
  [key: string]: unknown
}>
const elements = (node: ReactNode): Element[] => {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Element["props"]>(node)) return []
  return [node, ...elements(node.props.children)]
}
const createRow = (contributorAccess: Props["contributorAccess"], id = 1) => {
  const state = { values: [], cursor: 0 } as StateOwner
  const props: Props = {
    contributorAccess,
    definitionId: id,
    revisionId: id + 100,
    sourceDefinition: `Published definition ${id}`,
    term: `Term ${id}`
  }
  return {
    props,
    render() {
      activeOwner = state
      state.cursor = 0
      return elements(compiledModule.exports.DiscussionCommentBox(props))
    }
  }
}
const workspace = (row: Element[]) =>
  row.find((element) => element.type === RevisionSuggestionForm)
const toggle = (row: Element[]) => {
  const button = row.find(
    (element) =>
      element.type === Button &&
      element.props.children === "Start an alternative"
  )
  assert.ok(button, "ready contributors have an explicit start control")
  return button
}
const click = (button: Element) => {
  assert.equal(typeof button.props.onClick, "function")
  ;(button.props.onClick as () => void)()
}

for (const [access, destination] of [
  ["anonymous", "/login"],
  ["profile-required", "/profile/edit"]
] as const) {
  const row = createRow(access).render()
  assert.equal(workspace(row), undefined, `${access} never mounts a lookup`)
  assert.ok(
    row.some(
      (element) => element.type === Link && element.props.href === destination
    ),
    `${access} gets the appropriate account action`
  )
  assert.equal(
    row.some(
      (element) =>
        element.type === Button &&
        element.props.children === "Start an alternative"
    ),
    false,
    `${access} cannot start the protected action`
  )
}

const feed = Array.from({ length: 8 }, (_, index) =>
  createRow("ready", index + 1)
)
for (const row of feed)
  assert.equal(
    workspace(row.render()),
    undefined,
    "reading a row starts no lookup"
  )

const chosen = feed[3]
click(toggle(chosen.render()))
const rendered = chosen.render()
const startedWorkspace = workspace(rendered)
assert.ok(startedWorkspace, "an explicit start mounts the selected workspace")
assert.equal(startedWorkspace.props.term, chosen.props.term)
assert.equal(startedWorkspace.props.definitionId, chosen.props.definitionId)
assert.equal(startedWorkspace.props.sourceRevisionId, chosen.props.revisionId)
assert.equal(
  startedWorkspace.props.sourceDefinition,
  chosen.props.sourceDefinition
)
assert.equal(
  rendered.some(
    (element) =>
      element.type === Button &&
      element.props.children === "Start an alternative"
  ),
  false
)
for (const row of feed.filter((row) => row !== chosen))
  assert.equal(workspace(row.render()), undefined, "other rows stay inactive")

assert.ok(
  workspace(chosen.render()),
  "subsequent renders keep the selected workspace mounted"
)

chosen.props.contributorAccess = "anonymous"
assert.equal(
  workspace(chosen.render()),
  undefined,
  "access loss closes the workspace"
)

console.log("Discussion action gating checks passed.")
