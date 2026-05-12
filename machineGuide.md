# machineGuide

This file defines how an agent, script, or automated coding workflow must operate on MangaMaker.

本文档定义 agent、脚本和自动化工作流必须如何操作 MangaMaker。

## 1. Authority / 约束优先级
Read order:

阅读顺序：

1. `README.md`
2. `操作指南.md`
3. `machineGuide.md`
4. `testGuide.md`

Required rule:

必需规则：

- Do not implement behavior that contradicts these files.
- If behavior changes, update the documents first or in the same change.
- `README.md` remains the highest-priority product contract.

- 不要实现与这四份文件冲突的行为。
- 如果行为发生变化，必须先更新文档，或在同一次改动中同步更新。
- `README.md` 仍然是最高优先级的产品契约。

## 2. Required Agent Workflow / 必需 Agent 工作流
For any meaningful change, an agent must:

对于任何有意义的改动，agent 必须：

1. Read the four governing documents.
2. Inspect the current implementation before making assumptions.
3. Update the shared command/domain/persistence layer first when behavior changes.
4. Update UI and automation paths so they stay aligned.
5. Add or repair tests for every claimed behavior change.
6. Run validation commands when possible.
7. Report any remaining spec gap explicitly.

1. 阅读四份根文档。
2. 在做假设前先检查当前实现。
3. 行为变化时，优先更新共享命令层、领域层和持久化层。
4. 同步更新 UI 与自动化路径，保持一致。
5. 为每个声称改变的行为补充或修复测试。
6. 在可能时执行验证命令。
7. 明确报告剩余的规格缺口。

## 3. Required System Surfaces / 必需系统层面
An agent must treat these surfaces as one system:

agent 必须把以下层面视为一个系统：

- `src/domain`: schema, defaults, and pure helpers
- `src/commands`: public command surface
- `src/state`: session state and history behavior
- `src/storage`: persistence, `projects/` integration, and local draft behavior
- `src/agent`: built-in creator assistance Agent config, harness, tools, roles, documents, and response validation
- `src/sysml`: official SysML v2 Pilot adapter, project SysML repository, MBSE model defaults, and validation types
- `src/ui`: human-facing behavior
- `src/automation/api.ts`: browser automation bridge
- `vite.config.ts`: web persistence middleware, `/projects` serving, and allowed share hosts
- `scripts/launch.mjs`: web launcher, share-mode defaults, and terminal logging
- `scripts/gradio_share_tunnel.py`: Gradio tunnel integration and retry behavior
- `src-tauri/src/lib.rs`: desktop persistence bridge
- `tests/commands`: command truth tests
- `tests/e2e`: GUI and user-path truth tests

- `src/domain`：schema、默认值和纯辅助逻辑
- `src/commands`：公开命令层
- `src/state`：会话状态与历史行为
- `src/storage`：持久化、`projects/` 集成与本地草稿逻辑
- `src/ui`：面向用户的行为
- `src/automation/api.ts`：浏览器自动化桥接
- `vite.config.ts` 与 `vite.config.js`：网页版持久化中间件、`/projects` 文件服务和分享主机白名单
- `scripts/launch.mjs`：网页版启动器、默认分享模式和终端输出
- `scripts/gradio_share_tunnel.py`：Gradio 隧道与重试逻辑
- `src-tauri/src/lib.rs`：桌面版持久化桥接
- `tests/commands`：命令层真值测试
- `tests/e2e`：GUI 与用户路径真值测试

No important feature should exist in only one layer.

重要功能不能只存在于其中某一个层面。

## 4. Command Parity Rule / 命令对齐规则
Every important GUI action must map to command-backed behavior.

每一个重要 GUI 行为都必须映射到命令驱动的行为。

Required examples:

必需示例：

- `createProject`, including project type selection
- `setProjectType`
- `renameProject`
- page add, duplicate, delete, reorder, and selection
- Home navigation, stored project listing/deletion/duplication, dirty save-on-leave, and manual save
- page background color change
- panel create, move, resize, delete, polygon conversion, and vertex editing
- panel image placement and selection-driven crop editing
- panel description metadata editing
- layer up/down movement for panels, text, and bubbles
- text create, move, resize, delete, direction, font, and alignment changes
- bubble create, move, resize, delete, type changes, style changes, tail tip changes, tail-base changes, and type-specific parameter changes
- clipboard copy/paste for page, panel, text, and bubble payloads
- image paste targeting behavior for `manga`
- image paste full-stage behavior for `cg`
- export, undo/redo, locale switch, clipboard envelope creation, and close/hide save preservation

- `createProject`，包括项目类型选择
- `setProjectType`
- `renameProject`
- 页面新增、复制、删除、重排和切换
- Home 返回、已保存项目列表/删除/复制、离开项目前保存脏项目，以及手动保存
- 页面背景色修改
- 分镜创建、移动、缩放、删除、多边形转换和顶点编辑
- 分镜图片放置与选中驱动的裁切编辑
- 分镜描述元数据编辑
- 分镜、文字和气泡的图层上移/下移
- 文字的创建、移动、缩放、删除、方向、字体和对齐修改
- 气泡的创建、移动、缩放、删除、类型切换、样式修改、尾尖修改、尾根修改和类型专属参数修改
- 页面、分镜、文字和气泡的复制粘贴
- `manga` 模式下的图片粘贴目标优先级
- `cg` 模式下的全 stage 图片粘贴行为
- 导出、撤销/重做、语言切换、剪贴板 envelope 创建，以及关闭/隐藏页面时保存

## 5. Machine Control Paths / 机器控制路径
Preferred command path inside a running app:

运行中应用内的首选命令路径：

```ts
window.mangaMaker?.commands.execute(commandId, payload)
```

Read project and session state through:

读取项目与会话状态：

```ts
window.mangaMaker?.project.get()
window.mangaMaker?.session.get()
```

Reset through:

重置路径：

```ts
window.mangaMaker?.project.reset()
```

## 6. Current Product Invariants / 当前产品不变量
Agents must preserve:

agent 必须保持：

- Project type is part of project state and may be `manga` or `cg`.
- New `manga` pages default to `1200 x 1700`.
- New `cg` pages default to `1200 x 1600`.
- Changing project type changes future defaults; it does not automatically rewrite existing page sizes.
- The page renders inside a larger workspace of roughly 8x page area.
- The page fits inside the default visible canvas frame.
- The canvas container may scroll vertically for precision work.
- The ribbon remains sticky while scrolling.
- A panel image is crop-based, not whole-image scaling.
- Selecting a panel with an image reveals the bound source image and the current crop.
- Dragging the selected panel image changes crop only and never moves the panel itself.
- Panel geometry edits do not drag the bound image to a different stage position.
- Dragging a panel does not auto-select it at drag end.
- New text defaults to vertical.
- Dialogue text inside or near bubbles is stored as text items, not bubble fields, and follows the normal new-text defaults.
- Non-explosion bubbles preserve a continuous outline while tail tip and tail base are edited.
- `manga` image paste targets selected panel, then hovered panel, then a newly created panel near the pointer.
- `cg` image paste creates a new full-stage `1200 x 1600` panel by default.
- Project mutations mark unsaved changes instead of forcing per-edit disk writes.
- Manual `saveProject`, command-backed Home/project switching, and page close/hide save dirty projects before leaving the editor.
- Imported and pasted images materialize into the project assets when the import/paste operation happens.
- Web runtime persists to repository-root `projects/<sanitized-project-title>/project.json` with assets under `projects/<sanitized-project-title>/assets/`.
- Desktop runtime persists to local untracked `projects/<project-id>/project.json` with assets under `projects/<project-id>/assets/`.
- Default web launching uses share mode unless `--no-share` is passed.
- The launcher prints the local URL and share URL in the terminal when available.
- Vite dev must accept the Gradio share hosts needed by the launcher.

- 项目类型属于项目状态的一部分，只能是 `manga` 或 `cg`。
- 新建 `manga` 页面默认尺寸为 `1200 x 1700`。
- 新建 `cg` 页面默认尺寸为 `1200 x 1600`。
- 切换项目类型只影响后续默认行为，不会自动重写已有页面尺寸。
- 页面必须渲染在更大的工作区中，工作区面积约为页面面积的 8 倍。
- 页面本身必须落在默认可见画布框内。
- 画布容器允许为了精细编辑而上下滚动。
- ribbon 在滚动时必须保持吸附可见。
- 分镜图片显示必须基于裁切，而不是整图缩放。
- 选中带图分镜时，必须显示绑定源图和当前裁切区域。
- 拖拽已选中分镜的图片只能改变裁切，不能移动分镜本体。
- 分镜几何编辑不能把绑定图片拖到新的 stage 位置。
- 拖拽分镜结束后不能自动选中它。
- 新建文字默认竖排。
- 气泡内或气泡附近的对白文字保存为文字对象，而不是气泡字段，并遵守普通新建文字默认值。
- 非爆炸气泡在编辑尾尖和尾根后必须保持连续外轮廓。
- `manga` 图片粘贴规则是：选中分镜优先，其次悬停分镜，最后在指针附近新建分镜。
- `cg` 图片粘贴默认创建新的 `1200 x 1600` 全 stage 分镜。
- 修改项目后必须标记为存在未保存改动，而不是每次编辑都强制写盘。
- 手动 `saveProject`、命令驱动的 Home/项目切换，以及页面关闭/隐藏，都必须在离开编辑器前保存脏项目。
- 导入和粘贴的图片必须在导入/粘贴操作发生时写入项目资源目录。
- 网页版写入仓库根目录 `projects/<sanitized-project-title>/project.json`，资源写入 `projects/<sanitized-project-title>/assets/`。
- 桌面版写入本地未跟踪的 `projects/<project-id>/project.json`，资源写入 `projects/<project-id>/assets/`。
- 默认网页版启动必须启用分享模式，除非传入 `--no-share`。
- 启动器必须在终端打印本地地址，以及可用时的分享地址。
- Vite dev 必须允许启动器使用的 Gradio 分享主机通过。

## 7. Test Strategy Rule / 测试策略规则
Agents must test the claimed behavior, not just isolated functions.

agent 必须测试被声称的行为，而不只是孤立函数。

Guidance:

执行原则：

- Use `tests/commands` to verify command truth and state transitions.
- Use `tests/e2e` to verify user-visible behavior.
- Seed baseline state through automation only when the GUI path itself is not what is under test.
- Verify persistence claims with real on-disk results when the change touches save behavior.
- Verify web-launcher/share behavior when the change touches startup or terminal logging.
- Verify page-size defaults and paste targeting whenever project-type behavior changes.
- Verify bubble tail-base behavior whenever bubble geometry rendering or editing changes.

- 用 `tests/commands` 验证命令真值与状态迁移。
- 用 `tests/e2e` 验证用户可见行为。
- 只有在 GUI 路径本身不是测试目标时，才用自动化预置基础状态。
- 改动保存逻辑时，必须用真实磁盘结果验证持久化声明。
- 改动启动或终端日志时，必须验证网页版启动器与分享行为。
- 改动项目类型行为时，必须验证页面默认尺寸和图片粘贴目标。
- 改动气泡几何渲染或编辑时，必须验证尾根连接点行为。

## 8. Validation / 验证
Preferred validation commands:

推荐验证命令：

```bash
pnpm test
pnpm test:e2e
pnpm build
```

If a command cannot be run, the agent must say so explicitly.

如果某条命令无法执行，agent 必须明确说明。

## 9. Spec Gap Reporting / 规格缺口报告
If implementation does not satisfy the four governing documents, the agent must report:

如果实现尚未满足四份根文档，agent 必须报告：

1. what is implemented
2. what is missing
3. what was verified
4. what still needs work

1. 已实现什么
2. 还缺什么
3. 已验证什么
4. 还需要继续做什么

An agent must not claim the project is complete if the documented contract is not implemented.

如果文档契约尚未实现，agent 不得声称项目已经完成。
## 10. Built-in Creator Assistance Agent Product Contract / 内置创作辅助 Agent 契约

The built-in creator assistance Agent is a MangaMaker product feature, not the external coding-agent workflow. Its role is to assist the human creator with suggestions, context inspection, consistency checks, and bounded command plans. Manga creation remains human-led; the Agent must not be framed as independently writing, directing, drawing, or completing the comic.

It must never receive or expose real API keys in the frontend. Provider configuration is read only by the web/Vite backend or the Tauri backend.

Role rules:

- The Agent may advise on panels, dialogue placement, pacing, captions, bubbles, and layout consistency.
- The Agent may prepare local command plans only when they are grounded in the current project context and command manifest.
- The Agent must not claim that a comic page, story, or finished work is complete unless the creator has made or approved the relevant changes.
- The Agent should use language such as "suggest", "prepare", "inspect", and "help adjust" rather than language that implies autonomous authorship.
- Human creative intent takes precedence over model suggestions.

Durable document rules:

- Chat is not the durable production source of truth. Project Markdown documents are the durable carrier for plans, storyboards, script, art direction, continuity, and image prompts.
- The editor must expose a center workspace mode that can switch between comic editing and project Markdown documents while keeping the Agent sidebar available on the right.
- The left overview/sidebar is reserved for comic page thumbnails and page operations. It must not show document overviews.
- Entering the `Docs` workspace must show a file-viewer list of Markdown file names first. A document body is shown only after the user selects a file, and the default document view is rendered Markdown rather than a raw editor.
- The Docs workspace must let the creator right-click to create Markdown documents and right-click any document to rename or delete it. Default role metadocs are starter files only; once a manifest exists, user deletion must be respected and missing defaults must not be silently recreated.
- A new project must start with role metadocs under `docs/`: assistant metadoc, production plan, story architecture, storyboard overview, script/dialogue, art supervision, continuity check, and image prompts.
- Every active Agent role must be represented in the project document manifest and must bind exactly one `metadocId`. That metadoc defines the role and records the role's durable output.
- Within one project, each role must have at most one active Conversation Context session and exactly one metadoc. Switching roles must switch the visible conversation to that role's session.
- A document may be ordinary and unbound to any role. A role may read and write documents beyond its own metadoc.
- Creating a role must either create its metadoc automatically or bind an existing ordinary document as the role metadoc. Deleting a metadoc must remove the role. Deleting a role must keep its metadoc as an ordinary document.
- The Agent harness must expose roles and documents as tools: it may preload only the active role metadoc, and it must expose list roles, list documents, read one document, search documents, and write one document on demand. It must not preload all document bodies into the initial prompt.
- The Agent harness must expose SysML as an explicit standard-aware tool surface. `readSysmlStandardOverview` must be preloaded as a compact SysML v2/KerML/Pilot rule index, and `readSysmlStandardReference` must let any role read focused standard topics before changing unfamiliar MBSE semantics. Project model tools remain on demand: `getSysmlStatus`, `listSysmlFiles`, `readSysmlFile`, `writeSysmlFile`, and `validateSysmlModel`. It must not preload all SysML files into the initial prompt.
- When SysML is enabled, formal engineering constraints belong in `projects/<project-folder>/sysml/` and must be validated by the official SysML v2 Pilot Implementation. Markdown remains the human-readable production record, but SysML is the formal MBSE model.
- The center workspace must include `Comic`, `Docs`, and `SysML` modes. The SysML mode must list project SysML/KerML files, allow bounded edits, and expose validation diagnostics without hiding Pilot errors.
- Role prompts must describe the Agent as a producer, director, storyboard designer, script designer, art supervisor, continuity supervisor, prompt engineer, or custom assisting production role. These roles read and write documents and may prepare bounded command plans, but they do not become the human creator or claim final authorship.
- Other local agents should be able to inspect project documents by reading `projects/<project-folder>/docs/` and the document API without scraping chat messages.

Configuration rules:

- `MANGAMAKER_AGENT_TEST_MODE=1` enables deterministic test mode for tests and demos.
- `OPENROUTER_API_KEY` is required for the OpenRouter web backend.
- `MANGAMAKER_AGENT_MODEL` must be explicit outside test mode unless the project documents a vision-capable default.
- `MANGAMAKER_AGENT_CONTEXT_WINDOW_TOKENS` controls the Agent prompt/input budget and defaults to `262144`, the Kimi K2.6 upper context limit used by this project. The UI may send a per-project runtime override, but the backend must clamp it to the known model limit when one is available.
- `MANGAMAKER_AGENT_MAX_OUTPUT_TOKENS` defaults to `16384`; `MANGAMAKER_AGENT_REASONING_MAX_TOKENS` defaults to `2048`; `MANGAMAKER_AGENT_REASONING_EXCLUDE` defaults to `true`; `MANGAMAKER_AGENT_TEMPERATURE` defaults to `0.1`; `MANGAMAKER_AGENT_TOP_P` defaults to `0.9`. These settings should favor reliable JSON/tool behavior over exploratory prose. The reasoning cap is important for Kimi-style reasoning models because reasoning tokens share the model output budget; without a cap, the provider can return `finish_reason=length` with no final Agent JSON.
- The OpenRouter model allowlist is provider-restricted to DeepSeek and Kimi/Moonshot model ids, then capability-restricted to models whose metadata includes image input, text output, and `response_format` support.
- Google, Anthropic, OpenAI, text-only, and non-JSON-capable models must not be offered as available built-in Agent models.
- The UI must show whether vision input is enabled. If vision is unavailable or a screenshot send fails, the user-visible response must include a warning or error.

Command-plan rules:

- Model responses must be parsed and validated before display.
- Every `commandId` must exist in the local command registry.
- Every payload must pass the command's existing Zod `inputSchema`.
- The model's `dangerLevel` is advisory at most and must be replaced by local command metadata.
- Destructive plans, cross-page plans, and any plan with multiple mutating commands require confirmation.
- Multi-command history-recording plans should use one undo transaction when possible.

Context rules:

- The Agent context should summarize page, panel, image crop, text, bubble, layer order, and current selection information when those details are requested.
- The initial model prompt must not include every page's full resources, every asset metadata record, every SysML file body, or a screenshot by default. It should include a lightweight project summary, page index, current-page marker, selection summary, compact SysML standard overview, and tool catalog.
- The Agent must be able to read all project pages on demand, not only the currently selected page. The creator's current page must be marked with `isCurrent=true` in the page index and detailed page reads.
- The Agent harness should present project reading as local tools such as project summary, page listing, project search, single-page and batch page reading, selection inspection, filtered image asset listing, single-page and batch page rendering, role listing, Markdown document listing/reading/searching/writing, and command manifest reading.
- The Agent must be able to close the multimodal loop for a page: request a screenshot/render tool for a specific page, receive the composed visual result as a vision attachment, and receive the same page's structured resources so it can compare resource-level state with rendered outcome.
- The Agent must follow a structured-first visual budget policy. It should search/read resources before screenshots, use preview renders by default, request cropped page renders for local details, and reserve high-detail renders for small text, faces, or fine line art. Token savings must come from reducing image count, pixels, and crop area rather than relying on PNG/JPG format differences.
- The Agent context window controls prompt compaction only; it is not permission to preload every page, every asset, or every document. The default budget should allow Kimi K2.6-scale long document edits while still preserving the tool-first harness.
- The Agent UI must enforce a finite per-turn tool budget, skip repeated identical tool calls, and pause with Continue/Stop when more tools are needed instead of forcing a final answer from incomplete evidence.
- Canvas screenshots should prefer full page rendering or a Konva stage snapshot before falling back to raw DOM canvases.
- Large base64 assets must not be sent without bounds.
- `writeDocument` must be idempotent: model tool input must include an `operationId`, retries with the same id and identical document content must be safe, and conflicting reuse of an id must be rejected.
- The Agent sidebar must publish a sanitized debug snapshot for local automation and web debugging. The snapshot may include current busy state, pending tool call, recent messages, tool logs, config status, summarized context, and active run id/status, but it must not expose API keys or raw base64 screenshots.
- The Agent UI must show tool call status inline in the conversation flow rather than maintaining a standalone Tool Log panel. Clearing Conversation Context must clear visible tool status entries without recording a synthetic delete event.
- The Agent sidebar must expose a front-end configuration interface for manual steering and debugging. The creator must be able to edit the system prompt used for future turns and edit the conversation context sent to the model, including both user messages and Agent replies. Backend protocol constraints for JSON responses, command-plan validation, and local command execution remain mandatory even when the creator edits the prompt.

Agent run rules:

- A model turn must be represented as a persistent `agentRun`, not only as a single blocking chat request.
- Each run should be split into durable steps such as `model_request`, `tool_call`, `tool_result`, `model_resume`, `retry`, and `command_plan`.
- The web/Vite runtime must expose run inspection with `GET /__mangamaker__/agent/runs/:runId?projectId=...` and live updates with `GET /__mangamaker__/agent/runs/:runId/events`.
- The UI should subscribe to run status with SSE or an equivalent realtime channel rather than waiting for a long `/chat` fetch.
- Provider timeouts, terminated upstream connections, HTTP 429, HTTP 5xx, non-JSON responses, and invalid Agent JSON must be recorded in the run trace and retried or surfaced as clear run failures.
- Tool results included in model resumes should be compacted or summarized when large; the model should request details on demand rather than receiving large context repeatedly.
- Prompt compaction must preserve the latest unique non-budget tool results, especially document reads/writes, so repeated budget or skip messages cannot hide the evidence the model just requested.
- If the model repeats an identical tool call after the result is already available, the harness should return a corrective skipped-tool result once; if it repeats again, pause the run instead of continuing an infinite loop.

Conversation Context rules:

- Agent Conversation Context must be scoped by project id and role id, and persisted by default.
- Opening the Agent for a project should restore the active role's editable Conversation Context.
- Switching the active role must load that role's single Conversation Context and must not show or save another role's messages under the new role.
- Conversation Context must remain until the creator explicitly uses `Clear context`.
- Clearing Conversation Context must clear only the active role's session and must not delete project pages, resources, Markdown documents, other role sessions, or editor undo history.
- Conversation Context must use a stable project-local role-indexed record, `agent-conversation-context.json` inside the project folder, rather than relying only on browser `localStorage`.
- Other local agents and debugging scripts should be able to read role sessions from that file or from `GET /__mangamaker__/agent/conversation-context?projectId=...&roleId=...` without decoding browser profile databases.
- Existing single-session `agent-conversation-context.json` and `agent-chat.json` records may be read only as migration fallbacks; new writes should use the role-indexed Conversation Context store.

Desktop rule:

- Desktop production must use Tauri commands for Agent config/chat or clearly disable the Agent with an actionable unavailable reason. It must not keep a guaranteed-failing `fetch("/__mangamaker__/agent/chat")` path.
