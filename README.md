# MangaMaker

## Definition / 定义
MangaMaker is a comic and manga page editor for assembling source images into readable pages.

MangaMaker 是一个漫画页面编辑器，用于把源图片整理成可阅读的漫画页面。

## Constitutional Rule / 宪制规则
This project is governed by exactly three definition documents:

本项目只受以下三份定义文档约束：

1. `README.md`
2. `操作指南.md`
3. `machineGuide.md`

First principle:
The software must correctly implement all three documents. Any code change, UX change, command change, schema change, automation change, or test change must preserve the correctness of these three documents, or update the documents first or in the same change.

第一原则：
软件必须正确实现这三份文档。任何代码、交互、命令、数据结构、自动化接口或测试的改动，都必须先保证这三份文档仍然正确，或在同一改动中同步更新文档。

Authority order:

优先级顺序：

1. `README.md` defines scope, required features, hard constraints, and acceptance criteria.
2. `操作指南.md` defines how a human must be able to use the product.
3. `machineGuide.md` defines how an agent or script must inspect, change, test, and drive the product through code.

1. `README.md` 定义范围、必需功能、硬约束和验收标准。
2. `操作指南.md` 定义人类用户必须能够如何使用产品。
3. `machineGuide.md` 定义 agent 或脚本必须如何通过代码检查、修改、测试和驱动产品。

If code conflicts with these documents, the documents are correct and the code is incomplete.

如果代码与这些文档冲突，以文档为准，代码视为未完成。

## Product Scope / 产品范围
Required scope:

必需范围：

- Multi-page comic and manga project editing.
- Panel-based page layout.
- The visible comic page sits inside a larger editing workspace.
- Each panel binds directly to one source image file.
- A panel displays a cropped portion of its bound source image, not a scaled copy of the whole image.
- When a panel with an image is selected, the bound source image must become visible beyond the mask and the currently cut region must remain highlighted.
- While that panel stays selected, the user must be able to drag the image to pan and use the mouse wheel to zoom the visible crop.
- Dragging or zooming the bound image must not change the panel's own stage position.
- Workspace zoom must be controlled by a continuous slider, with 100% meaning the fit-to-workspace baseline.
- 工作区缩放必须由连续滑杆控制，其中 100% 表示适配工作区的基准比例。
- When that panel is unselected, it must return to normal clipped panel rendering.
拖拽或缩放绑定图片时，不能改变分镜本身在 stage 中的位置。
- Panels must support polygons and user-adjustable vertex count.
- Objects and panel vertices may extend outside the comic page as long as they remain inside the editing workspace.
- Text boxes must support both horizontal and vertical text layout.
- The interface must provide font family and font size controls in a Home-tab style editing area.
- The UI and the governing documents must support Chinese and English.
- All major GUI actions must have command/API parity.

- 支持多页漫画项目编辑。
- 支持以分镜为基础的页面布局。
- 可见漫画页面必须位于更大的编辑工作区之中。
- 每个分镜都直接绑定一张源图片文件。
- 分镜显示的是其绑定源图的一部分裁切结果，而不是整张图的缩放副本。
- 当带图分镜被选中时，必须显示其绑定原图在遮罩之外的部分，并高亮当前被分镜切出的区域。
- 只要该分镜保持选中，用户就必须能通过拖拽图片来平移，通过鼠标滚轮来缩放当前可见裁切范围。
- 当该分镜取消选中时，必须恢复为普通的分镜裁切显示。
- 分镜必须支持多边形，并允许用户调整顶点数量。
- 对象和分镜顶点可以越出漫画页边界，但必须仍然留在编辑工作区内。
- 文本框必须同时支持横排和竖排。
- 界面必须提供类似 Home Tab 的字体和字号编辑区。
- UI 和三份根文档都必须同时支持中文与英文。
- 所有主要 GUI 操作都必须具备命令/API 对齐。

Non-goals:

非目标：

- Full raster painting.
- Photoshop-class image editing.
- Illustration tooling unrelated to comic-page assembly.

- 完整位图绘画。
- Photoshop 级图像编辑。
- 与漫画排版无关的高级绘图功能。

## Required Functional Areas / 必需功能区
Project and page / 项目与页面：

- Create, rename, load, autosave, and reset projects.
- Add, duplicate, remove, reorder, and select pages.
- Export page PNG and project PDF.

- 创建、重命名、加载、自动保存和重置项目。
- 添加、复制、删除、重排和切换页面。
- 导出页面 PNG 和项目 PDF。

Panel and image / 分镜与图片：

- Create, move, resize, delete, and style panels.
- Bind one image file to one panel image slot.
- Edit the visible image range through panel-local crop data.
- Selecting a panel with an image must reveal the bound source image layer, highlight the active cut region, and allow direct drag-and-wheel adjustment.
- Direct image adjustment must not move the panel itself.
直接调整图片时，不能把分镜本身一起移动。
- Support polygon panels with editable vertices.

- 创建、移动、缩放、删除并设置分镜样式。
- 每个分镜图片槽都绑定一张图片文件。
- 通过分镜本地裁切数据编辑可见图像范围。
- 选中带图分镜时，必须显示绑定原图图层、高亮当前切出区域，并支持直接拖拽与滚轮调整。
- 支持可编辑顶点的多边形分镜。

Text and bubble / 文字与气泡：

- Create, edit, move, resize, and delete text boxes.
- Support horizontal and vertical text.
- Support font family, font size, and color selection.
- Create, edit, move, resize, and delete speech bubbles.

- 创建、编辑、移动、缩放和删除文本框。
- 支持横排和竖排文字。
- 支持字体、字号和颜色选择。
- 创建、编辑、移动、缩放和删除气泡。

System and automation / 系统与自动化：

- Undo and redo.
- Shared command model for GUI, tests, and automation.
- Local automation API for programmatic control.
- Chinese/English interface switching.

- 撤销与重做。
- GUI、测试和自动化共用同一套命令模型。
- 提供本地自动化 API 供程序控制。
- 支持中英文界面切换。

## Required UX Rules / 必需易用性规则
- A new user must be able to create a project, add a page, add a panel, import an image, add dialogue, and export without external help.
- The canvas must fit on screen without requiring scroll bars for the default full-page view.
- The comic page must not fill the entire canvas; it must remain centered inside a visibly larger workspace.
- The zoom UI must be a continuous slider rather than discrete presets.
- 缩放界面必须是连续滑杆，而不是离散预设。
- The primary workflow must stay visible and low-friction.
- Advanced controls may exist, but basic page assembly must remain obvious.
- The product must prefer clarity over feature density.

- 新用户必须能在无需外部帮助的情况下完成创建项目、添加页面、添加分镜、导入图片、加入对白和导出。
- 默认全页视图下，画布必须无需滚动条即可看全当前页面。
- 漫画页面不能填满整个画布；它必须居中放在一个明显更大的工作区中。
- 主流程必须保持可见且低摩擦。
- 可以有高级控制，但基础页面装配流程必须一眼可懂。
- 产品必须优先追求清晰，而不是堆功能。

## Required Engineering Rules / 必需工程规则
- Product behavior must be command-backed.
- Domain schema, commands, UI, automation API, tests, and docs must stay aligned.
- New features are incomplete until covered by tests.
- Documentation changes are mandatory whenever behavior changes.
- A feature is not complete if only the GUI works or only the automation path works.

- 产品行为必须由命令层驱动。
- 领域模型、命令、UI、自动化 API、测试和文档必须保持一致。
- 新功能在被测试覆盖前都不算完成。
- 任何行为变化都必须同步更新文档。
- 只有 GUI 可用或只有自动化路径可用，都不算功能完成。

## Acceptance Standard / 验收标准
The project is acceptable only if all of the following are true:

项目只有在以下条件全部成立时才算可接受：

- The code matches `README.md`, `操作指南.md`, and `machineGuide.md`.
- A human can complete the workflow defined in `操作指南.md`.
- An agent can operate and validate the project as defined in `machineGuide.md`.
- The command layer exposes the same core actions that the GUI exposes.
- Tests verify the claimed behavior.

- 代码与 `README.md`、`操作指南.md` 和 `machineGuide.md` 一致。
- 人类用户可以完成 `操作指南.md` 定义的流程。
- Agent 可以按 `machineGuide.md` 的定义操作和验证项目。
- 命令层暴露的核心行为与 GUI 暴露的核心行为一致。
- 测试验证了项目声称具备的行为。

## Status / 当前状态
Snapshot date: March 15, 2026.

快照日期：2026 年 3 月 15 日。

Current status:

当前状态：

- The required scope in this document is implemented in the current repository state.
- Crop-based panel images, selection-driven source-image preview, polygon vertex editing, fit-to-view canvas behavior, a continuous zoom slider, Home-tab font controls, vertical text, export, autosave, automation API, and bilingual UI are present.
- 当前已具备基于裁切的分镜图片、选中驱动的原图预览、多边形顶点编辑、适配视图画布行为、连续缩放滑杆、Home Tab 字体控制、竖排文字、导出、自动保存、自动化 API 和双语界面。
- The page renders inside a larger workspace, with margins around the page and support for moving objects beyond the page edge while staying in the workspace.
- Validation currently passes with `npm test`, `npm run test:e2e`, and `npm run build`.

- 本文档要求的范围已在当前仓库状态中实现。
- 当前已具备基于裁切的分镜图片、选中即显示原图层的预览与拖拽/滚轮调整、多边形顶点编辑、全页适配画布、Home Tab 字体控制、竖排文字、导出、自动保存、自动化 API 和双语界面。
- 页面当前渲染在更大的工作区中，页面四周有留白，并支持对象越过页边但仍留在工作区内。
- 当前已通过 `npm test`、`npm run test:e2e` 和 `npm run build` 验证。

## Repository Map / 仓库结构
- `src/domain`: schema and pure helpers
- `src/commands`: shared command layer
- `src/state`: editor session state
- `src/ui`: human-facing interface
- `src/automation`: programmatic bridge
- `tests/commands`: command-layer truth tests
- `tests/e2e`: user-path and GUI truth tests

- `src/domain`：数据结构与纯函数辅助逻辑
- `src/commands`：共享命令层
- `src/state`：编辑器会话状态
- `src/ui`：面向人类的界面
- `src/automation`：程序化桥接
- `tests/commands`：命令层真值测试
- `tests/e2e`：用户路径与 GUI 真值测试

## Run / 运行
Web:

Web：
```bash
npm install
npm run dev
```

Desktop:

桌面：
```bash
npm run tauri dev
```

Validation:

验证：
```bash
npm test
npm run test:e2e
npm run build
```
