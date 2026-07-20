// Word-level diff used by the refine panel to highlight what the model
// changed relative to the author's current text. Returns the target ("to")
// text as tokens, flagging words that don't appear in the source per a
// longest-common-subsequence alignment. Removed words are not rendered.
export type DiffToken = { text: string; added: boolean }

export const diffWords = (from: string, to: string): DiffToken[] => {
  const a = from.split(/\s+/).filter(Boolean)
  const b = to.split(/\s+/).filter(Boolean)

  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])

  const tokens: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      tokens.push({ text: b[j], added: false })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else {
      tokens.push({ text: b[j], added: true })
      j++
    }
  }
  for (; j < b.length; j++) tokens.push({ text: b[j], added: true })

  return tokens
}
