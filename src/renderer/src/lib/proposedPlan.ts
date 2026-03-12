export function looksLikeCodexProposedPlan(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const hasPlanHeading = /^(plan(?:\s+[^\n]+)?|#{1,6}\s+[^\n]+)$/i.test(firstLine)
  const hasSteps = /(^|\n)\s*(?:[-*]|\d+\.)\s+\S/m.test(trimmed)
  const startsWithQuestion = /^[^\n]*\?\s*(?:\n|$)/.test(trimmed)

  return hasPlanHeading && hasSteps && !startsWithQuestion
}

export function buildPlanImplementationPrompt(planMarkdown: string): string {
  return `PLEASE IMPLEMENT THIS PLAN:\n${planMarkdown.trim()}`
}

export function resolvePlanFollowUpSubmission(input: { draftText: string; planMarkdown: string }): {
  text: string
  interactionMode: 'build' | 'plan'
} {
  const trimmedDraftText = input.draftText.trim()
  if (trimmedDraftText.length > 0) {
    return {
      text: trimmedDraftText,
      interactionMode: 'plan'
    }
  }

  return {
    text: buildPlanImplementationPrompt(input.planMarkdown),
    interactionMode: 'build'
  }
}
