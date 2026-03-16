# Test Guide / 测试规范

This document defines the testing rules and manual/automated testing procedures that must be executed after any modification to MangaMaker.

本文档定义了在对 MangaMaker 进行任何修改后，必须执行的测试规则和手动/自动化测试流程。

## 1. Constitutional Status / 宪制地位
This is the fourth governing document of the MangaMaker project.
The project is governed by exactly four documents:

1. `README.md`
2. `操作指南.md`
3. `machineGuide.md`
4. `testGuide.md`

这是 MangaMaker 项目的第四份宪制文档。
本项目只受以下四份文档约束，必须严格遵从：

1. `README.md`
2. `操作指南.md`
3. `machineGuide.md`
4. `testGuide.md`

## 2. Testing Requirements / 测试要求

After any code change, the following verifications MUST be performed:

任何代码修改后，都必须执行以下验证：

### 2.1 Automated Tests / 自动化测试
You must run and pass all automated tests:

必须运行并使得所有自动化测试通过：

```bash
# 1. Unit & Command Layer Tests / 单元与命令层测试
npm test

# 2. End-to-End GUI Tests / 端到端 GUI 测试
npm run test:e2e

# 3. Build Verification / 构建验证
npm run build
```

### 2.2 API Interface Testing / API 接口调试测试
Every feature and user operation modified **must** be debugged and tested using the API interface exposed via `window.mangaMaker`. 

对所有功能和用户操作的修改，必须使用通过 `window.mangaMaker` 暴露的 API 接口进行调试和测试。

When implementing a new feature or fixing a bug, you must:
1. Identify the corresponding command in `src/commands`.
2. Ensure the command works flawlessly via `window.mangaMaker.commands.execute()`.
3. Verify the state changes correctly via `window.mangaMaker.session.get()` and `window.mangaMaker.project.get()`.

### 2.3 Manual GUI Testing / 手动 GUI 测试
If the change affects human interaction, the following steps must be manually verified (or verified via E2E tests simulating these actions):

如果改动影响到人类交互，必须（手动或通过模拟 E2E 测试）验证以下步骤：

1. **Project & Page**: Creating a new project, adding/deleting pages, and changing page backgrounds.
2. **Panels**: Creating polygon panels, moving vertices, and ensuring panels outside the main page edge behave correctly within the workspace. When dragging a panel vertex, the panel shape must update live before mouse release.
3. **Panel Drag Behavior**: 
   - Dragging a panel must move it without auto-selecting it after the drag ends.
   - The selection state must remain unchanged after a drag operation.
   - A pure click must select the panel.
4. **Image Cropping**: Binding an image to a panel. Dragging and zooming the image must update the visible crop **live** without moving the panel itself.
5. **Selected Panel with Image**:
   - Left-drag on the semi-transparent image must pan the crop region.
   - Left-drag on the panel border must move the panel.
   - The panel must not move during image crop panning.
6. **Text**: Adding text, switching between horizontal/vertical directions, setting horizontal alignment (left/center/right), setting vertical alignment (top/middle/bottom), and applying font changes from the Inspector sidebar.
7. **Bubble**: Adding bubbles, setting text alignment, and applying font changes from the Inspector sidebar.
7. **Context Menus**: Right-clicking on objects must bring up custom custom menus, suppressing the default browser menu.
8. **Zooming**: Using the continuous zoom slider must smoothly scale the workspace, without suddenly resizing the canvas window boundaries.

## 3. Reporting / 报告
If any test fails, the modification is considered **incomplete** and must be reverted or fixed prior to acceptance. 

如果任何测试失败，该修改被视为**未完成**，在验收前必须修复或回滚。
