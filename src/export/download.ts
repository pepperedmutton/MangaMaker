export const downloadDataUrl = (fileName: string, dataUrl: string) => {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
};
