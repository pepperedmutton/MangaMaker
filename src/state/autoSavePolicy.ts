const MAJOR_AUTO_SAVE_COMMAND_IDS = new Set([
  "createProject",
  "setProjectType",
  "renameProject",
  "addPage",
  "duplicatePage",
  "removePage",
  "reorderPage",
  "setPageBackground",
  "pasteClipboardItem",
  "createPanel",
  "placeImageInPanel",
  "createText",
  "createBubble",
  "createElement",
  "deleteObject",
  "groupSelection",
  "ungroupSelection",
]);

export const shouldAutoSaveAfterCommand = (commandId: string) =>
  MAJOR_AUTO_SAVE_COMMAND_IDS.has(commandId);

