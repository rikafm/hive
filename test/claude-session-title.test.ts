import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock references (available to vi.mock factories) ───────────

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn()
}))

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../src/main/services/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

vi.mock('../src/main/services/text-generation-router', () => ({
  generateText: mockGenerateText
}))

// ── Tests ──────────────────────────────────────────────────────────────

describe('generateSessionTitle', () => {
  let generateSessionTitle: typeof import('../src/main/services/claude-session-title').generateSessionTitle

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGenerateText.mockResolvedValue(null)

    const mod = await import('../src/main/services/claude-session-title')
    generateSessionTitle = mod.generateSessionTitle
  })

  // ── Happy path ──────────────────────────────────────────────────────

  it('returns trimmed title on successful generation', async () => {
    mockGenerateText.mockResolvedValue('  Fix auth token refresh  \n')
    const result = await generateSessionTitle('Fix the auth token refresh bug')
    expect(result).toBe('Fix auth token refresh')
  })

  it('returns title with no extra whitespace', async () => {
    mockGenerateText.mockResolvedValue('Add dark mode toggle')
    const result = await generateSessionTitle('I want to add dark mode')
    expect(result).toBe('Add dark mode toggle')
  })

  // ── Post-processing ────────────────────────────────────────────────

  it('strips <think> tags from response', async () => {
    mockGenerateText.mockResolvedValue('<think>reasoning here</think>Fix auth bug')
    const result = await generateSessionTitle('message')
    expect(result).toBe('Fix auth bug')
  })

  it('strips multiline <think> tags', async () => {
    mockGenerateText.mockResolvedValue('<think>\nsome reasoning\nacross lines\n</think>\nDatabase migration')
    const result = await generateSessionTitle('message')
    expect(result).toBe('Database migration')
  })

  it('takes first non-empty line from multiline response', async () => {
    mockGenerateText.mockResolvedValue('\n\n  Fix auth bug  \nAnother line\n')
    const result = await generateSessionTitle('message')
    expect(result).toBe('Fix auth bug')
  })

  it('truncates titles longer than 100 chars to 97 + "..."', async () => {
    const longTitle = 'A'.repeat(110)
    mockGenerateText.mockResolvedValue(longTitle)
    const result = await generateSessionTitle('message')
    expect(result).toBe('A'.repeat(97) + '...')
    expect(result!.length).toBe(100)
  })

  it('returns full title when exactly 100 characters', async () => {
    const exactTitle = 'A'.repeat(100)
    mockGenerateText.mockResolvedValue(exactTitle)
    const result = await generateSessionTitle('message')
    expect(result).toBe(exactTitle)
  })

  it('returns full title when under 100 characters', async () => {
    const shortTitle = 'A'.repeat(50)
    mockGenerateText.mockResolvedValue(shortTitle)
    const result = await generateSessionTitle('message')
    expect(result).toBe(shortTitle)
  })

  // ── Null-return cases ──────────────────────────────────────────────

  it('returns null when generateText returns null', async () => {
    mockGenerateText.mockResolvedValue(null)
    const result = await generateSessionTitle('message')
    expect(result).toBeNull()
  })

  it('returns null on empty string result', async () => {
    mockGenerateText.mockResolvedValue('')
    const result = await generateSessionTitle('message')
    expect(result).toBeNull()
  })

  it('returns null on whitespace-only result', async () => {
    mockGenerateText.mockResolvedValue('   \n  ')
    const result = await generateSessionTitle('message')
    expect(result).toBeNull()
  })

  it('returns null when generateText throws', async () => {
    mockGenerateText.mockRejectedValue(new Error('generation failed'))
    const result = await generateSessionTitle('message')
    expect(result).toBeNull()
  })

  // ── Provider parameter ────────────────────────────────────────────

  it('passes default provider "claude-code" to generateText', async () => {
    mockGenerateText.mockResolvedValue('Some title')
    await generateSessionTitle('hello')

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'claude-code'
    )
  })

  it('passes custom provider to generateText', async () => {
    mockGenerateText.mockResolvedValue('Some title')
    await generateSessionTitle('hello', 'codex')

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'codex'
    )
  })

  it('passes "opencode" provider to generateText', async () => {
    mockGenerateText.mockResolvedValue('Some title')
    await generateSessionTitle('hello', 'opencode')

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'opencode'
    )
  })

  // ── Message truncation ────────────────────────────────────────────

  it('truncates messages longer than 2000 characters', async () => {
    mockGenerateText.mockResolvedValue('Some title')
    const longMessage = 'x'.repeat(5000)
    await generateSessionTitle(longMessage)

    const [prompt] = mockGenerateText.mock.calls[0] as [string, string, string]
    // The prompt should contain the truncated message (2000 chars + '...')
    expect(prompt).toContain('...')
    // Full 5000 char message should NOT be present
    expect(prompt).not.toContain(longMessage)
    // But the first 2000 chars should be
    expect(prompt).toContain(longMessage.slice(0, 2000))
  })

  it('does not truncate messages under 2000 characters', async () => {
    mockGenerateText.mockResolvedValue('Some title')
    const shortMessage = 'Fix the bug'
    await generateSessionTitle(shortMessage)

    const [prompt] = mockGenerateText.mock.calls[0] as [string, string, string]
    expect(prompt).toContain(shortMessage)
  })

  // ── User message format ────────────────────────────────────────────

  it('formats user prompt with "Generate a title" prefix', async () => {
    mockGenerateText.mockResolvedValue('Some title')
    await generateSessionTitle('hello world')

    const [prompt] = mockGenerateText.mock.calls[0] as [string, string, string]
    expect(prompt).toContain('Generate a title for this conversation:')
    expect(prompt).toContain('hello world')
  })

  it('passes system prompt to generateText', async () => {
    mockGenerateText.mockResolvedValue('Some title')
    await generateSessionTitle('hello')

    const [, systemPrompt] = mockGenerateText.mock.calls[0] as [string, string, string]
    expect(systemPrompt).toContain('You are a title generator')
  })

  // ── Never throws ──────────────────────────────────────────────────

  it('never throws — always returns string or null', async () => {
    mockGenerateText.mockRejectedValue(new Error('total explosion'))
    const result = await generateSessionTitle('message')
    expect(result).toBeNull()
  })
})
