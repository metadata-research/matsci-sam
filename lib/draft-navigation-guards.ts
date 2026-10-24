// Button-driven navigation cannot use the editors' anchor-click guards.
// Editors register while mounted so these actions wait for their save queues.
const guards = new Set<() => Promise<unknown>>()

export function registerDraftNavigationGuard(save: () => Promise<unknown>) {
  guards.add(save)
  return () => {
    guards.delete(save)
  }
}

export async function saveDraftsBeforeNavigation() {
  await Promise.all(Array.from(guards, (save) => Promise.resolve().then(save)))
}
