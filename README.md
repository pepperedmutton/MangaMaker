# MangaMaker

## Definition / 定义
MangaMaker is a comic and CG page editor for assembling image-based pages, dialogue, and layout into finished reading pages.

MangaMaker 是一个漫画与 CG 页面编辑器，用于把图片、分镜、文字和气泡组织成可阅读的成品页面。

## Constitutional Rule / 宪制规则
This project is governed by exactly four definition documents:

本项目只受以下四份定义文档约束：

1. `README.md`
2. `操作指南.md`
3. `machineGuide.md`
4. `testGuide.md`

If code, UI, automation, or tests conflict with these documents, the documents are correct and the implementation is incomplete.

如果代码、界面、自动化或测试与这些文档冲突，以文档为准，实现视为未完成。

## Product Scope / 产品范围
Required scope:

必需范围：

- Multi-page project editing for both `manga` and `cg` project types.
- Startup opens a welcome screen that lists existing projects with first-page thumbnails.
- Creating a project requires a title and a project type, and the project type remains editable later from the editor sidebar.
- Welcome-screen project cards support opening and right-click deletion.
- The editor top bar exposes `Home`, `Save`, `Export Page`, and `Export PDF`.
- Page cards support add, duplicate, move, and delete, and the visible page labels are always order-based numbering rather than copy-style names.
- The visible comic page sits inside a larger editable workspace rather than filling the whole editor.
- The page fits inside the visible canvas frame at the default fit view, while the surrounding editor surface may require vertical scrolling for precision work.
- The ribbon stays visible while scrolling.
- Panels are crop windows bound to source images rather than scaled whole-image containers.
- Selecting a panel with an image reveals the bound source image outside the mask and allows direct drag-and-wheel crop adjustment.
- Dragging a panel image never moves the panel itself.
- Dragging panel vertices or resize handles reshapes the panel without dragging the bound image through stage space.
- Polygon panels and editable vertex counts are supported.
- Context menus replace the browser default menu inside the editing surface.
- Panel, text, and bubble objects support direct layer up/down actions.
- Panels support non-rendered description metadata in the right inspector.
- Copy/paste supports pages, panels, text, and bubbles across projects and app instances.
- Image paste targets the selected panel first, then the hovered panel, and otherwise creates a new panel near the pointer.
- In `cg` projects, pasted images create a new full-stage `1200 x 1600` panel by default.
- Text supports horizontal and vertical layout, but new text defaults to vertical.
- Dialogue lettering is represented by text boxes; speech bubbles are shape containers that can be grouped or aligned with text.
- The Inspector exposes text font, size, direction, alignment, and stroke controls, plus bubble shape/style controls and continuous numeric sliders.
- Non-explosion bubbles support both a draggable tail tip and a draggable tail-to-body connection point, and the rendered outline must remain continuous without internal tail borders.
- Project edits are lazy-saved: mutating operations mark unsaved changes, and the project is written when the user clicks `Save`, leaves the project, or closes/hides the page with unsaved changes.
- In web runtime, project saves land in repository-root `projects/` folders.
- In desktop runtime, project saves land in a local untracked `projects/` folder.
- The default web launcher creates a public share link unless `--no-share` is passed. Gradio remains the default provider, and `ngrok` is supported through `--share-provider ngrok`.
- The UI and governing documents remain readable in Chinese and English.
- All major GUI actions have command/API parity.

- 支持 `manga` 与 `cg` 两种项目类型的多页项目编辑。
- 启动后进入欢迎页，展示已有项目及其第一页缩略图。
- 创建项目时必须输入标题并选择项目类型，进入编辑器后仍可在侧边栏修改项目类型。
- 欢迎页项目卡片支持打开，也支持右键删除。
- 编辑器顶部提供 `Home`、`Save`、`Export Page` 和 `Export PDF`。
- 页面卡片支持新增、复制、移动和删除；侧边栏里显示的页面名称始终按顺序编号，不出现“第一页副本”这类名称。
- 可见漫画页面必须位于更大的可编辑工作区中，而不是填满整个编辑器。
- 默认适配视图下，页面本身必须完整落在可见画布框内；为了精细编辑，外围编辑面可以更高并允许垂直滚动。
- 顶部 ribbon 在滚动时必须保持可见。
- 分镜是绑定源图片的裁切窗口，而不是整图缩放容器。
- 选中带图分镜时，必须显示遮罩外的源图，并允许直接拖拽和平移、滚轮缩放裁切区域。
- 拖拽分镜图片时，不能移动分镜本身。
- 拖拽分镜顶点或缩放手柄时，只能改变分镜几何，不能把绑定图片在 stage 中一起拖走。
- 必须支持多边形分镜和可编辑顶点数量。
- 编辑区内的右键菜单必须替代浏览器默认菜单。
- 分镜、文字和气泡都必须支持图层上移/下移。
- 分镜支持右侧 inspector 中的非渲染描述元数据。
- 页面、分镜、文字和气泡必须支持跨项目、跨实例复制粘贴。
- 粘贴图片时，优先粘贴到已选中的分镜；若无选中，则粘贴到鼠标悬停的分镜；若两者都没有，则在指针附近新建分镜。
- `cg` 项目中，粘贴图片时默认新建一个铺满 stage 的 `1200 x 1600` 分镜。
- 文字支持横排和竖排，但新建文字默认竖排。
- 对白文字由独立文字框表示；气泡是形状容器，可与文字框组合或对齐。
- Inspector 必须提供文字的字体、字号、方向、对齐和描边控制，以及气泡形状/样式控制和连续数值滑杆。
- 非爆炸气泡必须同时支持拖拽尾巴尖端和尾巴与本体的连接点，并保证外轮廓连续、内部不出现尾巴边线。
- 项目编辑采用懒保存：修改操作会标记未保存状态，用户点击 `Save`、离开项目或在有未保存更改时关闭/隐藏页面，才会写入项目文件。
- 网页版的项目保存必须写入仓库根目录的 `projects/`。
- 桌面版的项目保存必须写入本地未跟踪的 `projects/`。
- 默认网页版启动器必须创建一个 72 小时有效的 Gradio 分享链接，除非显式传入 `--no-share`。
- 界面与根文档必须支持中英文阅读。
- 所有主要 GUI 操作都必须具备命令/API 对齐。

Non-goals:

非目标：

- Full raster painting.
- Photoshop-class image editing.
- General illustration tooling unrelated to page assembly.

- 完整位图绘画。
- Photoshop 级图像编辑。
- 与页面组装无关的通用插画工具。

## Functional Areas / 功能分区
### Project and Page / 项目与页面
- Create, rename, load, manually save, and leave-save projects.
- Choose project type during creation and change it later from the sidebar.
- Show welcome-screen thumbnails and delete projects from the welcome context menu.
- Add, duplicate, delete, reorder, and select pages.
- Change current page background color from the ribbon.
- Export current page as PNG and the whole project as PDF.
- Web runtime persists to `projects/<sanitized-project-title>/project.json` with assets under `projects/<sanitized-project-title>/assets/`.
- Desktop runtime persists to `projects/<project-id>/project.json` with assets under `projects/<project-id>/assets/`.

### Panel and Image / 分镜与图片
- Create, move, resize, delete, and style panels.
- Convert panels to polygons and edit vertices live.
- Bind exactly one source image per panel image slot.
- Reveal the selected panel's source image for direct crop editing.
- Keep panel position stable while image crop changes.
- Support panel description metadata in the Inspector.
- Materialize imported and pasted images into the current project's persisted assets immediately.

### Text and Bubble / 文字与气泡
- Create, edit, move, resize, and delete text boxes.
- Support horizontal and vertical text, with vertical as the default for new text.
- Support font family, font size, direction, horizontal alignment, and vertical alignment in the Inspector.
- Create, edit, move, resize, and delete speech bubbles.
- Support ten bubble types: `round`, `ellipse`, `cloud`, `square`, `roundedSquare`, `oval`, `explosion`, `thought`, `jagged`, `bubbleRound`.
- Support type-specific bubble controls such as corner radius, bumpiness, jaggedness, thought circles, spike settings, and tail width.
- Support continuous-outline tail editing for non-explosion bubbles through both tail tip and tail-base controls.

### System and Automation / 系统与自动化
- Undo and redo.
- Shared command model for UI, tests, and automation.
- Local automation bridge via `window.mangaMaker`.
- Lazy project persistence on manual save, project leave, and page close/hide.
- Default web share launcher with terminal-printed public link output for the active share provider.

## Required UX Rules / 必需易用性规则
- A new user must be able to create a project, choose `manga` or `cg`, add a page, create panels, import or paste images, add text or bubbles, and export without outside help.
- The page must remain centered inside a visibly larger workspace of roughly 8x page area.
- The page itself must fit inside the default visible canvas frame, even though the surrounding editing surface may extend vertically and require scrolling.
- The ribbon must remain visible while scrolling.
- The zoom UI must be a continuous slider instead of discrete presets.
- Crossing 100% zoom must remain visually continuous and must not suddenly resize the editing surface itself.
- The workspace frame must remain inside the editing surface at every zoom level.
- When selected text or panels overlap the page edge, the page boundary must remain readable as a dashed overlay above them.
- Right-click inside the editing surface must feel immediate and context-sensitive, and must never fall back to the browser menu.
- Delete actions must be immediate and undoable.
- `projects/` persistence must be reliable enough that clicking `Save`, leaving the project, or closing the app after an important action does not lose work.

- 新用户必须能在无外部帮助的情况下完成：创建项目、选择 `manga` 或 `cg`、新增页面、创建分镜、导入或粘贴图片、加入文字或气泡、导出。
- 页面必须居中放在明显更大的工作区中，工作区面积约为页面面积的 8 倍。
- 页面本身必须落在默认可见画布框内，哪怕外围编辑面更高、需要上下滚动。
- ribbon 在滚动时必须保持可见。
- 缩放界面必须是连续滑杆，而不是离散预设。
- 缩放跨过 100% 时必须连续，不能让编辑区本身突然放大。
- 任意缩放级别下，workspace 外框都必须留在编辑区内。
- 当已选中的文字或分镜压到页面边界时，页面边界必须以虚线叠加在对象上方，保持可读。
- 编辑区右键菜单必须即刻出现并随对象变化，绝不能退回浏览器默认菜单。
- 删除操作必须立即执行，但仍然能够撤销。
- `projects/` 落盘必须可靠，保证点击 `Save`、离开项目或完成重要操作后关闭程序都不会丢数据。

## Required Engineering Rules / 必需工程规则
- Product behavior must be command-backed.
- Domain schema, commands, persistence, UI, automation API, tests, and docs must stay aligned.
- A feature is incomplete until tests cover the claimed behavior.
- Documentation must be updated before or with every behavior change.
- A feature is not complete if only the GUI path works or only the automation path works.

- 产品行为必须由命令层驱动。
- 领域模型、命令、持久化、UI、自动化 API、测试和文档必须保持一致。
- 没有测试覆盖的新功能不算完成。
- 任何行为变化都必须先更新文档，或在同一次改动中同步更新。
- 只有 GUI 可用或只有自动化可用，都不算功能完成。

## Acceptance Standard / 验收标准
The project is acceptable only if all of the following are true:

项目只有在以下条件全部成立时才算可接受：

- The code matches `README.md`, `操作指南.md`, `machineGuide.md`, and `testGuide.md`.
- A human can complete the workflow described in `操作指南.md`.
- An agent can inspect, drive, and validate the product as described in `machineGuide.md` and `testGuide.md`.
- The command layer exposes the same core actions that the GUI exposes.
- Tests verify the behavior claimed by the documents.

- 代码与 `README.md`、`操作指南.md`、`machineGuide.md` 和 `testGuide.md` 一致。
- 人类用户可以完成 `操作指南.md` 定义的流程。
- Agent 可以按 `machineGuide.md` 和 `testGuide.md` 的定义检查、驱动并验证产品。
- 命令层暴露的核心行为与 GUI 对外行为一致。
- 测试已经验证文档声明的行为。

## Status / 当前状态
Snapshot date: March 21, 2026.

快照日期：2026 年 3 月 21 日。

Current status:

当前状态：

- The required scope in this document is implemented in the current repository state.
- Welcome-screen project browsing, first-page thumbnails, project-type selection, and right-click project deletion are present.
- Order-based page naming, page context menus, page background editing, export, and manual save are present.
- Crop-based panel images, live selected-image dragging, polygon editing, layer controls, and panel description metadata are present.
- Default vertical text, text Inspector typography/stroke controls, bubble shape controls, and tail-base editing for non-explosion bubbles are present.
- Lazy save-on-demand and save-on-exit persistence are present in both web and desktop runtimes, with web persistence rooted at repository `projects/`.
- The default web launcher starts in share mode and prints the active provider link in the terminal.
- Validation currently passes with `pnpm test`, `pnpm test:e2e`, and `pnpm build`.

- 本文档要求的范围已经在当前仓库状态中实现。
- 欢迎页项目浏览、首页缩略图、项目类型选择和项目右键删除已经具备。
- 顺序编号页面名称、页面右键菜单、页面背景编辑、导出和手动保存已经具备。
- 基于裁切的分镜图片、选中后实时拖图、多边形编辑、图层控制和分镜描述元数据已经具备。
- 默认竖排文字、文字 Inspector 排版/描边控制、气泡形状控制，以及非爆炸气泡的尾巴连接点编辑已经具备。
- 网页版与桌面版都具备按需保存和退出保存，其中网页版落盘根目录为仓库 `projects/`。
- 默认网页版启动器会在终端打印 Gradio 分享链接。
- 当前验证命令 `pnpm test`、`pnpm test:e2e` 和 `pnpm build` 可通过。

## Repository Map / 仓库结构
- `src/domain`: schema and pure helpers
- `src/commands`: shared command layer
- `src/state`: editor session and history state
- `src/storage`: persistence and `projects/` integration
- `src/ui`: human-facing interface
- `src/automation`: browser automation bridge
- `scripts`: launchers, Gradio share support, and project-generation workflows
- `vite.config.ts`: web persistence middleware and `/projects` file serving
- `src-tauri/src/lib.rs`: desktop persistence bridge
- `tests/commands`: command-layer truth tests
- `tests/e2e`: GUI and user-path truth tests

- `src/domain`：数据结构与纯辅助逻辑
- `src/commands`：共享命令层
- `src/state`：编辑器会话与历史状态
- `src/storage`：持久化与 `projects/` 集成
- `src/ui`：面向用户的界面
- `src/automation`：浏览器自动化桥接
- `scripts`：启动器、Gradio 分享和项目生成脚本
- `vite.config.ts`：网页版持久化中间件与 `/projects` 文件服务
- `src-tauri/src/lib.rs`：桌面版持久化桥接
- `tests/commands`：命令层真值测试
- `tests/e2e`：GUI 与用户路径真值测试

## Run / 运行
Web shared mode:

网页版分享模式：
```bash
pnpm install
pnpm dev
```

Web shared mode with ngrok:

```bash
pnpm dev -- --share-provider ngrok
```

Web local-only mode:

网页版仅本地：
```bash
pnpm dev -- --no-share
```

Desktop:

桌面版：
```bash
pnpm tauri dev
```

Validation:

验证：
```bash
pnpm test
pnpm test:e2e
pnpm build
```

## Built-in Creator Assistance Agent / 内置创作辅助 Agent

MangaMaker includes an in-product creator assistance Agent in the editor sidebar. Manga creation remains the creator's work: the Agent is there to inspect the current page, offer suggestions, explain options, and prepare small command-based edits when the creator asks for them. It must not present itself as the author of the comic or take over end-to-end manga creation.

This product Agent is separate from external coding-agent workflows, but its internal harness follows the same basic shape: the Agent receives a tool catalog and audited local tool results for reading the MangaMaker project. It can inspect all pages, identify the page the creator is currently viewing with `isCurrent=true`, read page objects and resource indexes, and use the command manifest as its API reference. It only mutates the project through the local command registry, validates command payloads with the existing Zod schemas, and executes approved plans through the editor undo/redo history.

Open the Agent from the editor ribbon with the `Agent` button. The sidebar always shows its configuration state before chat is available:

- `MANGAMAKER_AGENT_TEST_MODE=1` enables deterministic test mode and does not require a real provider key.
- `OPENROUTER_API_KEY` is required for the web/Vite OpenRouter backend. Do not commit real keys.
- `MANGAMAKER_AGENT_MODEL` is required outside test mode. The app does not silently default to a non-vision model for multimodal use.
- The available OpenRouter model list is filtered to DeepSeek and Kimi models that report image input, text output, and `response_format` support in OpenRouter metadata. Google, Anthropic, OpenAI, and text-only models are not valid built-in Agent models.
- The sidebar shows whether visual input is enabled. If a canvas screenshot cannot be sent or read, the response shows a warning instead of silently falling back to text-only mode.

Agent suggestions may include command plans for local edits such as adding a panel, adjusting text, or preparing a save. Safe read-only or single normal edits may run automatically after validation, while destructive actions, cross-page changes, and plans with multiple mutating commands require explicit confirmation. Multi-command mutating plans are grouped into one undo transaction whenever the underlying commands record history.

The Agent should assist with critique, planning, consistency checks, and mechanical editor operations. Story direction, page composition, final dialogue, and artistic judgment remain under the human creator's control. Large image data is not dumped into the prompt; visual renders and assets are exposed as bounded attachments or resource references.

The web/Vite backend provides `GET /__mangamaker__/agent/config`, `GET /__mangamaker__/agent/models`, and `POST /__mangamaker__/agent/chat`. While the sidebar is open, `GET /__mangamaker__/agent/debug` exposes a sanitized live snapshot for debugging stuck tool calls; the same snapshot is available in the browser through `window.mangaMaker.agent.getDebugSnapshot()`. The debug snapshot must not include API keys or base64 screenshot data.

Desktop/Tauri builds use Tauri commands instead of fetching those web endpoints, so production desktop does not keep a failing `fetch`. The current desktop native backend supports test-mode availability and otherwise reports the Agent backend as unavailable unless a native provider proxy is configured.
