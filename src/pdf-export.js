const { BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

async function createPdfFromDocx(docxPath, pdfPath, { regular = false } = {}) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  let timeout;
  try {
    const exportPdf = async () => {
      await window.loadFile(path.join(__dirname, "pdf-renderer.html"));
      const docxBase64 = fs.readFileSync(docxPath).toString("base64");
      const { contentHeight } = await window.webContents.executeJavaScript(`window.renderInvoice(${JSON.stringify(docxBase64)}, ${regular})`);
      // Keep the invoice content inside the A4 page when descriptions grow.
      const pdf = await window.webContents.printToPDF({
        pageSize: "A4",
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
        scale: Math.min(1, 1050 / contentHeight),
        preferCSSPageSize: true
      });
      await fs.promises.writeFile(pdfPath, pdf);
    };

    await Promise.race([
      exportPdf(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("PDF export timed out.")), 45000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
    window.destroy();
  }
}

module.exports = { createPdfFromDocx };
