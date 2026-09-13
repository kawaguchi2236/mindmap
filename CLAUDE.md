# CLAUDE.md — Web MindMap Development Guide

## 0. Purpose

This file defines the operating rules for Claude Code when developing the Web MindMap project.

The primary goal is not to maximize the amount of code produced. The goal is to implement the Phase 1 requirements correctly, incrementally, and with minimal wasted context, duplicate investigation, unnecessary file reads, and unnecessary subagent usage.

Before making changes, Claude Code MUST understand the current task, inspect only the relevant parts of the repository, create a concise implementation plan, identify dependencies, and decide whether parallel subagents will actually reduce total work.

The project requirements are authoritative. When there is a conflict between this file and the requirements specification, stop implementation of the conflicting part, explain the conflict, and prefer the explicit product requirement unless it creates a technical impossibility or data-loss risk.

---

# 1. Authoritative Documents

Read these documents only when relevant to the current task. Do not repeatedly reread the entire files.

Primary references:

- `Web_MindMap_Requirements_v1.0_MECE.md`
- `Web_MindMap_Phase1_TaskBreakdown.md`
- `Web_MindMap_Wireframes_v0.1.md`

If these documents are stored elsewhere in the repository, locate them once and reuse their paths.

Priority order:

1. Explicit instruction from the user in the current Claude Code session
2. `Web_MindMap_Requirements_v1.0_MECE.md`
3. This `CLAUDE.md`
4. `Web_MindMap_Phase1_TaskBreakdown.md`
5. `Web_MindMap_Wireframes_v0.1.md`
6. Existing implementation conventions

Do not invent new product requirements merely because they seem useful.

---

# 2. Product Mission

Build a simple, fast, intuitive Web MindMap application that allows users to organize thoughts without interrupting their thinking flow.

Phase 1 is intentionally NOT an AI-first product.

The Phase 1 product must prioritize:

1. Fast keyboard-based mind-map creation
2. Reliable local persistence
3. Offline usability
4. Cloud synchronization after login
5. Simple visual design
6. Low operating cost
7. Easy future extensibility

The core UX principle is:

> The user should be able to keep thinking without having to think about the tool.

---

# 3. Phase 1 Scope

## 3.1 Must Implement

Phase 1 includes:

- Guest usage without login
- Google authentication
- Email authentication
- Logout
- Map creation
- Map list
- Map rename
- Map deletion
- Map title search
- Infinite canvas
- Pan
- Zoom
- Recenter
- Root node
- Child node
- Sibling node
- Node editing
- Node deletion
- Copy / paste
- Dragging
- Parent-child connection lines
- Collapse / expand
- Keyboard navigation
- Undo / redo
- IndexedDB local persistence
- Autosave
- Offline editing
- Neon PostgreSQL cloud persistence
- Login-time migration of guest maps
- Online/offline synchronization
- PNG export
- Dark mode
- Basic settings
- Analytics
- Error monitoring
- Free-user advertising outside the editor

## 3.2 Must Not Implement in Phase 1

Unless explicitly requested by the user, do NOT implement:

- AI node generation
- AI chat
- AI summaries
- URL-to-map
- PDF-to-map
- YouTube-to-map
- Real-time multiplayer editing
- Team spaces
- Comments
- Role-based permissions
- PDF export
- SVG export
- Markdown export
- File attachments
- Image upload
- Audio input
- Presentation mode
- Complex version history
- Paid billing
- Pro subscription checkout

Avoid speculative scaffolding for these features unless a very small interface is necessary to prevent architectural lock-in.

---

# 4. Technical Direction

Current intended stack:

- Frontend: Next.js
- UI: React
- Language: TypeScript
- Local persistence: IndexedDB
- Cloud database: Neon PostgreSQL
- Authentication: Auth.js
- Hosting: Cloudflare
- File storage later: Cloudflare R2
- ORM/query layer: to be validated before final selection

## 4.1 Important Architecture Validation

Before implementing authentication, server-side routes, Neon connectivity, or deployment-specific behavior, validate the current supported deployment approach for the selected Next.js version on Cloudflare.

Do not assume that a deployment approach works merely because it worked in an older Next.js or Cloudflare version.

If the full application requires Cloudflare Workers/OpenNext rather than a pure static Pages deployment, document the reason and use the smallest supported architecture that satisfies the requirements.

Do not silently replace the agreed stack without documenting the architecture decision.

---

# 5. Local-First Architecture

The editor is local-first.

Expected data flow:

```text
User action
    ↓
React application state
    ↓
IndexedDB persistence
    ↓
UI considers local save successful
    ↓
If authenticated and online
    ↓
Background cloud synchronization
    ↓
Neon PostgreSQL
```

Cloud synchronization MUST NOT block normal mind-map editing.

If Neon, authentication infrastructure, or the network is temporarily unavailable, the user must still be able to edit locally.

Local data integrity takes priority over cloud freshness.

---

# 6. Data Safety Rules

Never risk user-created map data for convenience.

Claude Code MUST follow these rules:

- Never wipe IndexedDB during migrations without an explicit safe migration path.
- Never drop production tables automatically.
- Never run destructive migrations without clearly identifying the risk.
- Never overwrite a newer local map with an older server copy.
- Preserve guest maps during login.
- Prefer duplication over irreversible loss when resolving uncertain sync conflicts.
- Keep stable IDs for maps and nodes.
- Use timestamps/version metadata needed for synchronization.
- Failed cloud sync must leave local data intact.

When a destructive change is genuinely required, stop and clearly report it before execution.

---

# 7. Core Data Model

The minimum logical entities are:

## User

- `id`
- `email`
- `name`
- `created_at`
- `updated_at`

## Map

- `id`
- `user_id` nullable for local-only state
- `title`
- `created_at`
- `updated_at`
- `deleted_at` optional
- `version`

## Node

- `id`
- `map_id`
- `parent_id`
- `text`
- `x`
- `y`
- `collapsed`
- `order`
- `created_at`
- `updated_at`

## Edge

For Phase 1, prefer deriving parent-child edges from `Node.parent_id` unless the selected rendering architecture requires explicit edge records.

Do not create an unnecessary Edge persistence model solely because the UI library exposes edges.

---

# 8. Keyboard UX Is a First-Class Requirement

Keyboard behavior is a core product feature, not an enhancement.

Required shortcuts:

| Input | Behavior |
|---|---|
| Enter | Create sibling node |
| Tab | Create child node |
| Shift + Tab | Move selected node one hierarchy level upward |
| Delete / Backspace | Delete selected node when not editing text |
| Esc | Exit text edit, then clear selection |
| Cmd/Ctrl + Z | Undo |
| Cmd/Ctrl + Shift + Z | Redo |
| Cmd/Ctrl + C | Copy selected node/subtree |
| Cmd/Ctrl + V | Paste under selected node |
| Arrow keys | Navigate to nearest logical node by direction |

Rules:

- A newly created node should immediately enter text-edit mode.
- Text editing must take precedence over global shortcuts where appropriate.
- Backspace while editing text must not delete the whole node.
- Shortcuts must behave consistently on macOS and Windows.
- Do not add browser-breaking shortcuts unless the behavior is intentional and tested.
- Keyboard navigation must remain usable without a mouse.

---

# 9. Canvas UX

The canvas must support:

- Effectively infinite panning
- Smooth zooming
- Recenter-to-root
- Node selection indication
- Parent-child connections
- Dragging
- Collapse / expand

The editor must not contain advertising.

Avoid filling the editor with secondary controls. Preserve canvas space.

The primary interface should remain visually calm and easy to understand.

---

# 10. Performance Targets

Treat these as engineering targets, not reasons to prematurely optimize.

- Normal keyboard interactions: perceived response within approximately 100 ms
- Standard canvas interactions: target 60 fps
- 500 nodes: core functionality must remain usable
- 1,000 nodes: stretch target
- Initial usable state: target approximately 3 seconds on normal broadband

Before optimizing, measure.

Do not introduce complex caching, virtualization, workers, or memoization without evidence that they are needed.

---

# 11. Autosave Rules

Autosave should feel invisible.

Preferred behavior:

- Update application state immediately.
- Persist locally using a short debounce.
- Initial debounce range: approximately 300–1000 ms.
- Cloud synchronization happens independently after local persistence.
- Display clear state only when useful: `Saving`, `Saved`, `Sync failed`.

Avoid a manual Save button for normal operation.

---

# 12. Offline Behavior

When offline:

- Existing local maps must open.
- Editing must continue.
- Local saving must continue.
- Cloud synchronization must be queued or marked pending.
- The UI should indicate offline/sync-pending status without blocking interaction.

When connectivity returns:

- Retry synchronization automatically.
- Do not reload the entire application merely to synchronize.
- Do not discard unsynced local edits.

---

# 13. Sync Conflict Strategy for Phase 1

Do not build a CRDT or real-time collaborative conflict engine in Phase 1.

Use the simplest safe approach compatible with multi-device usage.

Initial direction:

- Track `updated_at` and/or monotonic `version`.
- Synchronize only authenticated maps.
- Compare local/server versions.
- Never silently destroy a newer local version.
- If the conflict cannot be resolved confidently, preserve one version as a copy and inform the user.

Before final implementation, write a small sync decision table covering:

- local only
- server only
- local newer
- server newer
- both modified
- deleted locally
- deleted remotely
- first login with guest data

Keep this decision table near the sync implementation or test suite.

---

# 14. Authentication Rules

Authentication must not be required for first use.

Guest flow:

```text
Open app
→ Create map
→ Save to IndexedDB
→ Continue without account
```

Authenticated flow:

```text
Login
→ Identify guest maps
→ Preserve local maps
→ Associate/upload maps safely
→ Enable cloud synchronization
```

Authentication should support:

- Google login
- Email login
- Logout

Prefer a low-friction email method such as magic link or equivalent passwordless flow unless implementation constraints clearly favor another method.

Do not implement custom password storage.

---

# 15. Advertising Rules

Free-user advertising is allowed only outside the active editing experience.

Allowed:

- Map list
- Settings
- Template screen

Forbidden:

- Editor canvas
- Before opening a map
- Forced startup video
- During node creation
- Modal ads interrupting keyboard input
- Ads that materially reduce the canvas workspace

Do not let ad integration determine editor architecture.

---

# 16. PNG Export

Phase 1 supports PNG only.

PNG export must include:

- Entire map, not only visible viewport
- Nodes
- Connection lines
- Current visual styling
- Background
- No clipped text

Do not add PDF/SVG export unless requested.

---

# 17. UI / Design Rules

Use the existing wireframe and requirements as the design baseline.

General rules:

- PC-first
- Clean
- Minimal
- Low visual noise
- Canvas-focused
- Clear selected/focused states
- Dark mode supported
- Accessible contrast
- Avoid excessive sidebars and floating controls

Do not redesign the product while implementing unrelated functionality.

---

# 18. State Management

Choose the simplest state solution that safely supports:

- Selected map
- Nodes
- Node hierarchy
- Canvas viewport
- Undo/redo
- Clipboard
- Local persistence state
- Sync state
- Authentication state
- Theme

Do not introduce a global state library solely by habit.

If React primitives are sufficient, use them.

If a state library materially simplifies undo/redo, editor state, or persistence, document why before adding it.

---

# 19. Dependency Policy

Before adding a dependency:

1. Check whether the functionality already exists in the project.
2. Determine whether the browser/platform already provides it.
3. Assess bundle/runtime impact.
4. Assess maintenance status.
5. Prefer mature, focused dependencies.
6. Avoid large frameworks for one small feature.

Do not install competing libraries for the same concern.

Examples of areas requiring deliberate selection:

- Canvas/mind-map rendering
- IndexedDB wrapper
- State management
- ORM
- PNG export
- Testing

For each major architectural dependency, create a short decision note in the implementation plan rather than repeatedly researching it.

---

# 20. Implementation Strategy

## 20.1 Before Coding

For every non-trivial task:

1. Read the user request.
2. Read only the relevant requirements sections.
3. Inspect only relevant files/directories.
4. Identify current implementation state.
5. Identify dependencies and risks.
6. Break work into independent and dependent tasks.
7. Decide whether subagents reduce total work.
8. Write a short execution plan.
9. Implement.
10. Test.
11. Review the diff.
12. Report what changed and what remains.

Do not start broad implementation before understanding the existing repository.

---

# 21. Subagent Strategy

Subagents are encouraged when they genuinely reduce elapsed time or context usage.

They are NOT mandatory for every task.

## 21.1 Good Uses for Parallel Subagents

Use parallel subagents for independent work such as:

- One agent inspects editor/canvas architecture.
- One agent inspects persistence/sync architecture.
- One agent inspects authentication/deployment constraints.
- One agent reviews tests or accessibility after implementation.

Parallel tasks must have minimal file overlap.

## 21.2 Bad Uses for Parallel Subagents

Do not launch multiple agents that:

- Read the same files.
- Solve the same problem.
- Edit the same modules.
- Investigate trivial questions.
- Repeat research already available in project docs.
- Produce competing implementations that must later be reconciled.

## 21.3 Default Parallelism

Default to no more than 2–3 concurrent subagents.

Use one agent for small/local tasks.

Increase parallelism only when there are clearly independent workstreams with low merge risk.

## 21.4 Parent Agent Responsibilities

The primary agent owns:

- Task decomposition
- Architecture decisions
- Assignment boundaries
- Integration
- Final testing
- Final diff review

Subagents should not independently change architecture unless explicitly assigned to evaluate it.

## 21.5 Subagent Output

Ask subagents to return concise outputs:

- Files inspected
- Key findings
- Changes made
- Tests run
- Risks/open questions

Avoid long narrative reports.

---

# 22. Credit / Context Efficiency Rules

The development process should minimize unnecessary Claude Code usage without sacrificing correctness.

Claude Code MUST:

- Inspect targeted files instead of scanning the entire repository repeatedly.
- Reuse conclusions already established in `CLAUDE.md` and requirements.
- Avoid having multiple agents perform identical research.
- Avoid reopening unchanged large files.
- Use search/grep before reading entire directories.
- Read specific ranges/functions when possible.
- Make one coherent patch rather than many tiny speculative rewrites.
- Run the narrowest relevant tests first.
- Run full tests only when appropriate.
- Avoid repeatedly explaining plans internally after the plan is already established.
- Avoid generating large temporary documents unless needed.
- Remove disposable scratch files before finishing.
- Use subagents only when their isolation saves more work than orchestration costs.
- Prefer deterministic implementation over generating several alternatives.
- Stop researching when sufficient evidence exists to implement safely.

Do NOT optimize for fewer tokens by skipping required testing, validation, or data-safety checks.

Correctness and data integrity outrank token savings.

---

# 23. Parallel Work Planning Template

For complex tasks, use a compact plan like:

```text
Goal:
Implement cloud synchronization.

Dependencies:
- Local map schema exists
- Auth identity exists

Parallel:
A. Inspect current IndexedDB repository and map schema
B. Inspect Neon/Auth deployment path
C. Draft sync test matrix

Sequential after A+B+C:
D. Implement sync service
E. Integrate with editor
F. Run conflict/offline tests
```

Only parallelize A/B/C if they do not modify the same files.

---

# 24. Implementation Ownership Boundaries

When parallel agents make code changes, assign explicit ownership.

Example:

```text
Agent A:
- src/features/editor/**
- tests/editor/**

Agent B:
- src/lib/db/**
- src/features/sync/**
- tests/sync/**

Agent C:
- read-only review of auth/deployment
```

Two agents should not edit the same file unless there is a strong reason.

If overlap is unavoidable, make one agent read-only.

---

# 25. Testing Strategy

Testing must follow the risk of the feature.

## 25.1 Unit Tests

Prioritize pure logic:

- Tree operations
- Node hierarchy changes
- Copy/paste
- Undo/redo reducers
- Sync conflict decisions
- Serialization
- Map migration

## 25.2 Integration Tests

Prioritize:

- IndexedDB save/load
- Guest-to-auth migration
- Cloud synchronization
- Offline → online recovery
- Map deletion
- Autosave

## 25.3 UI / E2E

Critical Phase 1 flows:

```text
Guest opens app
→ creates map
→ types root
→ Tab creates child
→ Enter creates sibling
→ refreshes page
→ data remains
```

```text
Guest creates maps
→ logs in
→ maps remain
→ cloud sync completes
```

```text
User edits offline
→ reconnects
→ changes sync safely
```

```text
User exports map
→ complete PNG is generated
```

Also test:

- macOS shortcuts
- Windows shortcuts
- Chrome
- Edge
- Safari

Do not rely solely on snapshot tests for interactive behavior.

---

# 26. Quality Gates Before Declaring a Task Complete

A task is not complete merely because the code compiles.

Before completion:

- Requirements satisfied
- Type checks pass
- Relevant tests pass
- No obvious console errors
- No unintended unrelated changes
- No data-loss path introduced
- Keyboard behavior verified if relevant
- Offline behavior verified if relevant
- Accessibility/focus behavior checked if relevant
- Diff reviewed
- Temporary files removed
- New dependency justified
- Documentation updated only if necessary

---

# 27. Git Rules

Use git as a progress and recovery mechanism.

Preferred behavior:

- Keep changes scoped to the current task.
- Do not rewrite unrelated code.
- Do not force push.
- Do not delete branches.
- Do not amend or squash user commits unless explicitly asked.
- Do not commit secrets.
- Do not revert user changes merely to simplify implementation.

Before broad refactors, inspect current git status.

If working tree contains user changes, preserve them.

---

# 28. Refactoring Rules

Refactor only when one of the following is true:

- Required for the current feature
- Required to fix a defect
- Required to remove clear duplication affecting the feature
- Required to make the code testable
- Required to address a performance/data-safety problem

Do not perform broad cosmetic refactors during feature work.

---

# 29. Error Handling

Errors should be understandable and recoverable.

Critical rules:

- Sync error → continue local editing
- DB unavailable → continue local editing
- Auth error → show retry/login route
- Export error → permit retry
- IndexedDB error → surface clearly because local data may be at risk

Avoid silent failures.

Do not expose raw stack traces to end users.

Log enough context for diagnosis without logging sensitive content unnecessarily.

---

# 30. Security Rules

At minimum:

- HTTPS in production
- No custom password storage
- User-owned cloud maps must be isolated
- Validate/sanitize user content where required
- Prevent XSS from node text
- Secrets only in environment variables
- Do not expose Neon credentials to the client
- Minimize collected personal data
- Avoid logging tokens or authentication secrets

---

# 31. Analytics Rules

Phase 1 should capture only useful product events.

Minimum events:

- app_started
- map_created
- map_opened
- map_edited
- node_created
- png_exported
- login_completed
- sync_completed
- sync_failed

Avoid emitting events for every keystroke.

Do not send private node text as analytics payload.

---

# 32. Architecture Decision Gates

The following decisions must be validated before full implementation.

## ADR-001 Cloudflare + Next.js runtime

Confirm current recommended runtime/deployment method.

Acceptance criteria:

- Supports required Next.js functionality
- Supports Auth.js flow
- Supports Neon access
- Works with chosen DB/query library
- Maintains low/free initial hosting cost

## ADR-002 ORM / Query Layer

Evaluate only the leading practical options.

Decision criteria:

- Cloudflare runtime compatibility
- Neon compatibility
- Migration workflow
- Type safety
- Bundle/runtime overhead
- Maintenance burden

Do not research five or more alternatives unless the first candidates fail requirements.

## ADR-003 Mind-map Rendering

Decision criteria:

- Keyboard control
- Custom node rendering
- Smooth pan/zoom
- 500-node usability
- Edge rendering
- Dragging
- PNG export feasibility
- Bundle size
- License

Prefer adapting a mature library over building an entire graph/canvas engine from scratch unless library constraints conflict with core UX.

## ADR-004 IndexedDB Layer

Decision criteria:

- Reliability
- Schema migration support
- Transaction support
- Small API surface
- TypeScript usability

## ADR-005 Sync Conflict Handling

Write tests/decision table before implementing synchronization.

---

# 33. Suggested Phase 1 Implementation Order

Do not build every layer simultaneously.

Recommended order:

### Stage 1 — Foundation
- Initialize application
- TypeScript/tooling
- Base layout
- Routing
- Basic theme
- Validate Cloudflare deployment

### Stage 2 — Local Mind Map Core
- Map data structures
- Canvas
- Root node
- Child/sibling nodes
- Connections
- Selection
- Keyboard shortcuts
- Dragging
- Undo/redo

### Stage 3 — Local Persistence
- IndexedDB
- Autosave
- Reload recovery
- Offline behavior

At this point the app should already be personally usable.

### Stage 4 — Map Management
- Map list
- Rename
- Delete
- Search
- Settings

### Stage 5 — Authentication
- Google
- Email
- Logout
- Guest migration

### Stage 6 — Cloud Sync
- Neon schema
- Server persistence
- Sync state machine
- Conflict handling
- Offline/online recovery

### Stage 7 — Export / Advertising
- PNG export
- Ad placements outside editor

### Stage 8 — Quality
- Performance validation
- Accessibility
- Browser testing
- Error monitoring
- Analytics
- Production release

Do not implement cloud synchronization before the local editor and IndexedDB model are stable.

---

# 34. Completion Criteria for Phase 1

Phase 1 is complete only when all core flows work.

Required:

- Guest can start immediately
- New map can be created
- Enter creates sibling
- Tab creates child
- Shift+Tab works
- Node text can be edited
- Node can be deleted
- Undo/redo works
- Copy/paste works
- Pan/zoom works
- Data survives reload
- Offline editing works
- Google login works
- Email login works
- Guest maps survive login
- Neon synchronization works
- Offline edits synchronize after reconnect
- PNG export works
- Editor contains no ads
- Production deployment works
- Critical errors are observable
- Basic analytics works
- Chrome/Edge/Safari verified
- 500-node map remains usable

---

# 35. Session Start Protocol

At the start of a development request, Claude Code should follow this process:

```text
1. Identify the requested task.
2. Locate relevant requirements.
3. Inspect current git status.
4. Inspect only relevant project files.
5. State the implementation plan briefly.
6. Identify independent workstreams.
7. Spawn subagents only where worthwhile.
8. Implement dependent core work centrally.
9. Integrate subagent outputs.
10. Run focused tests.
11. Run broader validation if risk warrants it.
12. Review diff.
13. Report completion, tests, and remaining issues.
```

For simple tasks, skip unnecessary orchestration and implement directly.

---

# 36. Session End Report

When finishing a task, keep the report concise.

Use:

```text
Completed:
- ...

Tests:
- ...

Not completed / follow-up:
- ...

Important decision:
- ...
```

Do not produce a long retrospective unless requested.

---

# 37. Rules Against Overengineering

Do not:

- Build a generic diagram platform
- Build a whiteboard suite
- Build collaborative CRDT infrastructure
- Build a custom design system from scratch if simple components suffice
- Add AI infrastructure in Phase 1
- Add billing infrastructure in Phase 1
- Add file storage until needed
- Add microservices
- Add queues unless synchronization requires them
- Add Redux/Zustand/other state libraries without need
- Add Prisma/Drizzle/etc. before validating runtime compatibility
- Create abstractions for hypothetical Phase 4 features

The smallest correct implementation wins.

---

# 38. Rules Against Underengineering

Cost optimization must not create fragile software.

Do not:

- Store critical state only in React memory
- Skip IndexedDB migrations
- Ignore failed writes
- Disable TypeScript safety to move faster
- Use `any` broadly
- Depend on manual saving
- Store database secrets client-side
- Skip tests around sync
- Resolve conflicts by blindly overwriting
- Couple canvas rendering directly to cloud persistence

---

# 39. Definition of "Efficient Claude Code Usage"

Efficient usage means:

- fewer duplicate reads,
- fewer duplicate agents,
- fewer unnecessary alternatives,
- smaller targeted context,
- clear ownership,
- early validation of risky decisions,
- narrow tests first,
- central integration,
- and no unnecessary rework.

It does NOT mean rushing or skipping correctness checks.

---

# 40. Final Development Principle

When uncertain, optimize decisions in this order:

1. Do not lose the user's data.
2. Do not interrupt the user's thinking flow.
3. Keep keyboard interactions fast and intuitive.
4. Keep the implementation simple.
5. Keep initial operating costs low.
6. Preserve future extensibility without building future features now.
7. Minimize unnecessary Claude Code context and subagent usage.
