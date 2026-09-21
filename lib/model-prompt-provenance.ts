import type { ProvEdge, ProvNode } from "./provenance"

/** Request-time inputs stay distinct from any independently published example. */
export function modelPromptInputProvenance({
  suggestionId,
  intent,
  requester,
  inputExample,
  userPrompt
}: {
  suggestionId: number
  intent: "new_term" | "revise_definition"
  requester: string
  inputExample: string | null
  userPrompt: string | null
}): { nodes: ProvNode[]; edges: ProvEdge[] } {
  const nodes: ProvNode[] = []
  const edges: ProvEdge[] = []
  const activityId = `act_ai_contribution_suggestion_${suggestionId}`
  const edge = (source: string, target: string, rel: ProvEdge["rel"]) => {
    edges.push({ id: `${source}->${target}:${rel}`, source, target, rel })
  }
  if (inputExample !== null) {
    const id = `ai_contribution_example_input_${suggestionId}`
    nodes.push({
      id,
      label: "Contributor example supplied to the model",
      type: "entity",
      detail: inputExample,
      meta: { evidenceBasis: "model_input", intent }
    })
    edge(activityId, id, "used")
    edge(id, requester, "wasAttributedTo")
  }
  if (userPrompt !== null) {
    const id = `ai_contribution_user_prompt_${suggestionId}`
    nodes.push({
      id,
      label: "Exact user message supplied to the model",
      type: "entity",
      detail: userPrompt,
      meta: { intent }
    })
    edge(activityId, id, "used")
  }
  return { nodes, edges }
}
