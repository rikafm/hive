/**
 * Shared normalizer for Codex tool names and command text.
 *
 * Codex uses internal item types (e.g. `commandExecution`, `fileChange`) that
 * differ from the standard tool names the Hive UI expects (`Bash`, `fileChange`,
 * `Read`, etc.). This module provides a canonical mapping so every layer —
 * event mapper, activity mapper, timeline merger, and thread-snapshot parser —
 * produces consistent names that the renderer's ToolCard can match.
 */

// ── Tool name normalization ──────────────────────────────────────

const CODEX_TOOL_NAME_MAP: Record<string, string> = {
  commandexecution: 'Bash',
  command_execution: 'Bash',
  run_shell: 'Bash',
  filechange: 'fileChange',
  file_change: 'fileChange',
  apply_patch: 'fileChange',
  fileread: 'Read',
  file_read: 'Read',
  dynamictoolcall: 'Tool',
  dynamic_tool_call: 'Tool',
  collabagenttoolcall: 'Task',
  collab_agent_tool_call: 'Task',
  mcptoolcall: 'MCP',
  mcp_tool_call: 'MCP',
  websearch: 'WebSearch',
  web_search: 'WebSearch'
}

/**
 * Normalize a Codex-specific tool/item-type name to the canonical name the
 * Hive UI expects. Unknown names pass through unchanged.
 */
export function normalizeCodexToolName(rawName: string): string {
  const lower = rawName.toLowerCase()
  return CODEX_TOOL_NAME_MAP[lower] ?? rawName
}

// ── Shell prefix stripping ───────────────────────────────────────

/**
 * Regex matching a shell invocation wrapper that Codex prepends to commands.
 *
 * Handles patterns like:
 *   /bin/zsh -lc 'actual command'
 *   /usr/bin/bash -c "actual command"
 *   /bin/sh -lc actual command (unquoted)
 */
const SHELL_PREFIX_QUOTED_RE =
  /^\/(?:bin|usr\/bin)\/(?:zsh|bash|sh)\s+(?:-\w+\s+)+(?:'([\s\S]*)'|"([\s\S]*)")$/

const SHELL_PREFIX_UNQUOTED_RE =
  /^\/(?:bin|usr\/bin)\/(?:zsh|bash|sh)\s+(?:-\w+\s+)+(.+)$/

/**
 * Strip shell invocation prefixes (e.g. `/bin/zsh -lc '...'`) from a command
 * string, returning just the inner command. Non-matching strings pass through.
 */
export function stripShellPrefix(command: string): string {
  const trimmed = command.trim()

  const quotedMatch = SHELL_PREFIX_QUOTED_RE.exec(trimmed)
  if (quotedMatch) {
    return (quotedMatch[1] ?? quotedMatch[2] ?? trimmed).trim()
  }

  const unquotedMatch = SHELL_PREFIX_UNQUOTED_RE.exec(trimmed)
  if (unquotedMatch) {
    return (unquotedMatch[1] ?? trimmed).trim()
  }

  return command
}
