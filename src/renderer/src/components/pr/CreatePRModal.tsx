import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  GitPullRequest,
  GitBranch,
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Circle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useGitStore } from '@/stores/useGitStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModalPhase = 'form' | 'progress' | 'success' | 'error'

type StepStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped'

interface Step {
  id: string
  label: string
  status: StepStatus
}

interface PRResult {
  url: string
  number: number
  title: string
}

interface CreatePRModalProps {
  worktreeId: string
  worktreePath: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: StepStatus }): React.JSX.Element {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />
    case 'complete':
      return <Check className="h-4 w-4 text-green-500" />
    case 'error':
      return <AlertCircle className="h-4 w-4 text-destructive" />
    case 'skipped':
      return <Check className="h-4 w-4 text-muted-foreground" />
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreatePRModal({
  worktreeId,
  worktreePath
}: CreatePRModalProps): React.JSX.Element {
  const open = useGitStore((s) => s.createPRModalOpen)
  const setOpen = useGitStore((s) => s.setCreatePRModalOpen)
  const branchInfo = useGitStore((s) =>
    worktreePath ? (s.branchInfoByWorktree.get(worktreePath) ?? null) : null
  )
  const prTargetBranch = useGitStore((s) =>
    worktreeId ? s.prTargetBranch.get(worktreeId) : undefined
  )
  const attachPR = useGitStore((s) => s.attachPR)
  const defaultAgentSdk = useSettingsStore((s) => s.defaultAgentSdk) ?? 'claude-code'

  // ── Form state ──────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)
  const [remoteBranches, setRemoteBranches] = useState<
    { name: string; isRemote: boolean }[]
  >([])
  const [commitCount, setCommitCount] = useState<number | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)

  // ── Phase state ─────────────────────────────────────────────────
  const [phase, setPhase] = useState<ModalPhase>('form')
  const [steps, setSteps] = useState<Step[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [prResult, setPrResult] = useState<PRResult | null>(null)
  const [duplicatePrUrl, setDuplicatePrUrl] = useState<string | null>(null)

  // Cancel support
  const cancelledRef = useRef(false)

  // ── Reset on open ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return

    // Reset all state
    setTitle('')
    setBody('')
    setPhase('form')
    setSteps([])
    setErrorMessage('')
    setPrResult(null)
    setDuplicatePrUrl(null)
    cancelledRef.current = false
    setCommitCount(null)

    // Pre-fill base branch from store
    setBaseBranch(prTargetBranch ?? 'main')

    // Fetch remote branches
    setLoadingBranches(true)
    window.gitOps
      .listBranchesWithStatus(worktreePath)
      .then((result) => {
        if (result.success) {
          setRemoteBranches(result.branches.filter((b) => b.isRemote))
        }
      })
      .catch(() => {
        // Non-critical
      })
      .finally(() => setLoadingBranches(false))
  }, [open, worktreePath, prTargetBranch])

  // ── Refresh commit count when base branch changes ───────────────
  useEffect(() => {
    if (!open || !baseBranch) return
    setCommitCount(null)
    window.gitOps
      .getRangeDiff(worktreePath, baseBranch)
      .then((rd) => setCommitCount(rd.commitCount))
      .catch(() => {
        // Non-critical
      })
  }, [open, worktreePath, baseBranch])

  // ── Derived: clean branch names for dropdown ────────────────────
  const branchOptions = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const b of remoteBranches) {
      // Strip origin/ prefix for display
      const name = b.name.replace(/^origin\//, '')
      if (!seen.has(name)) {
        seen.add(name)
        result.push(name)
      }
    }
    // Ensure current baseBranch is in the list
    if (baseBranch && !result.includes(baseBranch)) {
      result.unshift(baseBranch)
    }
    return result.sort()
  }, [remoteBranches, baseBranch])

  // ── Step updater ────────────────────────────────────────────────
  const updateStep = useCallback(
    (id: string, status: StepStatus) => {
      setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)))
    },
    []
  )

  // ── Create PR flow ──────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!baseBranch) return

    cancelledRef.current = false
    setErrorMessage('')
    setDuplicatePrUrl(null)

    // Determine which steps are needed
    let willPush = false
    try {
      willPush = await window.gitOps.needsPush(worktreePath)
    } catch {
      // Assume no push needed
    }

    const needsGenerate = !title.trim() || !body.trim()

    const stepList: Step[] = []
    if (willPush) {
      stepList.push({ id: 'push', label: 'Pushing branch...', status: 'pending' })
    }
    if (needsGenerate) {
      stepList.push({
        id: 'generate',
        label: 'Generating PR content...',
        status: 'pending'
      })
    }
    stepList.push({ id: 'create', label: 'Creating pull request...', status: 'pending' })

    setSteps(stepList)
    setPhase('progress')

    let finalTitle = title.trim()
    let finalBody = body.trim()

    try {
      // Step 1: Push if needed
      if (willPush) {
        if (cancelledRef.current) return
        updateStep('push', 'running')
        const pushResult = await window.gitOps.push(worktreePath)
        if (!pushResult.success) {
          updateStep('push', 'error')
          throw new Error(pushResult.error ?? 'Push failed')
        }
        updateStep('push', 'complete')
      }

      // Step 2: Generate content if needed
      if (needsGenerate) {
        if (cancelledRef.current) return
        updateStep('generate', 'running')
        const genResult = await window.gitOps.generatePRContent(
          worktreePath,
          baseBranch,
          defaultAgentSdk
        )
        if (!genResult.success) {
          updateStep('generate', 'error')
          throw new Error(genResult.error ?? 'Content generation failed')
        }
        if (!finalTitle && genResult.title) finalTitle = genResult.title
        if (!finalBody && genResult.body) finalBody = genResult.body
        // Fallback if generation returned empty
        if (!finalTitle) finalTitle = branchInfo?.name ?? 'Pull Request'
        if (!finalBody) finalBody = ''
        updateStep('generate', 'complete')
      }

      // Step 3: Create PR
      if (cancelledRef.current) return
      updateStep('create', 'running')
      const createResult = await window.gitOps.createPR(
        worktreePath,
        baseBranch,
        finalTitle,
        finalBody
      )

      if (!createResult.success) {
        updateStep('create', 'error')

        // Check for "already exists" pattern
        const errMsg = createResult.error ?? 'PR creation failed'
        const alreadyExistsMatch = errMsg.match(
          /already exists.*?(\d+)|pull request.*?#(\d+).*?already/i
        )
        if (alreadyExistsMatch) {
          const existingNumber = parseInt(alreadyExistsMatch[1] || alreadyExistsMatch[2], 10)
          if (existingNumber) {
            // Try to extract URL or build one
            const urlMatch = errMsg.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)
            const existingUrl =
              urlMatch?.[0] ?? `https://github.com/unknown/pull/${existingNumber}`

            // Auto-attach the existing PR
            await attachPR(worktreeId, existingNumber, existingUrl)
            setDuplicatePrUrl(existingUrl)
            setPrResult({
              url: existingUrl,
              number: existingNumber,
              title: finalTitle
            })
            setPhase('error')
            setErrorMessage(
              `A pull request already exists for this branch (#${existingNumber}). It has been attached to this workspace.`
            )
            return
          }
        }

        throw new Error(errMsg)
      }

      updateStep('create', 'complete')

      // Attach the new PR
      if (cancelledRef.current) return
      const prUrl = createResult.url ?? ''
      const prNumber = createResult.number ?? 0
      await attachPR(worktreeId, prNumber, prUrl)

      setPrResult({
        url: prUrl,
        number: prNumber,
        title: finalTitle
      })
      setPhase('success')
    } catch (err) {
      if (cancelledRef.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(msg)
      setPhase('error')
    }
  }, [
    worktreePath,
    worktreeId,
    baseBranch,
    title,
    body,
    defaultAgentSdk,
    branchInfo,
    attachPR,
    updateStep
  ])

  // ── Cancel handler ──────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    if (phase === 'progress') {
      cancelledRef.current = true
    }
    setOpen(false)
  }, [phase, setOpen])

  // ── Render: Form ────────────────────────────────────────────────
  const renderForm = (): React.JSX.Element => (
    <>
      {/* Source branch (read-only) */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Source branch</label>
        <div className="flex items-center gap-2 px-3 py-2 text-sm border rounded-md bg-muted/50">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{branchInfo?.name ?? 'Unknown'}</span>
          {commitCount !== null && (
            <span className="ml-auto text-xs text-muted-foreground shrink-0">
              {commitCount} commit{commitCount !== 1 ? 's' : ''} ahead
            </span>
          )}
        </div>
      </div>

      {/* Base branch dropdown */}
      <div className="space-y-1.5">
        <label htmlFor="pr-base-branch" className="text-sm font-medium text-foreground">Base branch</label>
        <Popover open={branchDropdownOpen} onOpenChange={setBranchDropdownOpen}>
          <PopoverTrigger asChild>
            <button
              id="pr-base-branch"
              type="button"
              className={cn(
                'flex items-center justify-between w-full px-3 py-2 text-sm border rounded-md',
                'bg-background hover:bg-accent/50 transition-colors text-left'
              )}
            >
              <span className="flex items-center gap-2">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{baseBranch || 'Select base branch...'}</span>
              </span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform',
                  branchDropdownOpen && 'rotate-180'
                )}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            {loadingBranches ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : branchOptions.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                No branches found
              </div>
            ) : (
              <div className="max-h-[200px] overflow-y-auto">
                {branchOptions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-2 text-sm text-left',
                      'hover:bg-accent transition-colors',
                      name === baseBranch && 'bg-accent'
                    )}
                    onClick={() => {
                      setBaseBranch(name)
                      setBranchDropdownOpen(false)
                    }}
                  >
                    <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{name}</span>
                    {name === baseBranch && (
                      <Check className="h-3 w-3 ml-auto text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <label htmlFor="pr-title" className="text-sm font-medium text-foreground">Title</label>
        <Input
          id="pr-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Leave empty to auto-generate"
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label htmlFor="pr-description" className="text-sm font-medium text-foreground">Description</label>
        <Textarea
          id="pr-description"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave empty to auto-generate"
          rows={4}
        />
      </div>
    </>
  )

  // ── Render: Progress ────────────────────────────────────────────
  const renderProgress = (): React.JSX.Element => (
    <div className="space-y-3 py-4">
      {steps.map((step) => (
        <div key={step.id} className="flex items-center gap-3">
          <StepIcon status={step.status} />
          <span
            className={cn(
              'text-sm',
              step.status === 'running' && 'text-foreground font-medium',
              step.status === 'pending' && 'text-muted-foreground',
              step.status === 'complete' && 'text-muted-foreground',
              step.status === 'error' && 'text-destructive'
            )}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  )

  // ── Render: Success ─────────────────────────────────────────────
  const renderSuccess = (): React.JSX.Element => (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-green-500/10">
        <Check className="h-6 w-6 text-green-500" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">Pull Request Created</p>
        {prResult && (
          <>
            <p className="text-sm text-muted-foreground">
              #{prResult.number} {prResult.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {branchInfo?.name ?? 'branch'} {'\u2192'} {baseBranch}
            </p>
          </>
        )}
      </div>
      {prResult?.url && (
        <Button variant="outline" size="sm" asChild>
          <a href={prResult.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open on GitHub
          </a>
        </Button>
      )}
    </div>
  )

  // ── Render: Error ───────────────────────────────────────────────
  const renderError = (): React.JSX.Element => (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-destructive/10">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">
          {duplicatePrUrl ? 'Existing Pull Request' : 'Error'}
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">{errorMessage}</p>
      </div>
      {duplicatePrUrl && (
        <Button variant="outline" size="sm" asChild>
          <a href={duplicatePrUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open on GitHub
          </a>
        </Button>
      )}
    </div>
  )

  // ── Render: Footer ──────────────────────────────────────────────
  const renderFooter = (): React.JSX.Element => {
    switch (phase) {
      case 'form':
        return (
          <DialogFooter>
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!baseBranch}>
              <GitPullRequest className="h-4 w-4 mr-1.5" />
              Create Pull Request
            </Button>
          </DialogFooter>
        )
      case 'progress':
        return (
          <DialogFooter>
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
          </DialogFooter>
        )
      case 'success':
        return (
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        )
      case 'error':
        return (
          <DialogFooter>
            {duplicatePrUrl ? (
              <Button onClick={() => setOpen(false)}>Close</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button onClick={() => setPhase('form')}>Retry</Button>
              </>
            )}
          </DialogFooter>
        )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && phase === 'progress') {
          cancelledRef.current = true
        }
        setOpen(value)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <GitPullRequest className="h-5 w-5" />
              Create Pull Request
            </span>
          </DialogTitle>
          {phase === 'form' && (
            <DialogDescription>
              Create a new pull request for this workspace.
            </DialogDescription>
          )}
        </DialogHeader>

        {phase === 'form' && renderForm()}
        {phase === 'progress' && renderProgress()}
        {phase === 'success' && renderSuccess()}
        {phase === 'error' && renderError()}

        {renderFooter()}
      </DialogContent>
    </Dialog>
  )
}
