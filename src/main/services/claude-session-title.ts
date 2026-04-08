import { generateText } from './text-generation-router'
import type { AgentSdkId } from './agent-sdk-types'
import { createLogger } from './logger'

const log = createLogger({ component: 'ClaudeSessionTitle' })

const SYSTEM_PROMPT = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- ≤50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
"implement rate limiting" → Rate limiting implementation
"how do I connect postgres to my API" → Postgres API connection
"best practices for React hooks" → React hooks best practices
"@src/auth.ts can you add refresh token support" → Auth refresh token support
"@utils/parser.ts this is broken" → Parser bug fix
"look at @config.json" → Config review
"@App.tsx add dark mode toggle" → Dark mode toggle in App
</examples>`

const MAX_MESSAGE_LENGTH = 2000
const MAX_TITLE_LENGTH = 100
const TITLE_TRUNCATE_LENGTH = 97

/**
 * Post-process the raw LLM response into a clean title string.
 * Strips think tags, takes first non-empty line, and truncates if needed.
 */
function postProcessTitle(raw: string): string | null {
  // 1. Strip <think>...</think> tags (reasoning model artifacts)
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '')

  // 2. Split by newlines and trim each line
  const lines = stripped.split('\n').map((line) => line.trim())

  // 3. Take first non-empty line
  const title = lines.find((line) => line.length > 0) ?? ''

  if (!title) return null

  // 4. Truncate to 97 chars + "..." if > 100 chars
  if (title.length > MAX_TITLE_LENGTH) {
    return title.slice(0, TITLE_TRUNCATE_LENGTH) + '...'
  }

  return title
}

/**
 * Generate a short session title using the provider-aware text generation router.
 * Returns the generated title, or null if generation fails for any reason.
 *
 * The router handles timeouts, retries, and provider fallback internally.
 *
 * @param message - The user's first message to derive a title from
 * @param provider - Which agent SDK provider to use for generation (defaults to 'claude-code')
 */
export async function generateSessionTitle(
  message: string,
  provider: AgentSdkId = 'claude-code'
): Promise<string | null> {
  const truncatedMessage =
    message.length > MAX_MESSAGE_LENGTH ? message.slice(0, MAX_MESSAGE_LENGTH) + '...' : message

  const userPrompt = `Generate a title for this conversation:\n${truncatedMessage}`

  try {
    const result = await generateText(userPrompt, SYSTEM_PROMPT, provider)

    if (!result) {
      log.warn('generateSessionTitle: no result from text generation router')
      return null
    }

    const title = postProcessTitle(result)
    if (title) {
      log.info('generateSessionTitle: generated', { title, provider })
      return title
    }

    log.warn('generateSessionTitle: empty title after post-processing')
    return null
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log.warn('generateSessionTitle: generation failed', { error: errMsg })
    return null
  }
}
