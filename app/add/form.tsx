"use client"

import { useState } from "react"
import { DefinitionForm } from "@/components/definition/definition-form"

export const DefineTermForm = ({
  interactive: interactiveDefault = false,
  initialTerm = ""
}: {
  // Initial mode; /add starts classic, /add/interactive starts interactive.
  // The choices switch modes in place without losing typed input.
  interactive?: boolean
  initialTerm?: string
}) => {
  const [interactive, setInteractive] = useState(interactiveDefault)

  const toggleMode = (checked: boolean) => {
    setInteractive(checked)
    // Keep both entry points deep-linkable without a navigation that would
    // discard what the contributor has typed.
    window.history.replaceState(null, "", checked ? "/add/interactive" : "/add")
  }

  return (
    <DefinitionForm
      interactive={interactive}
      onInteractiveChange={toggleMode}
      initialTerm={initialTerm}
    />
  )
}
