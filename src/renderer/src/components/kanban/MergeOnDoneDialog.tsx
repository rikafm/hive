import { useState, useEffect, useCallback } from 'react'
import { useKanbanStore } from '@/stores/useKanbanStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, GitMerge, GitCommit, Archive } from 'lucide-react'

type Step = 'loading' | 'commit' | 'merge' | 'archive'

interface BranchStats {
  filesChanged: number
  insertions: number
  deletions: number
  commitsAhead: number
}

interface ResolvedState {
  featureWorktreeId: string
  featureWorktreePath: string
  featureBranch: string
  baseWorktreePath: string
  baseBranch: string
  ticketTitle: string
  projectPath: string
  uncommittedStats: { filesChanged: number; insertions: number; deletions: number }
  branchStats: BranchStats
}

export function MergeOnDoneDialog() {
  const pendingDoneMove = useKanbanStore((s) => s.pendingDoneMove)
  const completeDoneMove = useKanbanStore((s) => s.completeDoneMove)

  const [step, setStep] = useState<Step>('loading')
  const [resolved, setResolved] = useState<ResolvedState | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [merging, setMerging] = useState(false)
  const [archiving, setArchiving] = useState(false)

  // Initialize when pendingDoneMove changes
  useEffect(() => {
    if (!pendingDoneMove) return

    let cancelled = false
    const pending = pendingDoneMove

    const init = async () => {
      setStep('loading')
      setResolved(null)

      try {
        // Look up ticket from store
        const tickets = useKanbanStore.getState().getTicketsForProject(pending.projectId)
        const ticket = tickets.find((t) => t.id === pending.ticketId)

        if (!ticket || !ticket.worktree_id) {
          await completeDoneMove()
          return
        }

        // Fetch feature worktree
        const featureWorktree = await window.db.worktree.get(ticket.worktree_id)
        if (!featureWorktree || featureWorktree.status !== 'active') {
          await completeDoneMove()
          return
        }

        // Resolve base branch
        const activeWorktrees = await window.db.worktree.getActiveByProject(pending.projectId)
        const defaultWt = activeWorktrees.find((w) => w.is_default)
        const resolvedBaseBranch = featureWorktree.base_branch ?? defaultWt?.branch_name

        if (!resolvedBaseBranch) {
          toast.warning('Cannot merge — no base branch resolved')
          await completeDoneMove()
          return
        }

        // Find base worktree
        const baseWorktree = activeWorktrees.find(
          (w) => w.branch_name === resolvedBaseBranch && w.status === 'active'
        )

        if (!baseWorktree) {
          toast.warning(`Cannot merge — no worktree for ${resolvedBaseBranch}`)
          await completeDoneMove()
          return
        }

        // Check base worktree for dirty state
        const baseDirty = await window.gitOps.hasUncommittedChanges(baseWorktree.path)
        if (baseDirty) {
          toast.warning(`Cannot merge — commit or stash changes on ${resolvedBaseBranch} first`)
          await completeDoneMove()
          return
        }

        if (cancelled) return

        // Check feature worktree state
        const [hasUncommitted, branchStatResult] = await Promise.all([
          window.gitOps.hasUncommittedChanges(featureWorktree.path),
          window.gitOps.branchDiffShortStat(featureWorktree.path, resolvedBaseBranch)
        ])

        if (cancelled) return

        // Get uncommitted diff stats if needed
        let uncommittedStats = { filesChanged: 0, insertions: 0, deletions: 0 }
        if (hasUncommitted) {
          const diffStatResult = await window.gitOps.getDiffStat(featureWorktree.path)
          if (diffStatResult.success && diffStatResult.files) {
            uncommittedStats = {
              filesChanged: diffStatResult.files.length,
              insertions: diffStatResult.files.reduce((sum, f) => sum + f.additions, 0),
              deletions: diffStatResult.files.reduce((sum, f) => sum + f.deletions, 0)
            }
          }
        }

        if (cancelled) return

        const branchStats: BranchStats = branchStatResult.success
          ? {
              filesChanged: branchStatResult.filesChanged,
              insertions: branchStatResult.insertions,
              deletions: branchStatResult.deletions,
              commitsAhead: branchStatResult.commitsAhead
            }
          : { filesChanged: 0, insertions: 0, deletions: 0, commitsAhead: 0 }

        // If no diffs at all, just move to done
        if (!hasUncommitted && branchStats.commitsAhead === 0) {
          await completeDoneMove()
          return
        }

        // Get project path for archive step
        const project = await window.db.project.get(featureWorktree.project_id)
        if (cancelled) return

        setResolved({
          featureWorktreeId: featureWorktree.id,
          featureWorktreePath: featureWorktree.path,
          featureBranch: featureWorktree.branch_name,
          baseWorktreePath: baseWorktree.path,
          baseBranch: resolvedBaseBranch,
          ticketTitle: ticket.title,
          projectPath: project?.path ?? baseWorktree.path,
          uncommittedStats,
          branchStats
        })
        setCommitMessage(ticket.title)
        setStep(hasUncommitted ? 'commit' : 'merge')
      } catch (err) {
        if (!cancelled) {
          toast.error(`Failed to check branch: ${err instanceof Error ? err.message : String(err)}`)
          await completeDoneMove()
        }
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [pendingDoneMove, completeDoneMove])

  const handleCommit = useCallback(async () => {
    if (!resolved || !commitMessage.trim()) return
    setCommitting(true)
    try {
      const stageResult = await window.gitOps.stageAll(resolved.featureWorktreePath)
      if (!stageResult.success) {
        toast.error(`Failed to stage: ${stageResult.error}`)
        return
      }

      const commitResult = await window.gitOps.commit(
        resolved.featureWorktreePath,
        commitMessage.trim()
      )
      if (!commitResult.success) {
        toast.error(`Failed to commit: ${commitResult.error}`)
        return
      }

      toast.success('Changes committed')

      // Re-check branch divergence after commit
      const statResult = await window.gitOps.branchDiffShortStat(
        resolved.featureWorktreePath,
        resolved.baseBranch
      )

      if (statResult.success && statResult.commitsAhead > 0) {
        setResolved((prev) =>
          prev
            ? {
                ...prev,
                branchStats: {
                  filesChanged: statResult.filesChanged,
                  insertions: statResult.insertions,
                  deletions: statResult.deletions,
                  commitsAhead: statResult.commitsAhead
                }
              }
            : prev
        )
        setStep('merge')
      } else {
        // No divergence after commit — base already has everything
        await completeDoneMove()
      }
    } catch (err) {
      toast.error(`Commit failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCommitting(false)
    }
  }, [resolved, commitMessage, completeDoneMove])

  const handleMerge = useCallback(async () => {
    if (!resolved) return
    setMerging(true)
    try {
      // Pull latest on base branch first
      await window.gitOps.pull(resolved.baseWorktreePath)

      // Merge feature into base
      const mergeResult = await window.gitOps.merge(
        resolved.baseWorktreePath,
        resolved.featureBranch
      )

      if (!mergeResult.success) {
        // Conflicts or error — abort and let user handle manually
        if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
          await window.gitOps.mergeAbort(resolved.baseWorktreePath)
          toast.error(
            `Merge conflicts in ${mergeResult.conflicts.length} file${mergeResult.conflicts.length !== 1 ? 's' : ''} — merge manually`
          )
        } else {
          await window.gitOps.mergeAbort(resolved.baseWorktreePath)
          toast.error(`Merge failed: ${mergeResult.error}`)
        }
        await completeDoneMove()
        return
      }

      toast.success('Branch merged successfully')
      setStep('archive')
    } catch (err) {
      toast.error(`Merge failed: ${err instanceof Error ? err.message : String(err)}`)
      await completeDoneMove()
    } finally {
      setMerging(false)
    }
  }, [resolved, completeDoneMove])

  const handleArchive = useCallback(async () => {
    if (!resolved) return
    setArchiving(true)
    try {
      const result = await window.worktreeOps.delete({
        worktreeId: resolved.featureWorktreeId,
        worktreePath: resolved.featureWorktreePath,
        branchName: resolved.featureBranch,
        projectPath: resolved.projectPath,
        archive: true
      })

      if (result.success) {
        toast.success('Worktree archived')
      } else {
        toast.error(`Failed to archive: ${result.error}`)
      }
    } catch (err) {
      toast.error(`Archive failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setArchiving(false)
      await completeDoneMove()
    }
  }, [resolved, completeDoneMove])

  const stepTitle: Record<Step, string> = {
    loading: 'Moving to Done...',
    commit: 'Uncommitted changes',
    merge: 'Merge branch',
    archive: 'Archive worktree'
  }

  const stepIcon: Record<Step, React.ReactNode> = {
    loading: <Loader2 className="h-4 w-4 animate-spin" />,
    commit: <GitCommit className="h-4 w-4" />,
    merge: <GitMerge className="h-4 w-4" />,
    archive: <Archive className="h-4 w-4" />
  }

  return (
    <Dialog
      open={!!pendingDoneMove}
      onOpenChange={(open) => {
        if (!open) completeDoneMove()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {stepIcon[step]}
            {stepTitle[step]}
          </DialogTitle>
        </DialogHeader>

        {step === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking branch status...
          </div>
        )}

        {step === 'commit' && resolved && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-muted-foreground">
              {resolved.uncommittedStats.filesChanged} files changed,{' '}
              <span className="text-green-500">+{resolved.uncommittedStats.insertions}</span>{' '}
              <span className="text-red-500">-{resolved.uncommittedStats.deletions}</span>
            </p>
            <Input
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message"
            />
            <div className="flex items-center justify-between">
              <button
                onClick={() => completeDoneMove()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Skip, just move to Done
              </button>
              <Button
                size="sm"
                onClick={handleCommit}
                disabled={!commitMessage.trim() || committing}
              >
                {committing ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <GitCommit className="h-3 w-3 mr-1" />
                )}
                Commit
              </Button>
            </div>
          </div>
        )}

        {step === 'merge' && resolved && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-muted-foreground">
              Merge <code className="bg-muted px-1 rounded">{resolved.featureBranch}</code> into{' '}
              <code className="bg-muted px-1 rounded">{resolved.baseBranch}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              {resolved.branchStats.filesChanged} files changed,
              <span className="text-green-500"> +{resolved.branchStats.insertions}</span>
              <span className="text-red-500"> -{resolved.branchStats.deletions}</span>,{' '}
              {resolved.branchStats.commitsAhead} commit
              {resolved.branchStats.commitsAhead !== 1 ? 's' : ''} ahead
            </p>
            <div className="flex items-center justify-between">
              <button
                onClick={() => completeDoneMove()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Skip, just move to Done
              </button>
              <Button size="sm" onClick={handleMerge} disabled={merging}>
                {merging ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <GitMerge className="h-3 w-3 mr-1" />
                )}
                Merge
              </Button>
            </div>
          </div>
        )}

        {step === 'archive' && resolved && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-muted-foreground">
              Merge successful! Archive the{' '}
              <code className="bg-muted px-1 rounded">{resolved.featureBranch}</code> worktree?
            </p>
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => completeDoneMove()}>
                Keep
              </Button>
              <Button size="sm" onClick={handleArchive} disabled={archiving}>
                {archiving ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Archive className="h-3 w-3 mr-1" />
                )}
                Archive
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
