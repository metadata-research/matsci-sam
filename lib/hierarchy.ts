/** Navigation structure only. Callers supply authorized data and destinations. */
export type HierarchyNode = {
  id: string
  label: string
  href?: string
  labels?: string[]
  matches?: boolean
  children: HierarchyNode[]
}

export type HierarchyEntry = {
  id: string
  group: string
  path: string[]
  label: string
  href: string
  labels?: string[]
  matches: boolean
}

/** Scope paths to their group. Missing parent records become navigation groups. */
export function buildHierarchy(
  groups: { id: string; label: string }[],
  entries: HierarchyEntry[]
): HierarchyNode[] {
  return groups.flatMap((group) => {
    const root: HierarchyNode = {
      id: JSON.stringify([group.id]),
      label: group.label,
      children: []
    }
    const paths = new Map<string, HierarchyNode>()
    const records = new Map<HierarchyNode, HierarchyNode[]>()
    for (const entry of entries) {
      if (entry.group !== group.id || !entry.path.length) continue
      let parent = root
      for (let index = 0; index < entry.path.length; index++) {
        const key = JSON.stringify([
          group.id,
          ...entry.path.slice(0, index + 1)
        ])
        let node = paths.get(key)
        if (!node) {
          node = { id: key, label: entry.path[index], children: [] }
          paths.set(key, node)
          parent.children.push(node)
        }
        parent = node
      }
      const atPath = records.get(parent) ?? []
      atPath.push({
        id: JSON.stringify([group.id, "record", entry.id]),
        label: entry.label,
        href: entry.href,
        labels: entry.labels,
        matches: entry.matches,
        children: []
      })
      records.set(parent, atPath)
    }
    for (const [node, atPath] of records) {
      if (atPath.length === 1) {
        const [record] = atPath
        node.label = record.label
        node.href = record.href
        node.labels = record.labels
        node.matches = record.matches
      } else {
        // A shared path is a navigation group. Neither record is presented
        // as the parent of the other, and all source identities remain reachable.
        node.children.unshift(...atPath)
      }
    }
    return root.children.length ? [root] : []
  })
}

/** Search retains each matching field and its ancestors, including unlinked groups. */
export function matchingHierarchy(nodes: HierarchyNode[]): HierarchyNode[] {
  return nodes.flatMap((node) => {
    const children = matchingHierarchy(node.children)
    return node.matches || children.length ? [{ ...node, children }] : []
  })
}
