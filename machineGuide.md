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

- Do not implement code that contradicts these files.
- If behavior changes, update the documents first or in the same change.
- `README.md` is the highest-priority contract.

- 不要实现与这四份文件冲突的代码。
- 如果行为变化，必须先更新文档，或在同一改动中同步更新。
- `README.md` 是最高优先级契约。

## 2. Required Agent Workflow / 必需 Agent 工作流
For any meaningful change, an agent must:

对于任何有意义的改动，agent 必须：

1. Read the four definition documents.
2. Inspect current code before making assumptions.
3. Update the shared command/domain layer first when behavior changes.
4. Update the UI and automation path so they stay aligned.
5. Add or repair tests for every claimed feature.
6. Run validation commands when possible.
7. Report any remaining gap between code and spec explicitly.

1. 阅读四份定义文档。
2. 在做假设前先检查当前代码。
3. 当行为变化时，优先更新共享命令层和领域层。
4. 同步更新 UI 和自动化路径，保持一致。
5. 为每个声称实现的功能新增或修复测试。
6. 在可能的情况下执行验证命令。
7. 明确报告代码与规格之间仍然存在的差距。

## 3. Required System Surfaces / 必需系统层面
An agent must treat these layers as one system:

agent 必须把下列层面视为一个系统：

- `src/domain`: source of schema and pure behavior
- `src/commands`: public command surface
- `src/state`: session and history behavior
- `src/ui`: human-facing behavior
- `src/automation/api.ts`: machine-facing browser bridge
- `tests/commands`: command truth tests
- `tests/e2e`: GUI and user-path truth tests

- `src/domain`：数据结构和纯行为逻辑
- `src/commands`：公开命令面
- `src/state`：会话与历史行为
- `src/ui`：面向人类的行为
- `src/automation/api.ts`：面向机器的浏览器桥
- `tests/commands`：命令真值测试
- `tests/e2e`：GUI 与用户路径真值测试

No important feature should exist in only one of these layers.

重要功能不能只存在于其中某一个层面。

## 4. Command Parity Rule / 命令对齐规则
Every important GUI action must map to a command.

每个重要 GUI 行为都必须映射到命令。

Required examples:

必需示例：

- project creation and rename
- page add/duplicate/remove/reorder/select
- page background color change
- 页面背景色修改
- panel create/move/resize/delete
- panel image bind and selection-driven crop adjustment
- polygon vertex editing
- movement and resizing inside a larger workspace around the page
- continuous workspace zoom through the shared `setZoom` command
- 通过共享 `setZoom` 命令实现连续工作区缩放
- text create/update/move/resize/direction/font/alignment
- bubble create/update/delete/font/alignment
- bubble resize handles: corner handles scale two axes, edge-midpoint handles scale one axis
- undo/redo
- save/load
- export
- locale switch

- 项目创建与重命名
- 页面新增、复制、删除、重排和切换
- 分镜创建、移动、缩放和删除
- 分镜图片绑定与基于选中的裁切调整
- 多边形顶点编辑
- 页面外侧更大工作区内的移动与缩放
- 文字创建、更新、移动、缩放、方向、字体和对齐控制
- 气泡创建、更新、字体、对齐、气泡类型、边框宽度、背景颜色、边框颜色控制
- 气泡尾巴控制（位置、角度、宽度）
- 爆炸气泡：每个尖刺可单独拖拽调节深度
- 缩放控制：四角控制点双轴缩放，四边中点控制点单轴拉伸/压缩
- 类型特定控制：圆角半径、凹凸度、尖刺数量和深度、锯齿度、思考圆圈数
- 撤销与重做
- 保存与加载
- 导出
- 语言切换

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

## 6. Test Strategy Rule / 测试策略规则
Agents must test the claimed behavior, not just isolated functions.

agent 必须测试被声称的行为，而不只是孤立函数。

Guidance:

执行原则：

- Use `tests/commands` to verify command truth, invariants, and state transitions.
- Use `tests/e2e` to verify user-visible GUI behavior.
- End-to-end tests may seed baseline project state through the automation API when canvas event synthesis is not the behavior under test; the GUI behavior being claimed must still be exercised through visible GUI controls.
- Tests must verify that objects can remain inside the larger workspace even when they move beyond the comic page edge.
- Tests must verify that when selected panel/text content overlaps the comic-page edge, the dashed page boundary remains visually readable above that content.
- 测试还必须验证：当已选中的分镜或文本框压到漫画页面边界时，页面边界虚线仍然会清晰地显示在对象上方。
- Tests for panel images must verify that selecting a panel reveals the bound source image layer, that drag and wheel update the crop, and that clearing selection returns the panel to normal clipped rendering.
- Tests for panel images must also verify that dragging the image never changes the panel's own stage position.
- Tests for panel images must also verify that the clipped panel content updates live during image drag before `dragEnd`.
- Tests for panel geometry edits must verify that moving panel vertices or resize handles does not drag the bound image to a different stage position.
- Tests for bubble resize handles must verify: corner handles resize width and height together, while edge-midpoint handles resize only one axis.
- **Tests for panel vertex drag must verify**: Dragging a panel vertex updates the panel shape live before `dragEnd`; the visual feedback must be immediate.
- **Tests for panel drag behavior must verify**:
  - Dragging a panel (mouse down, move, mouse up) moves the panel but does NOT auto-select it.
  - The selection state before the drag must remain unchanged after the drag ends.
  - A pure click (without drag) must select the clicked panel.
- **Tests for selected panel with image must verify**:
  - Left-drag on the semi-transparent image pans the crop region.
  - Left-drag on the panel border moves the panel.
  - The panel position remains unchanged during image crop panning.
- 分镜图片测试还必须验证：在 `dragEnd` 之前，分镜内部的裁切图像就已经随拖拽实时更新。
- 分镜几何编辑测试还必须验证：拖拽分镜顶点或尺寸手柄时，不能把绑定图片拖到不同的 stage 位置。
- **分镜顶点拖拽测试还必须验证**：拖拽分镜顶点时，在 `dragEnd` 之前分镜形状就已经实时更新；视觉反馈必须是即时的。
- Tests for zoom must verify that the ribbon exposes a continuous slider, that changing it updates session zoom, and that the visible canvas size responds accordingly.
- Tests for page background must verify that the ribbon control updates the current page background through the shared command layer.
- Tests for the canvas context menu must verify that right-clicking a panel opens the custom menu, exposes panel shortcut actions, and suppresses the browser default context menu.
- Tests for panel selection must verify that selecting a panel does not resize the editing surface and that the selected panel remains movable.
- Tests for zoom must also verify that crossing 100% changes rendered scale continuously without suddenly resizing the editing surface itself.
- Tests for zoom must also verify that higher zoom levels do not let the workspace frame itself stretch outside the editing surface.
- Tests for layout must verify that next-step guidance remains available in the inspector without rendering a banner above the workspace.
- Command-layer tests must cover explosion bubble `updateBubble` payloads that set `spikePositions`, and assert the project state reflects those positions.
- 页面背景测试还必须验证：ribbon 中的背景色控件会通过共享命令层更新当前页面背景。
- 画布右键菜单测试还必须验证：右键点击分镜会打开自定义菜单、显示分镜快捷操作，并且阻止浏览器默认右键菜单。
- 分镜选中测试还必须验证：选中分镜不会让编辑区域重排变大，并且分镜在选中后仍然可以移动。
- 缩放测试还必须验证：跨过 100% 时缩放连续变化，而不是让编辑区域本身突然变大。
- 缩放测试还必须验证：较高缩放下 workspace 外框本身仍留在编辑区内，不会被拉出操作空间。
- 布局测试还必须验证：推荐下一步提示仍在 inspector 中可见，同时 workspace 上方不再渲染横幅。
- 缩放测试必须验证：ribbon 暴露的是连续滑杆，调整它会更新 session zoom，并让可见画布尺寸随之变化。
分镜图片测试还必须验证：拖拽图片绝不能改变分镜本身在 stage 中的位置。

- 用 `tests/commands` 验证命令真值、不变量和状态迁移。
- 用 `tests/e2e` 验证用户可见的 GUI 行为。
- 当测试目标不是 canvas 事件本身时，E2E 可以通过自动化 API 预置基础项目状态；但所声称的 GUI 行为仍然必须通过可见的 GUI 控件完成。
- 测试必须验证：对象即使越过漫画页面边缘，也仍能保留在更大的工作区中。
- 分镜图片测试必须验证：选中分镜会显示绑定原图图层，拖拽和滚轮会更新裁切，清除选中后会恢复普通的分镜裁切渲染。

## 7. Core Invariants / 核心不变量
Agents must preserve:

agent 必须保持以下不变量：

- A panel image is bound to the panel.
- Panel image display is crop-based, not whole-image scaling.
- Selecting a panel with an image reveals the bound source image layer and highlights the current cut region until selection clears.
- Adjusting the selected panel image must not move the panel itself in stage space.
- Dragging the selected panel image must update the panel's visible crop live before the drag ends.
- Changing panel vertices or panel size must not drag the bound image to a different stage position.
- **Drag-to-Move without Auto-Select**: 
  - Dragging a panel (mouse down, move, mouse up) must move the panel but must NOT auto-select it after the drag ends.
  - This applies to both panels with and without images.
  - Selection must only occur on a pure click without significant mouse movement.
- **Panel with Image - Drag Behavior**:
  - When a panel with image is selected, left-drag on the semi-transparent image pans the crop region.
  - Left-drag on the panel border/edge moves the panel itself.
  - Right-click always opens the context menu for the clicked panel.
- 拖拽已选中分镜中的图片时，分镜可见裁切必须在拖拽结束前实时更新。
- 改变分镜顶点或分镜尺寸时，不能把绑定图片拖到不同的 stage 位置。
调整选中分镜的图片时，不能让分镜本身在 stage 空间内发生位移。
- **拖拽移动不自动选中**：
  - 拖拽分镜（按下、移动、释放）必须移动分镜，但不得在拖拽结束后自动选中该分镜。
  - 此规则适用于有图和无图分镜。
  - 选中仅在纯点击（无显著鼠标移动）时发生。
- **带图分镜的拖拽行为**：
  - 带图分镜被选中时，在半透明图片上左键拖拽平移裁切区域。
  - 在分镜边框/边缘上左键拖拽移动分镜本身。
  - 右键点击始终打开被点击分镜的上下文菜单。
- Panel geometry supports polygons.
- The page renders inside a larger workspace (4x page area) rather than consuming the full canvas.
- Objects may leave the page bounds while remaining inside the workspace bounds.
- The default canvas view fits the page without scroll bars.
- The comic-page boundary stays readable above selected overlapping panel/text content via a dashed overlay.
- The current page background remains editable from the ribbon through a command-backed path.
- The editing surface uses a custom context menu and suppresses the browser default context menu.
- Selecting a panel does not resize the editing surface, and selected panels remain movable.
- Zooming across 100% remains continuous and does not suddenly resize the editing surface itself.
- The workspace frame stays inside the editing surface at every zoom level.
- The workspace area above the canvas stays free of onboarding banner text.
- 当已选中的分镜或文本框压到漫画页面边界时，页面边界必须通过虚线覆盖保持可读。
- 当前页面背景必须能通过 ribbon 中受命令层驱动的路径持续编辑。
- 编辑区域必须使用自定义右键菜单，并阻止浏览器默认右键菜单。
- 选中分镜时不能让编辑区域突然变大，并且分镜在选中后仍然必须可以移动。
- 缩放跨过 100% 时必须保持连续，不能让编辑区域本身突然变大。
- workspace 外框在任何缩放级别下都必须保持在编辑区域内。
- 画布上方的 workspace 区域必须保持干净，不能再渲染 onboarding 横幅文字。
- Workspace zoom remains continuously adjustable instead of being limited to discrete presets.
- 工作区缩放必须保持为连续可调，而不是退化回离散预设。
- Text supports horizontal and vertical layout.
- Text supports horizontal alignment (left/center/right) and vertical alignment (top/middle/bottom).
- Font controls (font family, size, direction, alignment) appear in the right sidebar Inspector when a text object is selected.
- Bubble supports font family, size, and alignment controls in the right sidebar Inspector.
- Font and typography controls are located in the Inspector sidebar, not in the ribbon.
- Chinese and English remain available.
- Undo/redo remains coherent after object edits.

- 分镜图片绑定在分镜本身上。
- 分镜图片显示基于裁切，而不是整图缩放。
- 选中带图分镜时，会显示绑定原图图层并高亮当前切出区域，直到选中被清除。
- 分镜几何支持多边形。
- 页面渲染在更大的工作区中（面积为页面的 4 倍），而不是占满整个画布。
- 对象可以离开页面边界，但仍必须留在工作区边界内。
- 默认画布视图无需滚动条即可看全页面。
- 文字支持横排与竖排。
- 文字支持水平对齐（左对齐/居中/右对齐）和垂直对齐（顶部/中部/底部）。
- 字体控制（字体、字号、方向、对齐）在选中文本对象时显示在右侧边栏 Inspector 中。
- 气泡支持在右侧边栏 Inspector 中调整字体、字号和对齐。
- 字体和排版控制位于 Inspector 侧边栏中，而不是 ribbon 中。
- 中文和英文始终可用。
- 对象编辑后的撤销/重做保持一致。

## 8. Validation / 验证
Preferred validation commands:

推荐验证命令：

```bash
npm test
npm run test:e2e
npm run build
```

If a command cannot be run, the agent must say so explicitly.

如果某条命令无法执行，agent 必须明确说明。

## 9. Spec Gap Reporting / 规格差距报告
If implementation does not satisfy the four documents, the agent must report:

如果实现尚未满足四份文档，agent 必须报告：

1. what is implemented
2. what is missing
3. what was verified
4. what still needs work

1. 已实现了什么
2. 还缺什么
3. 已验证了什么
4. 还需要继续做什么

An agent must not claim the project is complete if the documented contract is not implemented.

如果文档契约尚未实现，agent 不得声称项目已完成。
