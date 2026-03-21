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
- `src/ui`: human-facing behavior
- `src/automation/api.ts`: browser automation bridge
- `vite.config.ts` and `vite.config.js`: web persistence middleware, `/projects` serving, and allowed share hosts
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
- Home navigation and manual save
- page background color change
- panel create, move, resize, delete, polygon conversion, and vertex editing
- panel image placement and selection-driven crop editing
- panel description metadata editing
- layer up/down movement for panels, text, and bubbles
- text create, move, resize, delete, direction, font, and alignment changes
- bubble create, move, resize, delete, type changes, typography changes, tail tip changes, tail-base changes, and type-specific parameter changes
- clipboard copy/paste for page, panel, text, and bubble payloads
- image paste targeting behavior for `manga`
- image paste full-stage behavior for `cg`
- export, undo/redo, locale switch, autosave, and manual save

- `createProject`，包括项目类型选择
- `setProjectType`
- `renameProject`
- 页面新增、复制、删除、重排和切换
- Home 返回与手动保存
- 页面背景色修改
- 分镜创建、移动、缩放、删除、多边形转换和顶点编辑
- 分镜图片放置与选中驱动的裁切编辑
- 分镜描述元数据编辑
- 分镜、文字和气泡的图层上移/下移
- 文字的创建、移动、缩放、删除、方向、字体和对齐修改
- 气泡的创建、移动、缩放、删除、类型切换、排版修改、尾尖修改、尾根修改和类型专属参数修改
- 页面、分镜、文字和气泡的复制粘贴
- `manga` 模式下的图片粘贴目标优先级
- `cg` 模式下的全 stage 图片粘贴行为
- 导出、撤销/重做、语言切换、自动保存和手动保存

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
- New bubble text defaults to vertical.
- Non-explosion bubbles preserve a continuous outline while tail tip and tail base are edited.
- `manga` image paste targets selected panel, then hovered panel, then a newly created panel near the pointer.
- `cg` image paste creates a new full-stage `1200 x 1600` panel by default.
- Every project mutation triggers immediate persistence.
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
- 新建气泡内文字默认竖排。
- 非爆炸气泡在编辑尾尖和尾根后必须保持连续外轮廓。
- `manga` 图片粘贴规则是：选中分镜优先，其次悬停分镜，最后在指针附近新建分镜。
- `cg` 图片粘贴默认创建新的 `1200 x 1600` 全 stage 分镜。
- 每次修改项目后都必须立即持久化。
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
