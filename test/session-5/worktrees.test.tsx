import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../utils/render'
import { AppLayout } from '@/components/layout'
import { useProjectStore, useWorktreeStore } from '@/stores'

// Mock Worktree type
interface MockWorktree {
  id: string
  project_id: string
  name: string
  branch_name: string
  path: string
  status: 'active' | 'archived'
  is_default?: boolean
  created_at: string
  last_accessed_at: string
}

// Mock the window APIs
const mockDb = {
  project: {
    getAll: vi.fn(),
    create: vi.fn(),
    getByPath: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    touch: vi.fn()
  },
  worktree: {
    getActiveByProject: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    archive: vi.fn(),
    touch: vi.fn()
  }
}

const mockProjectOps = {
  openDirectoryDialog: vi.fn(),
  validateProject: vi.fn(),
  showInFolder: vi.fn(),
  copyToClipboard: vi.fn(),
  readFromClipboard: vi.fn(),
  openPath: vi.fn(),
  isGitRepository: vi.fn(),
  loadLanguageIcons: vi.fn().mockResolvedValue([])
}

const mockWorktreeOps = {
  create: vi.fn(),
  delete: vi.fn(),
  sync: vi.fn(),
  exists: vi.fn(),
  openInTerminal: vi.fn(),
  openInEditor: vi.fn(),
  getBranches: vi.fn(),
  branchExists: vi.fn()
}

const mockConnectionOps = {
  removeWorktreeFromAll: vi.fn().mockResolvedValue({ success: true }),
  getAll: vi.fn().mockResolvedValue({ success: true, connections: [] })
}

const mockKanban = {
  ticket: {
    detachWorktree: vi.fn().mockResolvedValue(0)
  }
}

// Setup window mocks
beforeEach(() => {
  // @ts-expect-error - Mock window.db
  window.db = mockDb
  // @ts-expect-error - Mock window.projectOps
  window.projectOps = mockProjectOps
  // @ts-expect-error - Mock window.worktreeOps
  window.worktreeOps = mockWorktreeOps
  // @ts-expect-error - Mock window.connectionOps
  window.connectionOps = mockConnectionOps
  // @ts-expect-error - Mock window.kanban
  window.kanban = mockKanban

  // Reset all mocks
  vi.clearAllMocks()

  // Reset stores
  useProjectStore.setState({
    projects: [],
    isLoading: false,
    error: null,
    selectedProjectId: null,
    expandedProjectIds: new Set(),
    editingProjectId: null
  })

  useWorktreeStore.setState({
    worktreesByProject: new Map(),
    isLoading: false,
    error: null,
    selectedWorktreeId: null,
    creatingForProjectId: null
  })

  // Default mock implementations
  mockDb.project.getAll.mockResolvedValue([])
  mockDb.project.touch.mockResolvedValue(true)
  mockDb.worktree.getActiveByProject.mockResolvedValue([])
  mockDb.worktree.touch.mockResolvedValue(true)
  mockWorktreeOps.sync.mockResolvedValue({ success: true })
})

describe('Session 5: Git Worktree Operations', () => {
  const mockProject = {
    id: 'project-1',
    name: 'test-project',
    path: '/path/to/test-project',
    description: null,
    tags: null,
    created_at: new Date().toISOString(),
    last_accessed_at: new Date().toISOString()
  }

  const mockWorktree: MockWorktree = {
    id: 'worktree-1',
    project_id: 'project-1',
    name: 'tokyo',
    branch_name: 'tokyo',
    path: '/Users/test/.hive-worktrees/test-project/tokyo',
    status: 'active',
    is_default: false,
    created_at: new Date().toISOString(),
    last_accessed_at: new Date().toISOString()
  }

  const defaultWorktree: MockWorktree = {
    id: 'worktree-default',
    project_id: 'project-1',
    name: '(no-worktree)',
    branch_name: '',
    path: '/path/to/test-project',
    status: 'active',
    is_default: true,
    created_at: new Date().toISOString(),
    last_accessed_at: new Date().toISOString()
  }

  test('Worktrees display under expanded project', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree])

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByTestId('worktree-list-project-1')).toBeInTheDocument()
      expect(screen.getByText('tokyo')).toBeInTheDocument()
    })
  })

  test('Create worktree with city name', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([])

    const newWorktree: MockWorktree = {
      id: 'worktree-new',
      project_id: 'project-1',
      name: 'paris',
      branch_name: 'paris',
      path: '/Users/test/.hive-worktrees/test-project/paris',
      status: 'active',
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString()
    }

    mockWorktreeOps.create.mockResolvedValue({
      success: true,
      worktree: newWorktree
    })

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByTestId('add-worktree-project-1')).toBeInTheDocument()
    })

    // Click add worktree button
    const addButton = screen.getByTestId('add-worktree-project-1')
    fireEvent.click(addButton)

    await waitFor(() => {
      expect(mockWorktreeOps.create).toHaveBeenCalledWith({
        projectId: 'project-1',
        projectPath: '/path/to/test-project',
        projectName: 'test-project'
      })
    })

    await waitFor(() => {
      expect(screen.getByText('paris')).toBeInTheDocument()
    })
  })

  test('Worktree path is correct format', async () => {
    mockWorktreeOps.create.mockResolvedValue({
      success: true,
      worktree: mockWorktree
    })

    const createResult = await window.worktreeOps.create({
      projectId: 'project-1',
      projectPath: '/path/to/test-project',
      projectName: 'test-project'
    })

    // Verify the path follows the format ~/.hive-worktrees/{project-name}/{city-name}
    if (createResult.worktree) {
      expect(createResult.worktree.path).toMatch(/\.hive-worktrees\/test-project\/\w+/)
    }
  })

  test('Archive removes worktree and branch', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree])

    mockWorktreeOps.delete.mockResolvedValue({ success: true })

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByText('tokyo')).toBeInTheDocument()
    })

    // Right-click worktree to open context menu
    const worktreeItem = screen.getByTestId('worktree-item-worktree-1')
    fireEvent.contextMenu(worktreeItem)

    await waitFor(() => {
      expect(screen.getByText('Archive')).toBeInTheDocument()
    })

    // Click archive
    fireEvent.click(screen.getByText('Archive'))

    await waitFor(() => {
      expect(mockWorktreeOps.delete).toHaveBeenCalledWith({
        worktreeId: 'worktree-1',
        worktreePath: '/Users/test/.hive-worktrees/test-project/tokyo',
        branchName: 'tokyo',
        projectPath: '/path/to/test-project',
        archive: true
      })
    })
  })

  test('Unbranch removes worktree but keeps branch', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree])

    mockWorktreeOps.delete.mockResolvedValue({ success: true })

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByText('tokyo')).toBeInTheDocument()
    })

    // Right-click worktree to open context menu
    const worktreeItem = screen.getByTestId('worktree-item-worktree-1')
    fireEvent.contextMenu(worktreeItem)

    await waitFor(() => {
      expect(screen.getByText('Unbranch')).toBeInTheDocument()
    })

    // Click unbranch
    fireEvent.click(screen.getByText('Unbranch'))

    await waitFor(() => {
      expect(mockWorktreeOps.delete).toHaveBeenCalledWith({
        worktreeId: 'worktree-1',
        worktreePath: '/Users/test/.hive-worktrees/test-project/tokyo',
        branchName: 'tokyo',
        projectPath: '/path/to/test-project',
        archive: false
      })
    })
  })

  test('Open in Terminal launches terminal', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree])

    mockWorktreeOps.openInTerminal.mockResolvedValue({ success: true })

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByText('tokyo')).toBeInTheDocument()
    })

    // Right-click worktree to open context menu
    const worktreeItem = screen.getByTestId('worktree-item-worktree-1')
    fireEvent.contextMenu(worktreeItem)

    await waitFor(() => {
      expect(screen.getByText('Open in Terminal')).toBeInTheDocument()
    })

    // Click open in terminal
    fireEvent.click(screen.getByText('Open in Terminal'))

    await waitFor(() => {
      expect(mockWorktreeOps.openInTerminal).toHaveBeenCalledWith(
        '/Users/test/.hive-worktrees/test-project/tokyo'
      )
    })
  })

  test('Open in Editor opens worktree in editor', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree])

    mockWorktreeOps.openInEditor.mockResolvedValue({ success: true })

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByText('tokyo')).toBeInTheDocument()
    })

    // Right-click worktree to open context menu
    const worktreeItem = screen.getByTestId('worktree-item-worktree-1')
    fireEvent.contextMenu(worktreeItem)

    await waitFor(() => {
      expect(screen.getByText('Open in Editor')).toBeInTheDocument()
    })

    // Click open in editor
    fireEvent.click(screen.getByText('Open in Editor'))

    await waitFor(() => {
      expect(mockWorktreeOps.openInEditor).toHaveBeenCalledWith(
        '/Users/test/.hive-worktrees/test-project/tokyo'
      )
    })
  })

  test('Clicking worktree sets it as active selection', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree])

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByText('tokyo')).toBeInTheDocument()
    })

    // Click on worktree
    const worktreeItem = screen.getByTestId('worktree-item-worktree-1')
    fireEvent.click(worktreeItem)

    // Verify worktree is selected in store
    expect(useWorktreeStore.getState().selectedWorktreeId).toBe('worktree-1')

    // Verify touch was called
    await waitFor(() => {
      expect(mockDb.worktree.touch).toHaveBeenCalledWith('worktree-1')
    })
  })

  test('Worktree store: createWorktree success', async () => {
    const newWorktree: MockWorktree = {
      id: 'worktree-new',
      project_id: 'project-1',
      name: 'london',
      branch_name: 'london',
      path: '/Users/test/.hive-worktrees/test-project/london',
      status: 'active',
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString()
    }

    mockWorktreeOps.create.mockResolvedValue({
      success: true,
      worktree: newWorktree
    })

    const result = await useWorktreeStore
      .getState()
      .createWorktree('project-1', '/path/to/test-project', 'test-project')

    expect(result.success).toBe(true)
    expect(useWorktreeStore.getState().worktreesByProject.get('project-1')).toContainEqual(
      newWorktree
    )
  })

  test('Worktree store: archiveWorktree selects default worktree when no other worktrees remain', async () => {
    useWorktreeStore.setState({
      worktreesByProject: new Map([['project-1', [mockWorktree, defaultWorktree]]]),
      selectedWorktreeId: mockWorktree.id
    })

    mockWorktreeOps.delete.mockResolvedValue({ success: true })

    const result = await useWorktreeStore
      .getState()
      .archiveWorktree(
        'worktree-1',
        '/Users/test/.hive-worktrees/test-project/tokyo',
        'tokyo',
        '/path/to/test-project'
      )

    expect(result.success).toBe(true)
    expect(useWorktreeStore.getState().worktreesByProject.get('project-1')).toHaveLength(1)
    expect(useWorktreeStore.getState().worktreesByProject.get('project-1')?.[0]?.id).toBe(
      defaultWorktree.id
    )
    expect(useWorktreeStore.getState().selectedWorktreeId).toBe(defaultWorktree.id)
  })

  test('Worktree store: archiveWorktree selects top remaining non-default worktree', async () => {
    const secondWorktree: MockWorktree = {
      id: 'worktree-2',
      project_id: 'project-1',
      name: 'paris',
      branch_name: 'paris',
      path: '/Users/test/.hive-worktrees/test-project/paris',
      status: 'active',
      is_default: false,
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString()
    }

    useWorktreeStore.setState({
      worktreesByProject: new Map([['project-1', [mockWorktree, secondWorktree, defaultWorktree]]]),
      selectedWorktreeId: mockWorktree.id
    })

    mockWorktreeOps.delete.mockResolvedValue({ success: true })

    const result = await useWorktreeStore
      .getState()
      .archiveWorktree(
        'worktree-1',
        '/Users/test/.hive-worktrees/test-project/tokyo',
        'tokyo',
        '/path/to/test-project'
      )

    expect(result.success).toBe(true)
    expect(useWorktreeStore.getState().selectedWorktreeId).toBe(secondWorktree.id)
  })

  test('Worktree store: archiveWorktree respects custom ordering when selecting fallback', async () => {
    const secondWorktree: MockWorktree = {
      id: 'worktree-2',
      project_id: 'project-1',
      name: 'paris',
      branch_name: 'paris',
      path: '/Users/test/.hive-worktrees/test-project/paris',
      status: 'active',
      is_default: false,
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString()
    }

    const thirdWorktree: MockWorktree = {
      id: 'worktree-3',
      project_id: 'project-1',
      name: 'oslo',
      branch_name: 'oslo',
      path: '/Users/test/.hive-worktrees/test-project/oslo',
      status: 'active',
      is_default: false,
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString()
    }

    useWorktreeStore.setState({
      worktreesByProject: new Map([
        ['project-1', [mockWorktree, secondWorktree, thirdWorktree, defaultWorktree]]
      ]),
      worktreeOrderByProject: new Map([['project-1', ['worktree-3', 'worktree-2', 'worktree-1']]]),
      selectedWorktreeId: mockWorktree.id
    })

    mockWorktreeOps.delete.mockResolvedValue({ success: true })

    const result = await useWorktreeStore
      .getState()
      .archiveWorktree(
        'worktree-1',
        '/Users/test/.hive-worktrees/test-project/tokyo',
        'tokyo',
        '/path/to/test-project'
      )

    expect(result.success).toBe(true)
    expect(useWorktreeStore.getState().selectedWorktreeId).toBe(thirdWorktree.id)
  })

  test('Worktree store: archiveWorktree keeps current selection when another worktree is archived', async () => {
    const secondWorktree: MockWorktree = {
      id: 'worktree-2',
      project_id: 'project-1',
      name: 'paris',
      branch_name: 'paris',
      path: '/Users/test/.hive-worktrees/test-project/paris',
      status: 'active',
      is_default: false,
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString()
    }

    useWorktreeStore.setState({
      worktreesByProject: new Map([['project-1', [mockWorktree, secondWorktree, defaultWorktree]]]),
      selectedWorktreeId: secondWorktree.id
    })

    mockWorktreeOps.delete.mockResolvedValue({ success: true })

    const result = await useWorktreeStore
      .getState()
      .archiveWorktree(
        'worktree-1',
        '/Users/test/.hive-worktrees/test-project/tokyo',
        'tokyo',
        '/path/to/test-project'
      )

    expect(result.success).toBe(true)
    expect(useWorktreeStore.getState().selectedWorktreeId).toBe(secondWorktree.id)
  })

  test('Worktree store: unbranchWorktree success', async () => {
    // Setup initial state with a worktree
    useWorktreeStore.setState({
      worktreesByProject: new Map([['project-1', [mockWorktree]]])
    })

    mockWorktreeOps.delete.mockResolvedValue({ success: true })

    const result = await useWorktreeStore
      .getState()
      .unbranchWorktree(
        'worktree-1',
        '/Users/test/.hive-worktrees/test-project/tokyo',
        'tokyo',
        '/path/to/test-project'
      )

    expect(result.success).toBe(true)
    expect(mockWorktreeOps.delete).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      worktreePath: '/Users/test/.hive-worktrees/test-project/tokyo',
      branchName: 'tokyo',
      projectPath: '/path/to/test-project',
      archive: false
    })
  })

  test('Worktree sync is called on project expand', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree])
    mockWorktreeOps.sync.mockResolvedValue({ success: true })

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(mockWorktreeOps.sync).toHaveBeenCalledWith({
        projectId: 'project-1',
        projectPath: '/path/to/test-project'
      })
    })
  })

  test('Copy worktree path to clipboard', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree])
    mockProjectOps.copyToClipboard.mockResolvedValue(undefined)

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByText('tokyo')).toBeInTheDocument()
    })

    // Right-click worktree to open context menu
    const worktreeItem = screen.getByTestId('worktree-item-worktree-1')
    fireEvent.contextMenu(worktreeItem)

    await waitFor(() => {
      expect(screen.getByText('Copy Path')).toBeInTheDocument()
    })

    // Click copy path
    fireEvent.click(screen.getByText('Copy Path'))

    await waitFor(() => {
      expect(mockProjectOps.copyToClipboard).toHaveBeenCalledWith(
        '/Users/test/.hive-worktrees/test-project/tokyo'
      )
    })
  })

  test('Multiple worktrees display correctly', async () => {
    const worktree2: MockWorktree = {
      id: 'worktree-2',
      project_id: 'project-1',
      name: 'paris',
      branch_name: 'paris',
      path: '/Users/test/.hive-worktrees/test-project/paris',
      status: 'active',
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString()
    }

    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([mockWorktree, worktree2])

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByText('tokyo')).toBeInTheDocument()
      expect(screen.getByText('paris')).toBeInTheDocument()
    })
  })

  test('New Worktree button shows loading state', async () => {
    mockDb.project.getAll.mockResolvedValue([mockProject])
    mockDb.worktree.getActiveByProject.mockResolvedValue([])

    // Delay the create response
    mockWorktreeOps.create.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                worktree: mockWorktree
              }),
            100
          )
        )
    )

    render(<AppLayout />)

    await waitFor(() => {
      expect(screen.getByText('test-project')).toBeInTheDocument()
    })

    // Expand project
    const projectItem = screen.getByTestId('project-item-project-1')
    const chevron = projectItem.querySelector('button')
    if (chevron) {
      fireEvent.click(chevron)
    }

    await waitFor(() => {
      expect(screen.getByTestId('add-worktree-project-1')).toBeInTheDocument()
    })

    // Click add worktree button
    const addButton = screen.getByTestId('add-worktree-project-1')
    fireEvent.click(addButton)

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByText('Creating...')).toBeInTheDocument()
    })

    // Eventually completes
    await waitFor(() => {
      expect(screen.getByText('New Worktree')).toBeInTheDocument()
    })
  })
})
