# Test Guide / 测试规范

This document defines the testing rules and manual/automated procedures that must be executed after any modification to MangaMaker.

本文档定义对 MangaMaker 做出任何修改后，必须执行的测试规则以及手动/自动化验证流程。

## 1. Constitutional Status / 宪制地位
This is the fourth governing document of the MangaMaker project.
The project is governed by exactly four documents:

这是 MangaMaker 项目的第四份根文档。
本项目只受以下四份文档约束：

1. `README.md`
2. `操作指南.md`
3. `machineGuide.md`
4. `testGuide.md`

## 2. Testing Requirements / 测试要求
After any code change, the following verifications must be performed.

任何代码变更后，都必须执行以下验证。

### 2.1 Automated Tests / 自动化测试
Run and pass all automated checks:

必须运行并通过以下自动化检查：

```bash
pnpm test
pnpm test:e2e
pnpm build
```

If a change only affects documentation, say so explicitly.

如果改动只影响文档，也要明确说明。

### 2.2 API Interface Testing / API 接口调试与测试
Every modified feature must be debugged through the `window.mangaMaker` interface when that interface is relevant.

只要功能可通过 `window.mangaMaker` 驱动，就必须通过该接口调试和验证。

Minimum required API checks when the related behavior changes:

相关行为发生变化时，至少必须进行以下 API 检查：

1. Identify the corresponding command in `src/commands`.
2. Verify command execution through `window.mangaMaker.commands.execute()`.
3. Verify state through `window.mangaMaker.project.get()` and `window.mangaMaker.session.get()`.
4. Verify `createProject` accepts the intended `type` and persists it in project state.
5. Verify `setProjectType` updates `project.type` correctly.
6. Verify `addPage` creates the correct default size for the current project type.
7. Verify `moveLayer` updates `project.pages[n].layers` with the correct ordering.
8. Verify `setPanelDescription` persists per-panel metadata and does not create rendered comic text.
9. Verify `pasteClipboardItem` accepts page/panel/text/bubble payloads and inserts new ids without overwriting originals.
10. Verify panel/page paste payloads retain image data and can be persisted into the target project assets.
11. Verify `updateBubble` can persist bubble type changes, style changes, `tailTip`, `tailBase`, `tailWidth`, and `spikePositions` when relevant.
12. Verify `saveProject`, `goHome`, project switching, and the page close/hide save path write dirty project state at the defined persistence points.

1. 在 `src/commands` 中定位对应命令。
2. 通过 `window.mangaMaker.commands.execute()` 验证命令执行。
3. 通过 `window.mangaMaker.project.get()` 和 `window.mangaMaker.session.get()` 验证状态。
4. 验证 `createProject` 能接受目标 `type`，并把它写入项目状态。
5. 验证 `setProjectType` 能正确更新 `project.type`。
6. 验证 `addPage` 会按当前项目类型创建正确的默认尺寸。
7. 验证 `moveLayer` 会按预期更新 `project.pages[n].layers` 顺序。
8. 验证 `setPanelDescription` 会持久化每个分镜的元数据，且不会生成渲染文字对象。
9. 验证 `pasteClipboardItem` 能处理页面、分镜、文字、气泡 payload，并生成新的 id，不覆盖原对象。
10. 验证分镜/页面粘贴 payload 能保留图片数据，并可写入目标项目资源目录。
11. 在相关改动中，验证 `updateBubble` 能持久化气泡类型、样式、`tailTip`、`tailBase`、`tailWidth` 和 `spikePositions`。
12. 验证 `saveProject`、`goHome`、项目切换以及页面关闭/隐藏保存路径会在定义的持久化节点写入脏项目状态。

### 2.3 Persistence Verification / 持久化验证
When a change touches saving, importing, pasting, startup project discovery, or project naming, verify real filesystem results.

凡是改动了保存、导入、粘贴、启动时的项目发现或项目命名，都必须验证真实文件系统结果。

Web runtime checks:

网页版检查：

1. Verify projects are listed from real `projects/` folder contents.
2. Verify each project persists to its own `projects/<sanitized-project-title>/project.json` folder.
3. Verify imported and pasted images persist under `projects/<sanitized-project-title>/assets/`.
4. Verify a project title rename updates the folder name when the target folder is available.
5. Verify conflicting folder names resolve safely instead of overwriting another project.

1. 验证项目列表来自真实的 `projects/` 文件夹内容。
2. 验证每个项目都落到独立的 `projects/<sanitized-project-title>/project.json` 文件夹中。
3. 验证导入和粘贴的图片写入 `projects/<sanitized-project-title>/assets/`。
4. 验证修改项目标题后，在目标文件夹可用时会同步更新文件夹名。
5. 验证文件夹名冲突时会安全处理，而不是覆盖其他项目。

Desktop runtime checks:

桌面版检查：

1. Verify manual Save, Home/project switching, and close/hide save create or update `projects/<project-id>/project.json`.
2. Verify imported and pasted images persist to `projects/<project-id>/assets/`.
3. Verify startup project listing sees existing on-disk projects.

1. 验证手动 Save、Home/项目切换以及关闭/隐藏页面保存会创建或更新 `projects/<project-id>/project.json`。
2. 验证导入和粘贴的图片写入 `projects/<project-id>/assets/`。
3. 验证启动时的项目列表能够看到已有磁盘项目。

### 2.4 Manual GUI Testing / 手动 GUI 测试
If a change affects human interaction, manually verify the relevant user-visible behavior, or cover it with E2E tests that simulate those actions.

如果改动影响人机交互，就必须手动验证相应可见行为，或用 E2E 测试覆盖这些操作。

Minimum manual checklist:

最低手动检查清单：

1. **Welcome Flow**: Existing projects appear with thumbnails; creating a project requires title and type; right-clicking a project exposes delete.
2. **Project Types**: Creating `manga` and `cg` projects works; changing project type from the sidebar updates future defaults.
3. **Page List**: Add, duplicate, move, and delete pages; page labels remain order-numbered.
4. **Workspace Layout**: The page fits in the default visible frame; the surrounding workspace is larger; vertical scrolling works; the ribbon remains sticky while scrolling.
5. **Panels**: Create, move, resize, polygon-edit, and delete panels; vertex edits update live before mouse release.
6. **Panel Drag Semantics**: Dragging a panel moves it but does not auto-select it; a pure click selects it.
7. **Image Crop Editing**: Selecting a panel reveals the source image; left-drag on the image pans crop; wheel zooms crop; panel position stays fixed.
8. **Manga Image Paste**: Pasting an image goes to the selected panel first, then the hovered panel, otherwise a new nearby panel.
9. **CG Image Paste**: Pasting an image creates a new full-stage `1200 x 1600` panel by default.
10. **Text**: New text defaults to vertical; direction, font, size, alignment, and color controls behave correctly.
11. **Bubbles**: Bubble type switching works; continuous numeric controls use sliders; tail tip drag works; tail-base drag works; the bubble outline stays continuous without an internal tail border.
12. **Explosion Bubbles**: Spike editing works and remains persisted.
13. **Context Menus**: Right-click on canvas objects opens the custom menu and suppresses the browser menu; layer up/down changes stacking order.
14. **Persistence**: After important actions such as page creation, image import, image paste, and bubble editing, dirty state is set; Save, Home/project switch, and close/hide write the latest project files without losing work.
15. **Home and Save**: Users can return to the welcome screen and save manually without losing work.
16. **Export**: Export page PNG and project PDF both work and report status.
17. **Language**: Chinese and English UI remain readable after switching.

1. **欢迎流程**：欢迎页能看到现有项目和缩略图；创建项目必须输入标题并选择类型；右键项目可删除。
2. **项目类型**：创建 `manga` 和 `cg` 项目都能工作；从侧边栏切换类型后，会影响后续默认行为。
3. **页面列表**：新增、复制、移动和删除页面都能工作；页面标签始终按顺序编号。
4. **工作区布局**：页面能完整落在默认可见框内；外围工作区明显更大；支持垂直滚动；滚动时 ribbon 仍然悬浮。
5. **分镜**：创建、移动、缩放、多边形编辑和删除分镜；顶点编辑在松手前实时更新。
6. **分镜拖拽语义**：拖拽分镜会移动它，但不会在拖拽结束后自动选中；纯点击会选中它。
7. **图片裁切编辑**：选中分镜后显示源图；在图片上左拖拽会平移裁切；滚轮缩放裁切；分镜位置保持不变。
8. **漫画模式图片粘贴**：粘贴图片时，优先进入选中分镜，其次悬停分镜，否则新建附近分镜。
9. **CG 模式图片粘贴**：粘贴图片时默认创建新的 `1200 x 1600` 全 stage 分镜。
10. **文字**：新建文字默认竖排；方向、字体、字号、对齐和颜色控制都正确。
11. **气泡**：气泡类型切换正常；连续数值控制使用滑杆；尾尖拖拽正常；尾根拖拽正常；气泡外轮廓保持连续，内部不出现尾巴边线。
12. **爆炸气泡**：尖刺编辑正常并能持久化。
13. **右键菜单**：在画布对象上右键会打开自定义菜单并屏蔽浏览器菜单；图层上移/下移会改变堆叠顺序。
14. **持久化**：页面创建、图片导入、图片粘贴、气泡编辑等重要操作后会标记未保存；Save、Home/项目切换以及关闭/隐藏页面会写入最新项目文件且不丢失工作。
15. **Home 与 Save**：用户可以返回欢迎页，并能手动保存且不丢失进度。
16. **导出**：页面 PNG 和项目 PDF 导出都能工作，并有状态反馈。
17. **语言**：切换中英文后，界面仍然可读。

### 2.5 Startup and Share Verification / 启动与分享验证
When a change touches the web launcher, Vite host policy, or Gradio integration, verify:

凡是改动了网页版启动器、Vite 主机策略或 Gradio 集成，都必须验证：

1. `pnpm dev` starts successfully.
2. The terminal prints the local URL.
3. Share mode is enabled by default.
4. The terminal prints the Gradio share URL when the tunnel succeeds.
5. `pnpm dev -- --no-share` disables share-mode startup.
6. The Vite dev server accepts the generated `*.gradio.live` host.

1. `pnpm dev` 能正常启动。
2. 终端会打印本地地址。
3. 默认分享模式处于启用状态。
4. 隧道成功后，终端会打印 Gradio 分享地址。
5. `pnpm dev -- --no-share` 能关闭分享模式。
6. Vite dev server 能接受生成的 `*.gradio.live` 主机名。

## 3. Reporting / 报告
If any required test fails, the modification is incomplete and must be fixed before acceptance.

如果任何必需测试失败，该改动就属于未完成，必须在验收前修复。

A valid completion report must say:

合格的完成报告必须说明：

1. which commands were run
2. which behaviors were manually verified
3. what could not be verified
4. any remaining risk

1. 执行了哪些命令
2. 手动验证了哪些行为
3. 哪些内容未能验证
4. 还存在哪些风险
### 2.6 Built-in Creator Assistance Agent Verification / 内置创作辅助 Agent 验证

Agent changes must verify both backend contract and user-visible behavior:

1. `GET /__mangamaker__/agent/config` reports test mode, missing API key, configured model, and vision status without exposing secrets.
2. Invalid model responses are rejected for invalid JSON, unknown `commandId`, and payloads that fail the command Zod schema.
3. Local command metadata overrides any model-supplied `dangerLevel`.
4. Confirmation is required for destructive plans, cross-page plans, and plans with multiple mutating commands.
5. Vision failure or text-only fallback must show a warning or error in the Agent UI.
6. E2E coverage should open the Agent sidebar, receive a test-mode plan, show confirmation for risky plans, execute a confirmed command, and show a clear disabled state when configuration is unavailable.
7. A multi-command mutating plan should be undoable with one undo action when the participating commands record history.
8. User-facing Agent copy must describe the feature as assistance for the creator, not as autonomous manga creation.
9. Tests and demos should prefer prompts that ask for suggestions, checks, or bounded local edits instead of asking the Agent to create a complete comic by itself.
10. Model availability tests must reject Google, Anthropic, OpenAI, text-only, and non-JSON-capable models; only DeepSeek or Kimi/Moonshot models with image input, text output, and `response_format` support may be considered available.
11. When debugging Agent stalls, verify `GET /__mangamaker__/agent/debug` and `window.mangaMaker.agent.getDebugSnapshot()` report the current busy state, pending tool call, recent tool logs, and sanitized context without exposing API keys or raw base64 screenshots.
12. Harness/context tests must verify that every project page is represented in Agent context, the creator's current page is marked with `isCurrent=true`, page render tool calls can return a screenshot plus same-page resources, and large inline image data is redacted before prompt construction.
13. Agent chat history tests must verify that messages persist per project when the Agent sidebar is reopened, and that `Delete chat` clears only that project's conversation.

Use `MANGAMAKER_AGENT_TEST_MODE=1` for deterministic tests. Real `OPENROUTER_API_KEY` values must not be committed or written to test fixtures.
