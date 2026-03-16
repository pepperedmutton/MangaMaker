import { chromium, expect } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log("Navigating to http://localhost:5173/");
    await page.goto("http://localhost:5173/");
    
    // Wait for the window.mangaMaker API to be ready
    await page.waitForFunction(() => window.mangaMaker !== undefined);
    
    console.log("API loaded!");
    
    // Test 1: Add a page
    console.log("-> Executing 'addPage'");
    await page.evaluate(() => window.mangaMaker.commands.execute("addPage", {}));
    
    let project = await page.evaluate(() => window.mangaMaker.project.get());
    console.log("Pages count:", project.pages.length);
    let currentPageId = project.pages[0].id;

    // Test 2: Add a Panel
    console.log("-> Executing 'createPanel'");
    await page.evaluate((pageId) => {
      return window.mangaMaker.commands.execute("createPanel", {
        pageId,
        x: 100, y: 100, width: 200, height: 200
      });
    }, currentPageId);

    // Test 3: Add a Text Box
    console.log("-> Executing 'createText'");
    await page.evaluate((pageId) => {
      return window.mangaMaker.commands.execute("createText", {
        pageId,
        x: 50, y: 50, content: "Hello Manga!"
      });
    }, currentPageId);
    
    project = await page.evaluate(() => window.mangaMaker.project.get());
    const panel = project.pages.find(p => p.id === currentPageId).panels[0];
    const textbox = project.pages.find(p => p.id === currentPageId).texts[0];
    
    console.log("Panel created:", panel?.id);
    console.log("Text created:", textbox?.id);

    // Test 4: Move Panel
    console.log("-> Executing 'movePanel'");
    await page.evaluate(({pageId, panelId}) => {
      return window.mangaMaker.commands.execute("movePanel", {
        pageId,
        panelId,
        x: 150,
        y: 150
      });
    }, { pageId: currentPageId, panelId: panel.id });
    
    // Test 5: Update Text coords and Size
    console.log("-> Executing 'updateText'");
    await page.evaluate(({pageId, textId}) => {
      return window.mangaMaker.commands.execute("updateText", {
        pageId,
        textId,
        x: 60,
        y: 60,
        fontSize: 32
      });
    }, { pageId: currentPageId, textId: textbox.id });

    // Test 6: Verify State updates
    project = await page.evaluate(() => window.mangaMaker.project.get());
    const panelAfter = project.pages.find(p => p.id === currentPageId).panels[0];
    const textboxAfter = project.pages.find(p => p.id === currentPageId).texts[0];

    console.log("Panel moved dynamically to coordinates X:", panelAfter.x, "Y:", panelAfter.y);
    console.log("Text moved dynamically to coordinates X:", textboxAfter.x, "Y:", textboxAfter.y);

    // Test 7: Transform image inside panel (binding image)
    console.log("-> Executing 'placeImageInPanel'");
    await page.evaluate(({pageId, panelId}) => {
      return window.mangaMaker.commands.execute("placeImageInPanel", {
        pageId,
        panelId,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" // 1x1 black pixel
      });
    }, { pageId: currentPageId, panelId: panel.id });
    
    // Bug hunting test: test the bound image drag invariants
    console.log("-> Executing 'transformImageInPanel'");
    await page.evaluate(({pageId, panelId}) => {
      return window.mangaMaker.commands.execute("transformImageInPanel", {
        pageId,
        panelId,
        x: 50,
        y: 50,
        scaleX: 1.5,
        scaleY: 1.5
      });
    }, { pageId: currentPageId, panelId: panel.id });

    // Ensure session state
    const session = await page.evaluate(() => window.mangaMaker.session.get());
    console.log("Current session zoom:", session.zoom);
    console.log("Currently selected page:", session.selectedPageId);

    console.log("\nAll API tests completed successfully.");

  } catch (err) {
    console.error("\nERROR found during API execution:");
    console.error(err);
  } finally {
    await browser.close();
  }
})();
