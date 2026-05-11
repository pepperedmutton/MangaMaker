# MangaMaker SysML v2 Integration Plan

Status: planning
Branch: `codex/sysml-v2-integration`
Decision: use the official SysML v2 Pilot Implementation as the backend parser and validator.

## 1. Objective

MangaMaker will treat a manga project as an engineered product described by a standards-based SysML v2 model.

The goal is not a SysML-inspired Markdown layer. The goal is a SysML v2 based model layer whose syntax and semantic validation are delegated to the official SysML v2 Pilot Implementation. MangaMaker will add a manga domain library, project-object synchronization, verification workflows, and an Agent harness that operates against the SysML model as the durable engineering source of truth.

Primary references:

- OMG SysML v2: https://www.omg.org/sysml/sysmlv2/
- SysML v2 Release repository: https://github.com/Systems-Modeling/SysML-v2-Release
- SysML v2 Pilot Implementation: https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation

## 2. Scope

In scope:

- Integrate the official Pilot Implementation as a backend validation service.
- Store project-level SysML v2 textual models inside each MangaMaker project.
- Define a MangaMaker SysML v2 domain library for comic products, pages, panels, text, bubbles, images, characters, scenes, requirements, constraints, verification cases, and trace links.
- Add API endpoints and local desktop commands for SysML model validation, querying, patching, and synchronization.
- Add a SysML/MBSE workspace in the frontend.
- Refactor the built-in Agent so durable project reasoning and document output are grounded in SysML v2 model operations.
- Preserve existing comic editor core interactions, command registry, undo/redo, and Playwright test structure.

Out of scope for the first implementation phase:

- Reimplementing the SysML v2 grammar in TypeScript.
- Forking or modifying the official Pilot Implementation grammar as MangaMaker's source of truth.
- Replacing the comic canvas with a general-purpose SysML diagram editor.
- Making Markdown metadocs the engineering source of truth after SysML is enabled.

## 3. Conformance Strategy

MangaMaker will not claim SysML v2 conformance by local handwritten validation rules.

Conformance will be based on:

- A pinned official SysML v2 Release version.
- A pinned official Pilot Implementation version.
- Standard libraries loaded from the SysML v2 Release artifact.
- Validation through the Pilot Implementation command-line or service wrapper.
- Version metadata recorded per MangaMaker project.

Planned project metadata:

```json
{
  "sysml": {
    "enabled": true,
    "standard": "SysML v2",
    "pilotImplementationVersion": "pinned-release",
    "standardLibraryVersion": "pinned-release",
    "modelRoot": "sysml/model.sysml",
    "lastValidatedAt": "ISO-8601",
    "lastValidationStatus": "valid"
  }
}
```

## 4. Repository Layout

Runtime project layout:

```text
projects/<project-id>/
  project.json
  docs/
  sysml/
    sysml-project.json
    libraries/
      manga-domain.sysml
    model.sysml
    requirements.sysml
    architecture.sysml
    behavior.sysml
    verification.sysml
    traceability.sysml
    generated/
      comic-snapshot.sysml
      validation-report.json
      trace-matrix.json
```

Repository implementation layout:

```text
src/sysml/
  config.ts
  pilotAdapter.ts
  repository.ts
  modelFiles.ts
  diagnostics.ts
  mangaDomain.ts
  mapping.ts
  syncComicToSysml.ts
  syncSysmlToComic.ts
  validation.ts
  traceability.ts
  agentTools.ts
  types.ts

scripts/
  setupSysmlPilot.mjs
  validateSysmlModel.mjs

tests/sysml/
  fixtures/
    valid-basic-manga.sysml
    invalid-basic-manga.sysml
  sysmlValidation.test.ts
  sysmlMapping.test.ts
```

Large downloaded Pilot Implementation binaries must not be committed. They should live under an ignored cache such as `.mangamaker_runtime/sysml-v2/` or be supplied by an environment variable.

## 5. Backend Architecture

### 5.1 Pilot Adapter

Add `src/sysml/pilotAdapter.ts`.

Responsibilities:

- Resolve the Pilot Implementation executable or JAR.
- Resolve the SysML standard library path.
- Spawn validation commands with explicit timeouts.
- Capture stdout, stderr, exit code, duration, and normalized diagnostics.
- Never pass secrets to the Pilot process.
- Cache successful validation results by content hash and Pilot version.

Configuration:

```text
MANGAMAKER_SYSML_ENABLED=1
MANGAMAKER_SYSML_PILOT_JAR=<path>
MANGAMAKER_SYSML_LIBRARY_DIR=<path>
MANGAMAKER_SYSML_TIMEOUT_MS=30000
```

Expected adapter API:

```ts
type SysmlValidationRequest = {
  projectId: string;
  files: Array<{ path: string; content: string }>;
  entrypoint: string;
};

type SysmlValidationResult = {
  ok: boolean;
  diagnostics: SysmlDiagnostic[];
  normalizedModelHash: string;
  pilotVersion: string;
  durationMs: number;
};
```

### 5.2 SysML Repository

Add `src/sysml/repository.ts`.

Responsibilities:

- Create default SysML project files for new and migrated MangaMaker projects.
- Read and write SysML model files atomically.
- Preserve user-authored SysML files.
- Track operation ids for idempotent Agent writes.
- Keep validation reports next to the model.
- Expose stable file paths for debugging and external agents.

### 5.3 HTTP and Tauri API

Web/dev endpoints:

```text
GET  /__mangamaker__/sysml/config
GET  /__mangamaker__/sysml/files?projectId=...
GET  /__mangamaker__/sysml/file?projectId=...&path=...
POST /__mangamaker__/sysml/file
POST /__mangamaker__/sysml/validate
POST /__mangamaker__/sysml/query
POST /__mangamaker__/sysml/apply-patch
POST /__mangamaker__/sysml/sync/comic-to-sysml
POST /__mangamaker__/sysml/sync/sysml-to-comic
GET  /__mangamaker__/sysml/traceability?projectId=...
```

Desktop/Tauri commands:

```rust
get_sysml_config
list_sysml_files
read_sysml_file
write_sysml_file
validate_sysml_project
query_sysml_project
apply_sysml_patch
sync_comic_to_sysml
sync_sysml_to_comic
```

The desktop build must not keep web-only SysML fetch behavior that fails in production.

## 6. Manga Domain Model

Define a MangaMaker domain library in SysML v2 textual notation.

Conceptual packages:

```text
package MangaMaker {
  package Domain;
  package Requirements;
  package Structure;
  package Behavior;
  package Verification;
  package Traceability;
}
```

Core domain elements:

- `ComicProduct`
- `Volume`
- `Chapter`
- `Page`
- `Panel`
- `TextElement`
- `SpeechBubble`
- `ImageElement`
- `ImageAsset`
- `Character`
- `Scene`
- `StyleGuide`
- `ContinuityRule`
- `ReadabilityRequirement`
- `StoryRequirement`
- `VisualRequirement`
- `VerificationCase`

Mapping examples:

```text
MangaMaker page -> SysML part usage of Page
Panel object -> SysML part usage of Panel
Text object -> SysML part usage of TextElement
Bubble object -> SysML part usage of SpeechBubble
Image element -> SysML part usage of ImageElement
Image asset -> SysML item/part usage of ImageAsset
Project document -> SysML documentation/comment/view artifact
Agent role -> SysML concern/viewpoint plus assigned model package
```

The exact textual syntax must be validated against the Pilot Implementation before being checked in as fixtures.

## 7. Project Object Identity

Every MangaMaker object that participates in engineering traceability needs a stable SysML element id or qualified name.

Planned additions:

```ts
type SysmlBinding = {
  elementId?: string;
  qualifiedName?: string;
  packagePath?: string;
  lastSyncedAt?: string;
};
```

Candidate project object fields:

- `project.sysml`
- `page.sysml`
- `panel.sysml`
- `text.sysml`
- `bubble.sysml`
- `imageElement.sysml`
- `asset.sysml`

Rules:

- Existing editor ids remain authoritative for editor operations.
- SysML ids are stable engineering ids.
- A broken binding is a validation warning, not a reason to corrupt the comic project.
- Sync operations must produce a redacted diff before applying mutations.

## 8. Frontend Workspace

Add a SysML workspace mode beside `Comic` and `Docs`.

Primary UI surfaces:

- SysML file list.
- Textual model viewer/editor.
- Validation diagnostics panel.
- Traceability matrix.
- Requirement coverage view.
- Page verification status view.
- Element inspector showing selected comic object and bound SysML element.

Interaction rules:

- Comic editing remains unchanged.
- SysML editing is explicit; validation status is visible.
- Invalid SysML cannot be silently treated as a valid engineering baseline.
- The left overview remains page-thumbnail-only unless a future design explicitly adds a separate SysML navigator.

## 9. Agent Re-Architecture

The Agent must become SysML-first when SysML is enabled.

### 9.1 Agent Source of Truth

Current durable source:

- Markdown metadocs and project docs.

Target durable source:

- SysML v2 model is the engineering source of truth.
- Markdown remains a readable report, draft, or generated view.
- Chat remains non-authoritative conversation context.

### 9.2 Agent Initial Context

Initial context should include:

- Project summary.
- Current page marker.
- SysML model status.
- SysML file index.
- Active role/viewpoint binding.
- Current selection SysML binding if available.
- Available SysML tools.

Initial context must not include:

- The full SysML model.
- All page resources.
- All Markdown documents.
- All screenshots.

The Agent should search/query/read only what the task requires.

### 9.3 New Agent Tools

Add SysML tools to the harness:

```text
getSysmlStatus
listSysmlFiles
readSysmlFile
searchSysmlModel
querySysmlElements
validateSysmlModel
proposeSysmlPatch
applySysmlPatch
syncComicToSysml
syncSysmlToComic
traceComicObject
verifyPageAgainstRequirements
verifyProjectAgainstRequirements
generateSysmlVerificationReport
renderPageWithSysmlTrace
```

Tool policy:

- SysML read/query tools are evidence gathering.
- `applySysmlPatch` is the durable SysML mutation path.
- Canvas/editor changes still go through `pendingCommandPlan`.
- Markdown writes are reports/views unless explicitly marked as non-SysML project documentation.
- A task that changes engineering intent must update SysML first, validate, then update derived Markdown or comic objects.

### 9.4 Agent Response Protocol

Extend the model response schema:

```ts
type AgentResponse = {
  message: string;
  requestedToolCalls?: AgentToolCallRequest[];
  pendingSysmlPatch?: {
    summary: string;
    files: Array<{ path: string; beforeHash?: string; content: string }>;
    requiresConfirmation: boolean;
  } | null;
  pendingCommandPlan?: AgentCommandPlan | null;
};
```

Execution order:

1. Validate response JSON.
2. Validate requested tool inputs.
3. If `pendingSysmlPatch` exists, validate patch with Pilot Implementation.
4. If patch is valid and does not require confirmation, apply it atomically.
5. If patch requires confirmation, show diff and wait.
6. If command plan exists, validate through command manifest as today.
7. Sync comic changes and SysML changes only through explicit tools.

The Agent may not claim a SysML update is complete unless `applySysmlPatch` succeeded and `validateSysmlModel` passed after the write.

### 9.5 Role System Under SysML

Current roles:

- Assistant
- Producer
- Director
- Storyboard Designer
- Script Designer
- Art Supervisor
- Continuity Supervisor
- Prompt Engineer
- User-defined roles

Target:

- Each role maps to a SysML viewpoint/concern and default package.
- Each role may still have a Markdown-readable metadoc, but the role definition and durable output should be represented in SysML.
- Deleting a Markdown metadoc must not delete SysML role/viewpoint data without explicit confirmation.

Example mapping:

```text
Producer -> package MangaMaker::ProjectManagement
Director -> package MangaMaker::StoryArchitecture
Storyboard Designer -> package MangaMaker::Structure
Script Designer -> package MangaMaker::TextAndDialogue
Art Supervisor -> package MangaMaker::VisualStyle
Continuity Supervisor -> package MangaMaker::Verification
Prompt Engineer -> package MangaMaker::GenerationPrompts
```

### 9.6 Agent Run Steps

Extend persisted `agentRun` steps:

```text
sysml_query
sysml_validate
sysml_patch
sysml_sync
sysml_verification
```

The run trace should include:

- SysML files read.
- SysML validation request id.
- Pilot Implementation version.
- Diagnostics summary.
- Patch hashes.
- Sync diff summary.

## 10. Synchronization Rules

### 10.1 Comic to SysML

Use `syncComicToSysml` when:

- A project is migrated.
- The creator wants the current comic state captured as engineering baseline.
- A canvas command plan has executed and affected SysML-bound objects.

The sync must:

- Preserve hand-authored SysML requirements and verification cases.
- Update generated structural model files.
- Record changed page/object ids.
- Run validation after writing.

### 10.2 SysML to Comic

Use `syncSysmlToComic` only for bounded, explicit changes:

- Add page shell.
- Rename page.
- Add placeholder panel.
- Add placeholder text/bubble.
- Update binding metadata.

It must not silently rewrite the whole comic project.

### 10.3 Conflict Policy

Conflict examples:

- Comic object deleted but SysML still references it.
- SysML element deleted but comic object still binds to it.
- Requirement references missing page.
- Agent patch changes a SysML file whose hash has changed since read.

Resolution:

- Show conflict diagnostics.
- Do not auto-merge destructive conflicts.
- Require explicit creator confirmation.

## 11. Migration Plan

### Phase 0: Branch and Spike

- Create branch `codex/sysml-v2-integration`.
- Pin official Pilot Implementation acquisition path.
- Add setup script placeholder.
- Add this implementation plan.

### Phase 1: Validator Adapter

- Add `scripts/setupSysmlPilot.mjs`.
- Add `src/sysml/pilotAdapter.ts`.
- Add `pnpm sysml:validate`.
- Add fixtures for a minimal valid and invalid SysML model.
- Add tests that prove validation goes through the Pilot Implementation.

Acceptance:

- A valid fixture passes.
- An invalid fixture fails with normalized diagnostics.
- Missing Pilot configuration returns an actionable error.

### Phase 2: Project SysML Repository

- Create project `sysml/` folder on demand.
- Add default model files.
- Add atomic read/write APIs.
- Add file hash and operation id tracking.

Acceptance:

- New project can initialize SysML files.
- Existing project can be migrated without destroying `project.json` or `docs/`.
- SysML file writes are idempotent and conflict-aware.

### Phase 3: Manga Domain Library

- Draft `manga-domain.sysml`.
- Validate it with the Pilot Implementation.
- Add generated baseline for existing page/panel/text/bubble/image state.

Acceptance:

- A MangaMaker project with pages validates as SysML.
- Page, panel, text, bubble, and asset bindings are represented.

### Phase 4: Backend APIs and Tauri Commands

- Add web endpoints.
- Add Tauri commands.
- Make desktop production use native commands.
- Ensure no web-only fetch is left for SysML in production.

Acceptance:

- Web dev and Tauri production can validate the same model.
- API never returns secrets or unbounded binary data.

### Phase 5: Frontend SysML Workspace

- Add `SysML` center workspace mode.
- Add file list, read-only viewer, editor, validation diagnostics, traceability view.
- Add selected object binding view.

Acceptance:

- User can open SysML files.
- User can validate the model.
- Diagnostics are clickable or at least path/line based.

### Phase 6: Agent Harness Conversion

- Add SysML tools.
- Update Agent system prompt to SysML-first operation.
- Extend response schema with `pendingSysmlPatch`.
- Require Pilot validation before SysML patch application.
- Make SysML trace and validation status visible in `agentRun`.

Acceptance:

- Agent can answer by querying SysML.
- Agent can propose a SysML patch.
- Agent cannot report SysML mutation success without validated application.
- Agent can validate a page against SysML requirements.

### Phase 7: Comic/SysML Synchronization

- Implement `syncComicToSysml`.
- Implement limited `syncSysmlToComic`.
- Add redacted diffs for all sync operations.
- Add undo/redo strategy for comic-side mutations triggered by SysML sync.

Acceptance:

- Comic edits can update generated SysML structure.
- SysML-driven bounded edits can update comic objects through command plans.
- Empty diffs are reported as no-change, not success.

### Phase 8: Verification and Reports

- Add verification case model patterns.
- Add page verification reports.
- Add trace matrix export.
- Add Markdown report generation as derived output.

Acceptance:

- Every page can show requirement coverage.
- Missing coverage is reported.
- Verification reports cite SysML elements and comic object ids.

### Phase 9: CI and Release Hardening

- Add CI-safe SysML validation mode.
- Cache Pilot downloads.
- Add timeout and memory limits.
- Add docs for local setup, Render deployment, and desktop production.

Acceptance:

- Test suite can run without external network if Pilot artifact is cached.
- Render deployment documents how Pilot artifact is provided.
- Desktop production documents how Java/Pilot is bundled or configured.

## 12. Testing Requirements

Unit tests:

- SysML config parsing.
- Pilot adapter command construction.
- Diagnostic normalization.
- SysML repository atomic writes.
- Manga object to SysML mapping.
- SysML patch conflict detection.
- Agent response schema for `pendingSysmlPatch`.

Integration tests:

- Valid fixture through Pilot Implementation.
- Invalid fixture through Pilot Implementation.
- Project migration creates valid SysML.
- Comic object deletion produces trace diagnostic.
- SysML patch validates before write.

E2E tests:

- Open SysML workspace.
- Validate current project.
- See validation diagnostics.
- Agent queries SysML instead of reading all Markdown.
- Agent proposes SysML patch and waits for confirmation when required.
- Confirmed SysML patch applies and revalidates.
- Agent verifies a page against requirements.

Manual tests:

- Desktop production SysML config.
- Render deployment with Pilot artifact configured.
- Large project validation timeout behavior.

## 13. Deployment Requirements

Local dev:

- `MANGAMAKER_SYSML_ENABLED=1`
- `MANGAMAKER_SYSML_PILOT_JAR=...`
- `MANGAMAKER_SYSML_LIBRARY_DIR=...`

Render:

- Store Pilot artifact in persistent disk or build cache.
- Configure environment variables in Render dashboard.
- Do not commit Pilot binaries if they are large or generated.
- Do not expose file-system paths that include secrets.

Desktop:

- Prefer bundled runtime if licensing and size are acceptable.
- Otherwise expose a clear configuration screen for Pilot path and Java availability.
- If unavailable, SysML workspace should be read-only/unavailable with a clear reason.

## 14. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Pilot Implementation CLI/API changes | Validation breaks | Pin version and add adapter tests |
| Java runtime unavailable | SysML disabled | Detect and show actionable config |
| Validation slow on large projects | Poor UX | Hash cache, per-file validation, async runs |
| SysML syntax learning curve | Creator friction | Provide generated templates and Agent assistance |
| Agent writes invalid SysML | Corrupt engineering model | Validate before apply, atomic writes, rollback |
| SysML/comic sync conflicts | Project inconsistency | Explicit conflict reports and confirmation |
| Markdown/source-of-truth confusion | Wrong durable state | Make SysML authoritative when enabled |

## 15. Product Rule Changes

When SysML is enabled:

- The SysML model is the durable engineering source of truth.
- Markdown docs are views, reports, notes, or role-facing summaries unless explicitly marked otherwise.
- The Agent must query and mutate SysML for engineering intent.
- Canvas changes must remain bounded command plans.
- SysML validation status must be visible before the Agent claims a model change is complete.
- A manga page is considered engineering-complete only when its SysML requirements, comic objects, and verification results are consistent.

## 16. Open Decisions

1. Whether to bundle the Pilot Implementation with desktop builds or require external configuration.
2. Whether Render should download Pilot artifacts at build time or use persistent disk.
3. How much SysML graphical visualization is required in the first version.
4. Whether Markdown metadocs should become generated views or remain editable documents with SysML links.
5. Whether SysML patch confirmation should be separate from command-plan confirmation or share one approval UI.

## 17. Immediate Next Tasks

1. Add `scripts/setupSysmlPilot.mjs`.
2. Add `.gitignore` entries for local Pilot artifacts.
3. Implement `src/sysml/config.ts`.
4. Implement `src/sysml/pilotAdapter.ts`.
5. Add minimal valid/invalid SysML fixtures.
6. Add `pnpm sysml:validate`.
7. Add first integration test that invokes the Pilot Implementation when configured and skips with a clear reason otherwise.
