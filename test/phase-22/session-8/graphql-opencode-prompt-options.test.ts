import { describe, it, expect, vi, beforeEach } from 'vitest'

const { graphqlQueryMock } = vi.hoisted(() => ({
  graphqlQueryMock: vi.fn()
}))

vi.mock('../../../src/renderer/src/transport/graphql/client', () => ({
  graphqlQuery: graphqlQueryMock,
  graphqlSubscribe: vi.fn()
}))

import { createOpenCodeOpsAdapter } from '../../../src/renderer/src/transport/graphql/adapters/opencode-ops'

describe('GraphQL OpenCode prompt options', () => {
  beforeEach(() => {
    graphqlQueryMock.mockReset()
    graphqlQueryMock.mockResolvedValue({
      opencodePrompt: { success: true }
    })
  })

  it('includes codexFastMode options in the prompt mutation input', async () => {
    const adapter = createOpenCodeOpsAdapter()

    await adapter.prompt(
      '/tmp/test',
      'codex-session-1',
      [{ type: 'text', text: 'hello' }],
      { providerID: 'openai', modelID: 'gpt-5.4' },
      { codexFastMode: true }
    )

    expect(graphqlQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('mutation ($input: OpenCodePromptInput!)'),
      {
        input: expect.objectContaining({
          worktreePath: '/tmp/test',
          opencodeSessionId: 'codex-session-1',
          options: { codexFastMode: true }
        })
      }
    )
  })
})
