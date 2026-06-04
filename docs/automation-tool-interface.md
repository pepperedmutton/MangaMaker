# MangaMaker Automation Tool Interface

This document is the current contract for external agents and automation scripts that inspect or edit a running MangaMaker project. It is especially important for batch text insertion and speech-bubble placement.

## Entry Points

Use the in-app automation bridge after the app has loaded:

```ts
window.mangaMaker.commands.list()
window.mangaMaker.commands.describe()
window.mangaMaker.commands.execute(commandId, payload)
window.mangaMaker.project.get()
window.mangaMaker.project.load(project)
window.mangaMaker.project.reset()
window.mangaMaker.project.exportAllPages({ format: "jpgZip" })
window.mangaMaker.session.get()
window.mangaMaker.agent.getDebugSnapshot()
```

`commands.describe()` is the first thing an external agent should read. It returns the command ids, input JSON schemas, danger level, GUI equivalent, and examples generated from the current command registry.

## Core Rules

- Do not write directly into `projects/*/project.json` for page edits. Use `window.mangaMaker.commands.execute()` and then run `saveProject` or `goHome`.
- If a project JSON must be loaded from an external source, pass it through `window.mangaMaker.project.load(project)`. That path applies current migrations before schema validation.
- Dialogue, captions, and narration text are always `text` objects. Bubbles are shape containers and do not own dialogue text.
- Do not add `bubble.text`, `bubble.fontSize`, `bubble.fontFamily`, `bubble.direction`, `bubble.textAlign`, or `bubble.verticalAlign` to new bubbles. Those fields are legacy migration inputs only.
- Do not emit legacy bubble `style` objects. Use `updateBubble` fields such as `backgroundColor`, `strokeColor`, `strokeWidth`, `opacity`, `cornerRadius`, `tailTip`, `tailBase`, and `tailWidth`.
- Do not use `bubbleType: "narration"` in new automation output. It is accepted only as a legacy load-time alias and migrates to `caption`.

## Live Project Updates

Preferred live path: if the agent can run JavaScript in the open editor, use
`window.mangaMaker.commands.execute("updateText", ...)` or other command APIs.
Those commands update the React/Zustand editor state immediately. Call
`saveProject` after the batch so the same state is persisted.

External API path: if the agent runs outside the browser and has to submit a
full updated project JSON, do not write `projects/*/project.json` directly.
Send the full project through the web persistence API instead:

```ts
await fetch("/__mangamaker__/persistence/write_project_draft", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    project_id: project.id,
    project_title: project.title,
    project_json: JSON.stringify(project),
  }),
});
```

The open editor subscribes to `GET /__mangamaker__/persistence/events`. When the
write targets the project already open in the editor, MangaMaker reloads that
project data in place. The selected page, zoom, and canvas position are
preserved, so updated text appears without refresh, reopening, or moving the
viewed page.

If an agent already has an updated project object inside the browser, call
`window.mangaMaker.project.load(project)`. For the currently open project, this
also applies the new project data without switching the viewed page.

After either path, verify through the live editor state:

```ts
const project = window.mangaMaker.project.get();
const session = window.mangaMaker.session.get();
```

## Text Insertion

`createText` creates one text box and accepts only:

```ts
await window.mangaMaker.commands.execute("createText", {
  pageId,
  x,
  y,
  content: "Text to render",
});
```

Use `updateText` immediately after creation when you need geometry or typography:

```ts
const text = await window.mangaMaker.commands.execute("createText", {
  pageId,
  x: 80,
  y: 60,
  content: "Narration or dialogue",
});

await window.mangaMaker.commands.execute("updateText", {
  pageId,
  textId: text.id,
  width: 1040,
  height: 220,
  fontSize: 40,
  fontWeight: 700,
  direction: "horizontal",
  textAlign: "center",
  verticalAlign: "middle",
});
```

New text defaults to vertical layout. Set `direction: "horizontal"` explicitly for caption strips or horizontal dialogue.

## Bubble Insertion

Valid `bubbleType` values are:

```ts
round
ellipse
cloud
square
roundedSquare
oval
explosion
thought
jagged
bubbleRound
whisper
scream
burstSoft
hexagon
octagon
diamond
heart
bracket
caption
speed
cloudDense
balloonTall
balloonWide
wave
rough
droplet
arrow
pinched
doubleOutline
electric
custom
```

For narration or caption panels, use `caption` or `roundedSquare` with `showTail: false`:

```ts
const bubble = await window.mangaMaker.commands.execute("createBubble", {
  pageId,
  x: 40,
  y: 40,
  width: 1120,
  height: 260,
  bubbleType: "caption",
  showTail: false,
});

await window.mangaMaker.commands.execute("updateBubble", {
  pageId,
  bubbleId: bubble.id,
  backgroundColor: "rgba(255, 255, 255, 0.82)",
  strokeColor: "transparent",
  strokeWidth: 0,
  opacity: 1,
});
```

For ordinary speech, create the bubble and text as separate objects. The layer order should normally put the bubble below the text. Command-created objects are appended to `page.layers`; if the order is wrong, use `moveLayer`.

## Export All Project Pages

Use this explicit API when an external agent needs every page in the current project:

```ts
const artifact = await window.mangaMaker.project.exportAllPages({
  format: "jpgZip",
});
```

This is equivalent to:

```ts
const artifact = await window.mangaMaker.commands.execute("exportProjectAllPages", {
  format: "jpgZip",
});
```

`format` is optional and defaults to `jpgZip`.

- `jpgZip`: exports every project page as an individual JPG file inside one ZIP artifact.
- `pdf`: exports every project page into one PDF artifact.

The returned artifact is data only; the API does not automatically download a file:

```ts
{
  kind: "jpgZip" | "pdf",
  fileName: string,
  dataUrl: string,
  pageCount: number,
}
```

Use `exportPagePng` only for one specific page. Use `exportProjectAllPages` or `project.exportAllPages()` when the requirement is all project pages.

## Save And Verify

After a batch insertion:

```ts
await window.mangaMaker.commands.execute("saveProject", {});
const project = window.mangaMaker.project.get();
const session = window.mangaMaker.session.get();
```

Verify:

- The target page has the expected `texts`, `bubbles`, and `layers`.
- Each text object has valid `content`, positive `width`/`height`, valid `direction`, and a supported font family.
- Each bubble has a valid `bubbleType`, positive `width`/`height`, `contentCenter`, and `tailTip`.
- Home still lists the project after `saveProject` or `goHome`.

## Chinese Summary / 中文摘要

- 外部 Agent 不要直接改 `project.json`，优先调用 `window.mangaMaker.commands.execute()`。
- 插入文字用 `createText`，尺寸、字体、方向、对齐用 `updateText`。
- 插入气泡用 `createBubble`，样式用 `updateBubble`。
- 文字和气泡是两个对象；对白/旁白文字不要写进 bubble 字段。
- 旁白框不要用 `bubbleType: "narration"`，应使用 `caption` 或 `roundedSquare`，并设置 `showTail: false`。
- 新写入的气泡不要使用旧 `style` 字段；使用 `backgroundColor`、`strokeColor`、`strokeWidth`、`opacity` 等当前字段。
- 导出所有页面用 `window.mangaMaker.project.exportAllPages({ format: "jpgZip" })` 或 `commands.execute("exportProjectAllPages", { format: "jpgZip" })`；`exportPagePng` 只导出单页。
