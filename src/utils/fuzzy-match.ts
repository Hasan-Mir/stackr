export function scoreFuzzyMatch(query: string, target: string): number | undefined {
  const trimmed = query.trim()
  if (!trimmed) {
    return 0
  }

  const normalizedTarget = target.replace(/\\/g, '/')
  const terms = trimmed.replace(/\\/g, '/').split(/\s+/).filter(Boolean)

  let totalScore = 0
  for (const term of terms) {
    const termScore = scoreSubsequence(term, normalizedTarget)
    if (termScore === undefined) {
      return undefined
    }
    totalScore += termScore
  }

  return totalScore
}

function scoreSubsequence(term: string, target: string): number | undefined {
  const lowerTerm = term.toLowerCase()
  const lowerTarget = target.toLowerCase()

  let queryIndex = 0
  let score = 0
  let consecutive = 0
  let lastMatchIndex = -2

  const lastSlashIndex = target.lastIndexOf('/')

  for (let targetIndex = 0; targetIndex < target.length && queryIndex < term.length; targetIndex++) {
    if (lowerTarget[targetIndex] !== lowerTerm[queryIndex]) {
      continue
    }

    let charScore = 1

    if (targetIndex === lastMatchIndex + 1) {
      consecutive++
      charScore += consecutive * 3
    } else {
      consecutive = 0
    }

    if (isBoundary(target, targetIndex)) {
      charScore += 6
    }

    if (target[targetIndex] === term[queryIndex]) {
      charScore += 1
    }

    if (targetIndex > lastSlashIndex) {
      charScore += 2
    }

    score += charScore
    lastMatchIndex = targetIndex
    queryIndex++
  }

  if (queryIndex < term.length) {
    return undefined
  }

  // Prefer shorter targets when match quality is tied.
  return score - target.length * 0.01
}

function isBoundary(target: string, index: number): boolean {
  if (index === 0) {
    return true
  }

  const prev = target[index - 1]
  const curr = target[index]

  if (prev === '/' || prev === '_' || prev === '-' || prev === '.' || prev === ' ') {
    return true
  }

  return prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z'
}
