# MangaMaker

## Definition / 定义
MangaMaker is a comic and manga page editor for assembling source images into readable pages.

MangaMaker 是一个漫画页面编辑器，用于把源图片整理成可阅读的漫画页面。

## Constitutional Rule / 宪制规则
This project is governed by exactly four definition documents:

本项目只受以下四份定义文档约束：

1. `README.md`
2. `操作指南.md`
3. `machineGuide.md`
4. `testGuide.md`

First principle:
The software must correctly implement all four documents. Any code change, UX change, command change, schema change, automation change, or test change must preserve the correctness of these four documents, or update the documents first or in the same change.

第一原则：
软件必须正确实现这四份文档。任何代码、交互、命令、数据结构、自动化接口或测试的改动，都必须先保证这四份文档仍然正确，或在同一改动中同步更新文档。

Authority order:

优先级顺序：

1. `README.md` defines scope, required features, hard constraints, and acceptance criteria.
2. `操作指南.md` defines how a human must be able to use the product.
3. `machineGuide.md` defines how an agent or script must inspect, change, test, and drive the product through code.
4. `testGuide.md` defines what tests must be run and how functionality is verified via APIs after any change.

1. `README.md` 定义范围、必需功能、硬约束和验收标准。
2. `操作指南.md` 定义人类用户必须能够如何使用产品。
3. `machineGuide.md` 定义 agent 或脚本必须如何通过代码检查、修改、测试和驱动产品。
4. `testGuide.md` 定义改动后必须运行的测试以及如何通过 API 验证功能。

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
- While the user drags the selected panel image, the panel content must update live before mouse release.
- 当用户拖拽已选中分镜中的图片时，分镜内部内容必须在松开鼠标前实时更新。
- Dragging or zooming the bound image must not change the panel's own stage position.
- Dragging panel vertices or panel resize handles must reshape the panel without dragging the bound image's stage position along with it.
- When a selected panel or text box approaches or crosses the comic-page edge, the page boundary must remain visible above it as a dashed overlay.
- 拖拽分镜顶点或分镜尺寸手柄时，必须只改变分镜形状，不能把绑定图片在 stage 中的位置一起带走。
- 拖拽或缩放绑定图片时，不能改变分镜本身在 stage 中的位置。
- 当已选中的分镜或文本框接近或越过漫画页面边界时，页面边界必须以虚线覆盖的方式显示在对象上方。
- Selecting a panel must not cause the workspace itself to resize, and a selected panel must remain movable.
- 选中分镜时，workspace 本身不能突然变大或重排，并且分镜在选中后仍然必须可以移动。
- Workspace zoom must be controlled by a continuous slider, with 100% meaning the fit-to-workspace baseline.
- The top ribbon must include a page background color control for the current page.
- 工作区缩放必须由连续滑杆控制，其中 100% 表示适配工作区的基准比例。
- 顶部 ribbon 必须包含当前页面的背景颜色控制。
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
- UI 和四份根文档都必须同时支持中文与英文。
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
- Change page background color from the ribbon.
- Export page PNG and project PDF.

- 创建、重命名、加载、自动保存和重置项目。
- 添加、复制、删除、重排和切换页面。
- 可以直接在 ribbon 中修改页面背景色。
- 导出页面 PNG 和项目 PDF。

Panel and image / 分镜与图片：

- Create, move, resize, delete, and style panels.
- Bind one image file to one panel image slot.
- Edit the visible image range through panel-local crop data.
- **Panel Selection Behavior**: Clicking a panel selects it. Double-clicking also selects it.
- **Panel Drag Behavior**: 
  - For panels without an image: Left-click-drag moves the panel. The panel is NOT auto-selected after the drag ends.
  - For panels with an image: Left-click-drag on the panel border/edge moves the panel. The panel is NOT auto-selected after the drag ends.
- **Selected Panel with Image Behavior**:
  - When a panel with an image is selected, the full source image becomes visible (semi-transparent) outside the panel mask.
  - Left-click-drag on the semi-transparent image pans the image crop region (adjusts which part of the image is visible inside the panel).
  - Mouse wheel zooms the image crop region.
  - The panel itself does NOT move during image drag.
  - The panel border/edge can still be dragged to move the panel position.
- **Drag-to-Select Prevention**: When a drag operation ends, the dragged object must NOT be auto-selected. Selection only occurs on a pure click without drag.
- Right-clicking the canvas must open a custom context menu, suppress the browser default menu, and expose object-appropriate shortcut actions.
- 在画布中右键点击时，必须打开自定义右键菜单、屏蔽浏览器默认菜单，并提供与当前对象对应的快捷操作。
- Support polygon panels with editable vertices.
- **Vertex Drag Live Preview**: Dragging a panel vertex must immediately reshape the panel in real-time before mouse release.

- 创建、移动、缩放、删除并设置分镜样式。
- **顶点拖拽实时预览**：拖拽分镜顶点时，必须在松开鼠标前即时显示分镜形状变化。
- 每个分镜图片槽都绑定一张图片文件。
- 通过分镜本地裁切数据编辑可见图像范围。
- **分镜选中行为**：点击分镜会选中它。双击也会选中它。
- **分镜拖拽行为**：
  - 无图片分镜：左键拖拽移动分镜。拖拽结束后不会自动选中该分镜。
  - 有图片分镜：左键拖拽分镜边框/边缘移动分镜。拖拽结束后不会自动选中该分镜。
- **带图分镜选中后的行为**：
  - 选中带图分镜时，完整的源图（半透明）会在分镜遮罩外显示。
  - 在半透明图片上左键拖拽会平移图片裁切区域（调整分镜内可见的图片部分）。
  - 鼠标滚轮缩放图片裁切区域。
  - 拖拽图片时，分镜本身不会移动。
  - 仍然可以拖拽分镜边框/边缘来移动分镜位置。
- **拖拽防选中机制**：拖拽操作结束时，被拖拽的对象不得自动被选中。选中仅在纯点击（无拖拽）时发生。
- 支持可编辑顶点的多边形分镜。

Text and bubble / 文字与气泡：

- Create, edit, move, resize, and delete text boxes.
- Support horizontal and vertical text.
- Support font family, font size, color, text alignment, and vertical alignment selection.
- Text formatting controls (font, size, direction, alignment) appear in the right sidebar Inspector when a text object is selected.
- Create, edit, move, resize, and delete speech bubbles.
- **Ten bubble types** with unique adjustable features:
  - **round**: Rounded rectangle with adjustable corner radius
  - **ellipse**: Standard ellipse
  - **cloud**: Puffy cloud shape with adjustable bumpiness
  - **square**: Simple rectangle
  - **roundedSquare**: Square with larger adjustable corner radius
  - **oval**: Tall oval shape
  - **explosion**: Starburst shape with adjustable spike count and depth
  - **thought**: Cloud shape with trailing circles (adjustable count)
  - **jagged**: Sharp zigzag edges with adjustable jaggedness
  - **circle**: Perfect circle
- **Arrow/Tail Control**: Draggable tail tip to point at speaker; adjustable tail width and angle (0-360 degrees)
- **Type-specific controls** in right sidebar Inspector:
  - Corner radius (round, roundedSquare)
  - Bumpiness (cloud)
  - Spike count & depth (explosion)
  - Jaggedness (jagged)
  - Thought circles (thought)
  - Tail width (all types)
  - Border width, background color, border color (all types)

- 创建、编辑、移动、缩放和删除文本框。
- 支持横排和竖排文字。
- 支持字体、字号、颜色、文字对齐和垂直对齐选择。
- 选中文字对象时，文字格式控制（字体、字号、方向、对齐）显示在右侧边栏 Inspector 中。
- 创建、编辑、移动、缩放和删除气泡。
- **十种气泡类型**，每种都有独特的可调节属性：
  - **圆角矩形**：可调节圆角半径
  - **椭圆**：标准椭圆
  - **云朵**：蓬松云朵形状，可调节凹凸度
  - **方形**：简单矩形
  - **大圆角方形**：方形带更大的可调节圆角半径
  - **长椭圆**：长高椭圆形状
  - **爆炸形**：星爆形状，可调节尖刺数量和深度
  - **思考气泡**：云朵形状带尾随小圆圈（可调节数量）
  - **锯齿形**：尖锐锯齿边缘，可调节锯齿度
  - **圆形**：完美圆形
- **箭头/尾巴控制**：可拖拽尾巴端点指向说话者；可调节尾巴宽度和角度（0-360度）
- **类型特定控制**显示在右侧边栏 Inspector：
  - 圆角半径（圆角矩形、大圆角方形）
  - 凹凸度（云朵）
  - 尖刺数量和深度（爆炸形）
  - 锯齿度（锯齿形）
  - 思考圆圈数（思考气泡）
  - 尾巴宽度（所有类型）
  - 边框宽度、背景颜色、边框颜色（所有类型）

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
- The comic page must not fill the entire canvas; it must remain centered inside a visibly larger workspace (4x page area).
- The zoom UI must be a continuous slider rather than discrete presets.
- The comic-page boundary must be readable above selected overlapping content via a dashed overlay.
- 缩放界面必须是连续滑杆，而不是离散预设。
- 当已选中的文本框或分镜压到漫画页面边界时，页面边界必须通过虚线覆盖保持清晰可读。
- The workspace frame must stay inside the editing surface at every zoom level; zoom changes the rendered content inside that frame instead of stretching the workspace beyond it.
- Next-step guidance must live in the inspector or side panels, not in a banner above the workspace.
- workspace 外框在任何缩放级别下都必须保持在编辑区域内；缩放只能改变其中内容的渲染比例，不能把 workspace 本身拉出操作区。
- “下一步”提示必须放在 inspector 或侧边区域中，不能再占用 workspace 上方空间。
- The canvas context menu must feel immediate, context-sensitive, and must replace the browser default menu inside the editing surface.
- 画布右键菜单必须即时出现、随对象类型变化，并在编辑区域内取代浏览器默认右键菜单。
- Crossing 100% on the zoom slider must remain continuous; it must scale the rendered workspace without suddenly resizing the editing surface itself.
- 缩放滑杆跨过 100% 时必须保持连续；它只能改变渲染比例，不能让编辑区域本身突然变大。
- The primary workflow must stay visible and low-friction.
- Advanced controls may exist, but basic page assembly must remain obvious.
- The product must prefer clarity over feature density.

- 新用户必须能在无需外部帮助的情况下完成创建项目、添加页面、添加分镜、导入图片、加入对白和导出。
- 默认全页视图下，画布必须无需滚动条即可看全当前页面。
- 漫画页面不能填满整个画布；它必须居中放在一个明显更大的工作区中（面积为页面的 4 倍）。
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

- The code matches `README.md`, `操作指南.md`, `machineGuide.md`, and `testGuide.md`.
- A human can complete the workflow defined in `操作指南.md`.
- An agent can operate and validate the project as defined in `machineGuide.md` and `testGuide.md`.
- The command layer exposes the same core actions that the GUI exposes.
- Tests verify the claimed behavior.

- 代码与 `README.md`、`操作指南.md`、`machineGuide.md` 和 `testGuide.md` 一致。
- 人类用户可以完成 `操作指南.md` 定义的流程。
- Agent 可以按 `machineGuide.md` 和 `testGuide.md` 的定义操作和验证项目。
- 命令层暴露的核心行为与 GUI 暴露的核心行为一致。
- 测试验证了项目声称具备的行为。

## Status / 当前状态
Snapshot date: March 15, 2026.

快照日期：2026 年 3 月 15 日。

Current status:

当前状态：

- The required scope in this document is implemented in the current repository state.
- Crop-based panel images, selection-driven source-image preview, live in-panel image dragging feedback, polygon vertex editing that keeps the image stage position stable, fit-to-view canvas behavior, a continuous zoom slider, Home-tab font controls, vertical text, export, autosave, automation API, and bilingual UI are present.
- Page-boundary dashed overlays for selected overlapping content and ribbon-based page background color controls are present.
- A custom canvas context menu is present and replaces the browser default menu inside the editing surface.
- 当前已具备页面边界虚线覆盖提示与 ribbon 页面背景色控制。
- 当前已具备自定义右键菜单，并会在画布区域屏蔽浏览器默认右键菜单。
- 当前已具备基于裁切的分镜图片、选中驱动的原图预览、分镜内实时拖图反馈、保持图片 stage 位置稳定的多边形顶点编辑、适配视图画布行为、连续缩放滑杆、Home Tab 字体控制、竖排文字、导出、自动保存、自动化 API 和双语界面。
- 当前已具备基于裁切的分镜图片、选中驱动的原图预览、多边形顶点编辑、适配视图画布行为、连续缩放滑杆、Home Tab 字体控制、竖排文字、导出、自动保存、自动化 API 和双语界面。
- The page renders inside a larger workspace (4x page area), with margins around the page and support for moving objects beyond the page edge while staying in the workspace.
- Validation currently passes with `npm test`, `npm run test:e2e`, and `npm run build`.

- 本文档要求的范围已在当前仓库状态中实现。
- 当前已具备基于裁切的分镜图片、选中即显示原图层的预览与拖拽/滚轮调整、多边形顶点编辑、全页适配画布、Home Tab 字体控制、竖排文字、导出、自动保存、自动化 API 和双语界面。
- 页面当前渲染在更大的工作区中（面积为页面的 4 倍），页面四周有留白，并支持对象越过页边但仍留在工作区内。
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
