// The one sentence disclosing the comment-to-model feedback loop, shared by
// every comment surface so the wording cannot drift between contexts.
export const ModelRevisionDisclosure = () => (
  <p className="text-xs text-muted-foreground">
    Comments here are also sent to the model, which revises this definition in
    response.
  </p>
)
