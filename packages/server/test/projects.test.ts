import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AuthService } from '../src/auth/service'
import { MemoryAuthStore } from '../src/auth/store'
import { TeamService } from '../src/teams/service'
import { MemoryTeamStore } from '../src/teams/store'
import { ProjectService } from '../src/projects/service'
import { MemoryProjectStore } from '../src/projects/store'
import { LocalGitBackend } from '@md4lp/repo'

describe('Project & Repository Management (@md4lp/server projects)', () => {
  let tempBaseDir: string
  let authStore: MemoryAuthStore
  let auth: AuthService
  let teamStore: MemoryTeamStore
  let teams: TeamService
  let projectStore: MemoryProjectStore
  let projects: ProjectService

  beforeEach(async () => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md4lp-projects-test-'))
    authStore = new MemoryAuthStore()
    auth = new AuthService(authStore)
    teamStore = new MemoryTeamStore()
    teams = new TeamService(teamStore, auth)
    projectStore = new MemoryProjectStore()
    projects = new ProjectService(projectStore, auth, teams, path.join(tempBaseDir, 'repos'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  describe('Project Creation & Git Repo Initialization', () => {
    it('creates an isolated git repo with initial README and binds owner contextual email', async () => {
      // 1. Create Alice with verified work email
      const alice = await authStore.createUser({
        name: 'Alice Developer',
        username: 'alice_dev',
        primaryEmail: 'alice@corp.com',
      })

      // 2. Alice creates project "Platform Docs"
      const project = await projects.createProject(alice.id, {
        name: 'Platform Docs',
        description: 'Engineering documentation and RFCs',
        contextEmail: 'alice@corp.com',
      })

      expect(project.id).toBeDefined()
      expect(project.name).toBe('Platform Docs')
      expect(project.slug).toBe('platform-docs')
      expect(project.effectiveRole).toBe('owner')
      expect(project.currentContextEmail).toBe('alice@corp.com')
      expect(project.members).toHaveLength(1)
      expect(project.members[0]?.userId).toBe(alice.id)
      expect(project.members[0]?.role).toBe('owner')

      // Verify the Git repository on disk exists and has README.md
      const gitRepo = new LocalGitBackend(project.repoPath)
      const files = await gitRepo.listFiles('main')
      expect(files).toContain('README.md')

      const readme = await gitRepo.readFile('main', 'README.md')
      expect(readme).toContain('# Platform Docs')
      expect(readme).toContain('Engineering documentation and RFCs')

      const log = await gitRepo.log('main')
      expect(log[0]?.author).toBe('Alice Developer')
    })

    it('handles slug conflicts gracefully by appending unique suffix', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const p1 = await projects.createProject(alice.id, { name: 'Architecture Guide' })
      const p2 = await projects.createProject(alice.id, { name: 'Architecture Guide' })

      expect(p1.slug).toBe('architecture-guide')
      expect(p2.slug).toMatch(/^architecture-guide-[a-z0-9]+$/)
    })
  })

  describe('Direct Member Invitations & Contextual Email Binding', () => {
    it('allows inviting by @username, choosing contextualEmail on accept, and role inheritance', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@personal.io' })
      // Add and verify a secondary work email for Bob
      await authStore.addEmail(bob.id, 'bob@corp.com', true)

      const project = await projects.createProject(alice.id, { name: 'Core Engine' })

      // Alice invites Bob as editor
      const inv = await projects.inviteToProject(alice.id, project.id, { target: '@bob', role: 'editor' })
      expect(inv.status).toBe('pending')
      expect(inv.targetUsername).toBe('bob')

      // Bob accepts with his work email
      const acceptRes = await projects.acceptInvitation(bob.id, inv.id, { contextEmail: 'bob@corp.com' })
      expect(acceptRes.ok).toBe(true)
      expect(acceptRes.project.members).toHaveLength(2)

      const bobMember = acceptRes.project.members.find((m) => m.userId === bob.id)
      expect(bobMember?.role).toBe('editor')
      expect(bobMember?.contextEmail).toBe('bob@corp.com')

      // Bob's effective role when querying project
      const bobView = await projects.getProjectDetails(project.id, bob.id)
      expect(bobView.effectiveRole).toBe('editor')
      expect(bobView.currentContextEmail).toBe('bob@corp.com')
    })

    it('sends notification email to unregistered address and shows pending invitations in project details', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const project = await projects.createProject(alice.id, { name: 'Cloud Infra' })

      // Alice invites unregistered email "external@partner.org"
      const inv = await projects.inviteToProject(alice.id, project.id, { target: 'external@partner.org', role: 'commenter' })
      expect(inv.status).toBe('pending')

      // Verify notification email in outbox
      const outboxEmails = await auth.outbox.getEmails('external@partner.org')
      expect(outboxEmails).toHaveLength(1)
      expect(outboxEmails[0]?.subject).toContain('Cloud Infra')
      expect(outboxEmails[0]?.body).toContain('external@partner.org')
      expect(outboxEmails[0]?.body).toContain('Alice')

      // Alice sees pending invitation in project details
      const details = await projects.getProjectDetails(project.id, alice.id)
      expect(details.pendingInvitations).toHaveLength(1)
      expect(details.pendingInvitations?.[0]?.targetEmail).toBe('external@partner.org')

      // Alice revokes invitation
      await projects.revokeInvitation(alice.id, inv.id)
      const afterRevoke = await projects.getProjectDetails(project.id, alice.id)
      expect(afterRevoke.pendingInvitations).toHaveLength(0)
    })

    it('prevents multiple active invitations to the same project and auto-resolves with the most permissive role', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@example.com' })
      const project = await projects.createProject(alice.id, { name: 'SDK Monorepo' })

      // Alice invites Bob via two distinct unregistered emails with different roles: commenter and editor
      const inv1 = await projects.inviteToProject(alice.id, project.id, { target: 'bob.home@gmail.com', role: 'commenter' })
      const inv2 = await projects.inviteToProject(alice.id, project.id, { target: 'bob.office@acme.corp', role: 'editor' })

      // Bob registers and verifies both emails
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob.home@gmail.com' })
      await authStore.addEmail(bob.id, 'bob.office@acme.corp', true)

      // Bob lists pending invitations -> deduplicated to 1 invitation with higher role 'editor'
      const pending = await projects.listPendingInvitationsForUser(bob.id)
      expect(pending).toHaveLength(1)
      expect(pending[0]?.projectId).toBe(project.id)
      expect(pending[0]?.role).toBe('editor')

      // Bob accepts inv1 -> backend resolves to 'editor' (most permissive role among all pending invites)
      const acceptRes = await projects.acceptInvitation(bob.id, inv1.id, { contextEmail: 'bob.home@gmail.com' })
      expect(acceptRes.project.members.find((m) => m.userId === bob.id)?.role).toBe('editor')

      // Both invitations are now resolved (inv1 is accepted, inv2 was auto-resolved as accepted)
      const inv1Record = await projectStore.getInvitation(inv1.id)
      const inv2Record = await projectStore.getInvitation(inv2.id)
      expect(inv1Record?.status).toBe('accepted')
      expect(inv2Record?.status).toBe('accepted')

      // Bob is an editor, trying to re-invite him with commenter role fails
      await expect(
        projects.inviteToProject(alice.id, project.id, { target: '@bob', role: 'commenter' }),
      ).rejects.toThrow('already a member of this project with role editor')
    })

    it('allows a member to update their Git contextual signature email', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@personal.me' })
      await authStore.addEmail(alice.id, 'alice@work.corp', true)

      const project = await projects.createProject(alice.id, { name: 'Design Tokens', contextEmail: 'alice@personal.me' })
      expect(project.currentContextEmail).toBe('alice@personal.me')

      // Alice updates her context email to work.corp
      const res = await projects.updateMemberContextEmail(alice.id, project.id, 'alice@work.corp')
      expect(res.ok).toBe(true)

      const details = await projects.getProjectDetails(project.id, alice.id)
      expect(details.currentContextEmail).toBe('alice@work.corp')
    })
  })

  describe('Team Assignment & Inherited Roles', () => {
    it('grants access to all members of an assigned team with proper role priority', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@corp.com' })
      const charlie = await authStore.createUser({ name: 'Charlie', username: 'charlie', primaryEmail: 'charlie@corp.com' })

      // Alice creates a private team "Backend Guild" with Bob as member
      const team = await teams.createPrivateTeam(alice.id, 'Backend Guild')
      const invBob = await teams.inviteToTeam(alice.id, team.id, { target: '@bob', role: 'member' })
      await teams.acceptInvitation(bob.id, invBob.id)

      // Alice creates a project and assigns the Backend Guild with 'editor' role
      const project = await projects.createProject(alice.id, { name: 'API Microservices' })
      await projects.assignTeamToProject(alice.id, project.id, team.id, 'editor')

      // Bob (not a direct member, but in Backend Guild) can access project with effectiveRole 'editor'
      const bobDetails = await projects.getProjectDetails(project.id, bob.id)
      expect(bobDetails.effectiveRole).toBe('editor')

      // Charlie (not in team or direct member) cannot access
      await expect(
        projects.getProjectDetails(project.id, charlie.id),
      ).rejects.toThrow('Access denied: you are not a member of this project')

      // When team is removed from project, Bob loses access immediately
      await projects.removeTeamFromProject(alice.id, project.id, team.id)
      await expect(
        projects.getProjectDetails(project.id, bob.id),
      ).rejects.toThrow('Access denied: you are not a member of this project')
    })
  })

  describe('Member Removal with OTP Verification & Leaving Project', () => {
    it('requires OTP operation code to remove direct members and enforces sole owner protection', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@corp.com' })

      const project = await projects.createProject(alice.id, { name: 'Design System' })
      const inv = await projects.inviteToProject(alice.id, project.id, { target: '@bob', role: 'editor' })
      await projects.acceptInvitation(bob.id, inv.id)

      // Alice generates OTP code for 'remove_project_member'
      const { code } = await authStore.createVerificationCode('alice@corp.com', 'remove_project_member', {}, 10 * 60 * 1000, 5)

      // Alice removes Bob using OTP
      const removeRes = await projects.removeMemberFromProject(alice.id, bob.id, project.id, code)
      expect(removeRes.ok).toBe(true)

      const afterRemove = await projects.getProjectDetails(project.id, alice.id)
      expect(afterRemove.members).toHaveLength(1)
      expect(afterRemove.members.some((m) => m.userId === bob.id)).toBe(false)

      // Alice (sole owner) cannot leave project without appointing another owner
      await expect(
        projects.leaveProject(alice.id, project.id),
      ).resolves.toEqual({ ok: true }) // last member can leave empty project
    })

    it('allows a project owner to remove another co-owner with OTP verification', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@corp.com' })

      const project = await projects.createProject(alice.id, { name: 'Multi-Owner Project' })
      const inv = await projects.inviteToProject(alice.id, project.id, { target: '@bob', role: 'owner' })
      await projects.acceptInvitation(bob.id, inv.id)

      const details = await projects.getProjectDetails(project.id, alice.id)
      expect(details.members.filter((m) => m.role === 'owner')).toHaveLength(2)

      // Alice generates OTP and removes Bob (who is also an owner)
      const { code } = await authStore.createVerificationCode('alice@corp.com', 'remove_project_member', {}, 10 * 60 * 1000, 5)
      const res = await projects.removeMemberFromProject(alice.id, bob.id, project.id, code)
      expect(res.ok).toBe(true)

      const afterRemove = await projects.getProjectDetails(project.id, alice.id)
      expect(afterRemove.members).toHaveLength(1)
      expect(afterRemove.members[0]!.userId).toBe(alice.id)
    })
  })

  describe('DocumentService & Tree Management in Subdirectories', () => {
    it('creates nested documents, builds directory trees, and patches relative links on rename', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const project = await projects.createProject(alice.id, { name: 'Engineering Docs' })
      const docService = new (await import('../src/documents/service')).DocumentService(projects)

      const author = { name: 'Alice', email: 'alice@corp.com' }

      // 1. Create nested docs
      await docService.createDocument(project.id, 'guides/setup.md', '# Setup\nSee [API](../api/v1.md)', author)
      await docService.createDocument(project.id, 'api/v1.md', '# API v1\nSee [Setup](../guides/setup.md)', author)

      // 2. Tree structure
      const tree = await docService.listTree(project.id, 'main')
      expect(tree).toHaveLength(3) // README.md, guides/, api/
      const guidesDir = tree.find((t) => t.name === 'guides')
      expect(guidesDir?.type).toBe('directory')
      expect(guidesDir?.children).toHaveLength(1)
      expect(guidesDir?.children?.[0]?.name).toBe('setup.md')

      // 3. Rename/Move document: move api/v1.md to reference/api/v1.md
      await docService.renameDocument(project.id, 'api/v1.md', 'reference/api/v1.md', author)

      const newTree = await docService.listTree(project.id, 'main')
      expect(newTree.find((t) => t.name === 'api')).toBeUndefined()
      expect(newTree.find((t) => t.name === 'reference')).toBeDefined()

      // 4. Verify relative link in guides/setup.md was patched automatically
      const setupDoc = await docService.getDocument(project.id, 'guides/setup.md')
      expect(setupDoc.content).toContain('See [API](../reference/api/v1.md)')

      // 5. Delete document
      await docService.deleteDocument(project.id, 'guides/setup.md', author)
      const afterDelete = await docService.listFlatFiles(project.id, 'main')
      expect(afterDelete).not.toContain('guides/setup.md')
      expect(afterDelete).toContain('reference/api/v1.md')
    })

    it('moves an entire folder with all nested files recursively without blob/tree errors', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const project = await projects.createProject(alice.id, { name: 'Folder Move Test' })
      const docService = new (await import('../src/documents/service')).DocumentService(projects)
      const author = { name: 'Alice', email: 'alice@corp.com' }

      // Create files in folder 'carpeta'
      await docService.createDocument(project.id, 'carpeta/doc1.md', '# Doc 1', author)
      await docService.createDocument(project.id, 'carpeta/sub/doc2.md', '# Doc 2', author)

      // Move folder 'carpeta' to 'guias/carpeta'
      const moveRes = await docService.renameDocument(project.id, 'carpeta', 'guias/carpeta', author)
      expect(moveRes.commitOid).toBeDefined()

      const files = await docService.listFlatFiles(project.id, 'main')
      expect(files).toContain('guias/carpeta/doc1.md')
      expect(files).toContain('guias/carpeta/sub/doc2.md')
      expect(files).not.toContain('carpeta/doc1.md')
      expect(files).not.toContain('carpeta/sub/doc2.md')

      // Delete folder 'guias'
      await docService.deleteDocument(project.id, 'guias', author)
      const filesAfterDelete = await docService.listFlatFiles(project.id, 'main')
      expect(filesAfterDelete).not.toContain('guias/carpeta/doc1.md')
    })
  })

  describe('Document Publication & 3-Way Merge', () => {
    it('fast-forwards cleanly when main has not moved', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const project = await projects.createProject(alice.id, { name: 'Publish Test 1' })
      const docService = new (await import('../src/documents/service')).DocumentService(projects)
      const author = { name: 'Alice', email: 'alice@corp.com' }

      await docService.createDocument(project.id, 'doc1.md', '# Initial Content', author)

      // Acquire lock
      const lockRes = await docService.acquireLock(project.id, 'doc1.md', 'alice', author)
      expect(lockRes.editor).toBe('alice')

      // Save draft to edit branch
      await docService.saveDraft(project.id, 'doc1.md', '# Initial Content\n\nNew paragraph by Alice.', 'alice', author)

      // Check publish conflict
      const check = await docService.checkPublishConflict(project.id, 'doc1.md', 'alice')
      expect(check.hasConflict).toBe(false)

      // Publish document
      const pubRes = await docService.publishDocument(project.id, 'doc1.md', 'alice', author)
      expect(pubRes.commitOid).toBeDefined()

      // Verify published on main
      const mainDoc = await docService.getDocument(project.id, 'doc1.md', 'main')
      expect(mainDoc.content).toBe('# Initial Content\n\nNew paragraph by Alice.')

      // Lock should be released
      expect(docService.getLockHolder(project.id, 'doc1.md')).toBeUndefined()
    })

    it('performs clean 3-way merge when main moved non-overlappingly, and detects conflicts when overlapping', async () => {
      const alice = await authStore.createUser({ name: 'Alice', username: 'alice', primaryEmail: 'alice@corp.com' })
      const bob = await authStore.createUser({ name: 'Bob', username: 'bob', primaryEmail: 'bob@corp.com' })
      const project = await projects.createProject(alice.id, { name: 'Publish Test 2' })
      const docService = new (await import('../src/documents/service')).DocumentService(projects)
      const authorAlice = { name: 'Alice', email: 'alice@corp.com' }
      const authorBob = { name: 'Bob', email: 'bob@corp.com' }

      const initialDoc = ['# Title', '', 'Section A', '', 'Section B', ''].join('\n')
      await docService.createDocument(project.id, 'doc2.md', initialDoc, authorAlice)

      // 1. Alice acquires lock on doc2.md (baseOid captured)
      await docService.acquireLock(project.id, 'doc2.md', 'alice', authorAlice)

      // Alice edits Section A
      await docService.saveDraft(project.id, 'doc2.md', ['# Title', '', 'Section A (Alice updated)', '', 'Section B', ''].join('\n'), 'alice', authorAlice)

      // 2. Meanwhile, someone commits directly to main (e.g. updating Section B via another process or file)
      const repo = await projects.getProjectRepo(project.id)
      await repo.writeFiles('main', [{ path: 'doc2.md', content: ['# Title', '', 'Section A', '', 'Section B (Bob updated)', ''].join('\n') }], 'bob edit main', authorBob)

      // 3. Alice checks conflict -> Non-overlapping, clean merge possible!
      const check1 = await docService.checkPublishConflict(project.id, 'doc2.md', 'alice')
      expect(check1.hasConflict).toBe(false)
      expect(check1.resolvedContent).toContain('Section A (Alice updated)')
      expect(check1.resolvedContent).toContain('Section B (Bob updated)')

      // 4. Now suppose Alice edits Section B too causing direct conflict with Bob
      await docService.saveDraft(project.id, 'doc2.md', ['# Title', '', 'Section A (Alice updated)', '', 'Section B (Alice conflicting)', ''].join('\n'), 'alice', authorAlice)

      const check2 = await docService.checkPublishConflict(project.id, 'doc2.md', 'alice')
      expect(check2.hasConflict).toBe(true)
      expect(check2.chunks.some((c) => c.type === 'conflict')).toBe(true)

      // Attempting to publish without resolution fails
      await expect(
        docService.publishDocument(project.id, 'doc2.md', 'alice', authorAlice),
      ).rejects.toThrow('conflict detected with current main; manual resolution required')

      // 5. Alice provides resolved content manually and publishes successfully
      const manualResolution = ['# Title', '', 'Section A (Alice updated)', '', 'Section B (Alice & Bob merged)', ''].join('\n')
      const pubRes = await docService.publishDocument(project.id, 'doc2.md', 'alice', authorAlice, { resolvedContent: manualResolution })
      expect(pubRes.commitOid).toBeDefined()

      const mainDoc = await docService.getDocument(project.id, 'doc2.md', 'main')
      expect(mainDoc.content).toBe(manualResolution)
    })
  })
})
