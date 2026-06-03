const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const childProcess = require("child_process");
const { autoUpdater } = require("electron-updater");
const { parse } = require("csv-parse/sync");
const Docxtemplater = require("docxtemplater");
const PizZip = require("pizzip");

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

let mainWindow;
let updateReadyToInstall = false;
let installingUpdate = false;

function assetPath(fileName) {
  const packaged = path.join(process.resourcesPath || "", "assets", fileName);
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", "assets", fileName);
}

function paths() {
  const dataDir = app.getPath("userData");
  const outputDir = path.join(app.getPath("documents"), "Invoice Tool Outputs");
  const templateDir = path.join(dataDir, "templates");
  return {
    dataDir,
    templateDir,
    outputDir,
    dataFile: path.join(dataDir, "invoice-tool-data.json"),
    regularDir: path.join(outputDir, "Invoices", "Regular"),
    haypDir: path.join(outputDir, "Invoices", "HAYP"),
    reportsDir: path.join(outputDir, "Reports")
  };
}

function ensureDirs() {
  const p = paths();
  [p.dataDir, p.templateDir, p.outputDir, p.regularDir, p.haypDir, p.reportsDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
}

function emptyStore() {
  return {
    schemaVersion: 3,
    migratedAt: null,
    settings: {
      regularInvoiceNumber: 1,
      haypInvoiceNumber: 1000,
      mileageRate: 0.45
    },
    contacts: [],
    invoices: [],
    expenses: []
  };
}

function readStore() {
  ensureDirs();
  const p = paths();
  if (!fs.existsSync(p.dataFile)) {
    const store = emptyStore();
    writeStore(store);
    return store;
  }
  return JSON.parse(fs.readFileSync(p.dataFile, "utf8"));
}

function writeStore(store) {
  ensureDirs();
  fs.writeFileSync(paths().dataFile, JSON.stringify(store, null, 2), "utf8");
}

function templateStatus() {
  return {
    regular: fs.existsSync(templatePath("InvoiceTemplate.docx")),
    hayp: fs.existsSync(templatePath("InvoiceTemplateHAYP.docx"))
  };
}

function publicState(store = readStore()) {
  return { ...store, paths: paths(), templateStatus: templateStatus() };
}

function templatePath(fileName) {
  return path.join(paths().templateDir, fileName);
}

function parseCsvFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const input = fs.readFileSync(filePath, "utf8");
  return parse(input, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
}

function moneyNumber(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normaliseBoolean(value) {
  return String(value).toLowerCase() === "true";
}

function valueByLooseKey(row, prefix) {
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase().startsWith(prefix.toLowerCase()));
  return key ? row[key] : "";
}

function parseDate(value) {
  const raw = String(value || "").trim();
  const [day, month, year] = raw.split(/[/-]/).map(Number);
  if (!day || !month || !year) return raw;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function displayDate(iso) {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

function mergeLegacyData(store, folder) {
  const clients = parseCsvFile(path.join(folder, "legacy-SavedClients.csv")).concat(parseCsvFile(path.join(folder, "SavedClients.csv")));
  for (const row of clients) {
    const name = row["Client Name"] || row.clientName;
    if (!name || store.contacts.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
    store.contacts.push({
      id: id("contact"),
      name,
      vendorNumber: row["Vendor Number"] || "",
      postcode: row.Postcode || "",
      address1: row["Address Line 1"] || "",
      address2: row["Address Line 2"] || "",
      address3: row["Address Line 3"] || "",
      address4: row["Address Line 4"] || ""
    });
  }

  const invoices = parseCsvFile(path.join(folder, "legacy-InvoiceRecords.csv")).concat(parseCsvFile(path.join(folder, "InvoiceRecords.csv")));
  for (const row of invoices) {
    const invoiceNumber = row.InvoiceNumber;
    if (!invoiceNumber || store.invoices.some((i) => String(i.invoiceNumber) === String(invoiceNumber) && i.date === parseDate(row.InvoiceDate))) continue;
    store.invoices.push({
      id: id("invoice"),
      clientName: row.ClientName || "",
      hayp: normaliseBoolean(row.HAYP),
      invoiceNumber: Number(invoiceNumber),
      date: parseDate(row.InvoiceDate),
      total: moneyNumber(valueByLooseKey(row, "InvoiceCost")),
      totalMiles: Number(row.TotalMiles || 0),
      lineItems: [],
      outputFiles: []
    });
  }

  const expenses = parseCsvFile(path.join(folder, "legacy-ExpenseRecords.csv")).concat(parseCsvFile(path.join(folder, "ExpenseRecords.csv")));
  for (const row of expenses) {
    const legacyId = row.ExpenseID;
    if (legacyId && store.expenses.some((e) => e.legacyId === legacyId)) continue;
    store.expenses.push({
      id: id("expense"),
      legacyId,
      date: parseDate(row.Date),
      category: row.Category || "Other",
      description: row.Description || "",
      cost: moneyNumber(row.Cost)
    });
  }

  const numberFiles = ["legacy-invoice_numbers.json", "invoice_numbers.json"];
  for (const fileName of numberFiles) {
    const filePath = path.join(folder, fileName);
    if (!fs.existsSync(filePath)) continue;
    const numbers = JSON.parse(fs.readFileSync(filePath, "utf8"));
    store.settings.regularInvoiceNumber = Number(numbers.regular_invoice_number || store.settings.regularInvoiceNumber);
    store.settings.haypInvoiceNumber = Number(numbers.ha_yp_invoice_number || store.settings.haypInvoiceNumber);
  }
}

function copyLegacyTemplates(folder) {
  const candidates = [folder, path.join(folder, "Resources")];
  for (const base of candidates) {
    const regular = path.join(base, "InvoiceTemplate.docx");
    const hayp = path.join(base, "InvoiceTemplateHAYP.docx");
    if (fs.existsSync(regular)) fs.copyFileSync(regular, templatePath("InvoiceTemplate.docx"));
    if (fs.existsSync(hayp)) fs.copyFileSync(hayp, templatePath("InvoiceTemplateHAYP.docx"));
  }
}

function validateInvoice(input) {
  if (!input.clientName) throw new Error("Client name is required.");
  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) throw new Error("Add at least one invoice line.");
  if (input.lineItems.length > 4) throw new Error("The invoice template supports up to four line items.");
  for (const item of input.lineItems) {
    if (!item.date || !item.description || !Number.isFinite(Number(item.price))) throw new Error("Each line needs a date, description, and price.");
  }
}

function totalForLine(item, mileageRate) {
  const miles = Number(item.miles || 0);
  return moneyNumber(item.price) + miles * mileageRate;
}

function invoiceTotal(lineItems, mileageRate) {
  return lineItems.reduce((sum, item) => sum + totalForLine(item, mileageRate), 0);
}

function currency(value) {
  return `\u00a3${moneyNumber(value).toFixed(2)}`;
}

async function createDocxInvoice(invoice, store, destination) {
  const templateName = invoice.hayp ? "InvoiceTemplateHAYP.docx" : "InvoiceTemplate.docx";
  const selectedTemplatePath = templatePath(templateName);
  if (!fs.existsSync(selectedTemplatePath)) {
    throw new Error("Invoice templates need to be imported from the old v2 Resources folder in Settings before creating invoices.");
  }
  const template = fs.readFileSync(selectedTemplatePath, "binary");
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ""
  });

  doc.render(invoiceTemplateData(invoice, store));
  fs.writeFileSync(destination, doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

function invoiceTemplateData(invoice, store) {
  const data = {
    client_name: invoice.clientName || "",
    job_description: invoice.jobDescription || "",
    vendor_number: invoice.vendorNumber || "",
    postcode: invoice.postcode || "",
    address_line1: invoice.address1 || "",
    address_line2: invoice.address2 || "",
    address_line3: invoice.address3 || "",
    address_line4: invoice.address4 || "",
    date: displayDate(invoice.date),
    invoice_number: String(invoice.invoiceNumber || ""),
    total_cost: currency(invoice.total)
  };

  invoice.lineItems.slice(0, 4).forEach((item, index) => {
    const n = index + 1;
    const miles = Number(item.miles || 0);
    const mileageCost = miles * store.settings.mileageRate;
    const itemTotal = totalForLine(item, store.settings.mileageRate);
    const date = displayDate(item.date);
    data[`date_${n}`] = date;
    data[`cost_desc_${n}`] = item.description || "";
    data[`cost_date_and_desc_${n}`] = [date, item.description].filter(Boolean).join("\n");
    data[`cost_${n}`] = currency(item.price);
    data[`mileage_${n}`] = miles ? `${miles} Mile(s) @ ${Math.round(store.settings.mileageRate * 100)}p per Mile` : "";
    data[`mileage_cost_${n}`] = miles ? currency(mileageCost) : "";
    data[`total_cost_${n}`] = currency(itemTotal);
  });

  for (let n = invoice.lineItems.length + 1; n <= 4; n += 1) {
    data[`date_${n}`] = "";
    data[`cost_desc_${n}`] = "";
    data[`cost_date_and_desc_${n}`] = "";
    data[`cost_${n}`] = "";
    data[`mileage_${n}`] = "";
    data[`mileage_cost_${n}`] = "";
    data[`total_cost_${n}`] = "";
  }

  return data;
}

function createHtmlInvoice(invoice, store) {
  const rows = invoice.lineItems.map((item) => {
    const miles = Number(item.miles || 0);
    const mileageCost = miles * store.settings.mileageRate;
    return `<tr><td>${displayDate(item.date)}</td><td>${escapeHtml(item.description)}</td><td>${currency(item.price)}</td><td>${miles ? `${miles} miles (${currency(mileageCost)})` : ""}</td><td>${currency(totalForLine(item, store.settings.mileageRate))}</td></tr>`;
  }).join("");
  const address = [invoice.address1, invoice.address2, invoice.address3, invoice.address4, invoice.postcode].filter(Boolean).map(escapeHtml).join("<br>");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#111827;margin:48px} h1{font-size:34px;margin:0 0 24px} .meta{float:right;text-align:right} table{width:100%;border-collapse:collapse;margin-top:32px} th,td{border-bottom:1px solid #d1d5db;padding:10px;text-align:left} th{background:#f3f4f6} .total{text-align:right;font-size:24px;font-weight:700;margin-top:24px}
  </style></head><body><div class="meta">Invoice ${invoice.invoiceNumber}<br>${displayDate(invoice.date)}</div><h1>${invoice.hayp ? "HA/YP Invoice" : "Invoice"}</h1><h2>${escapeHtml(invoice.clientName)}</h2><p>${address}</p><p>${invoice.vendorNumber ? `Vendor number: ${escapeHtml(invoice.vendorNumber)}` : ""}</p><h3>${escapeHtml(invoice.jobDescription || "")}</h3><table><thead><tr><th>Date</th><th>Description</th><th>Cost</th><th>Mileage</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total: ${currency(invoice.total)}</div></body></html>`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

async function createPdfInvoice(invoice, store, destination) {
  await convertDocxToPdf(invoice.outputFiles[0], destination);
}

function convertDocxToPdf(docxPath, pdfPath) {
  const script = `
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $null
try {
  $doc = $word.Documents.OpenNoRepairDialog('${escapePowerShellString(docxPath)}', $false, $true, $false)
  $doc.ExportAsFixedFormat('${escapePowerShellString(pdfPath)}', 17)
} finally {
  if ($doc -ne $null) { $doc.Close($false) }
  $word.Quit()
}
`;
  return new Promise((resolve, reject) => {
    childProcess.execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { timeout: 45000, windowsHide: true }, (error) => {
      if (error) {
        reject(new Error("PDF export needs Microsoft Word installed locally and able to open without prompts."));
        return;
      }
      resolve();
    });
  });
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function createCsv(rows, destination) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ];
  fs.writeFileSync(destination, lines.join(os.EOL), "utf8");
}

function monthKey(date) {
  return String(date || "").slice(0, 7);
}

function revenueRows(store) {
  const buckets = new Map();
  for (const invoice of store.invoices) {
    const key = monthKey(invoice.date);
    if (!key) continue;
    buckets.set(key, (buckets.get(key) || 0) + moneyNumber(invoice.total));
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, revenue]) => ({ Month: month, Revenue: revenue }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1700,
    height: 820,
    minWidth: 1650,
    minHeight: 680,
    title: "Invoice Tool",
    icon: assetPath("InvoiceAppIcon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on("before-quit", (event) => {
  if (updateReadyToInstall && !installingUpdate) {
    event.preventDefault();
    installDownloadedUpdate();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function sendUpdateStatus(status, message) {
  mainWindow?.webContents.send("updates:status", { status, message });
  mainWindow?.webContents.send("updates:message", message);
}

function installDownloadedUpdate() {
  if (!updateReadyToInstall || installingUpdate) return;
  installingUpdate = true;
  sendUpdateStatus("installing", "Installing update...");
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}

autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking", "Checking for updates..."));
autoUpdater.on("update-available", () => sendUpdateStatus("downloading", "Update found. Downloading it now."));
autoUpdater.on("update-not-available", () => sendUpdateStatus("idle", "Invoice Tool is up to date."));
autoUpdater.on("update-downloaded", () => {
  updateReadyToInstall = true;
  sendUpdateStatus("ready", "Update downloaded. Restart to install it.");
});
autoUpdater.on("error", () => sendUpdateStatus("error", "Update check could not complete."));

ipcMain.handle("state:get", () => publicState());

ipcMain.handle("contacts:save", (_event, contact) => {
  const store = readStore();
  const clean = { ...contact, id: contact.id || id("contact") };
  const index = store.contacts.findIndex((c) => c.id === clean.id);
  if (index >= 0) store.contacts[index] = clean;
  else store.contacts.push(clean);
  writeStore(store);
  return publicState(store);
});

ipcMain.handle("contacts:delete", (_event, contactId) => {
  const store = readStore();
  store.contacts = store.contacts.filter((c) => c.id !== contactId);
  writeStore(store);
  return publicState(store);
});

ipcMain.handle("invoices:create", async (_event, input) => {
  validateInvoice(input);
  const store = readStore();
  const invoiceNumber = input.hayp ? store.settings.haypInvoiceNumber : store.settings.regularInvoiceNumber;
  const invoice = {
    id: id("invoice"),
    ...input,
    invoiceNumber,
    date: new Date().toISOString().slice(0, 10),
    total: invoiceTotal(input.lineItems, store.settings.mileageRate),
    totalMiles: input.lineItems.reduce((sum, item) => sum + Number(item.miles || 0), 0),
    outputFiles: []
  };

  const folder = input.hayp ? paths().haypDir : paths().regularDir;
  const stem = `${input.hayp ? "InvoiceHAYP" : "InvoiceRegular"}${invoiceNumber}`;
  const docxPath = path.join(folder, `${stem}.docx`);
  await createDocxInvoice(invoice, store, docxPath);
  invoice.outputFiles.push(docxPath);
  if (input.pdfNeeded) {
    const pdfPath = path.join(folder, `${stem}.pdf`);
    await createPdfInvoice(invoice, store, pdfPath);
    invoice.outputFiles.push(pdfPath);
  }

  store.invoices.push(invoice);
  if (input.hayp) store.settings.haypInvoiceNumber += 1;
  else store.settings.regularInvoiceNumber += 1;
  writeStore(store);
  return { store: publicState(store), invoice };
});

ipcMain.handle("expenses:save", (_event, expense) => {
  const store = readStore();
  const clean = { ...expense, id: expense.id || id("expense"), cost: moneyNumber(expense.cost) };
  const index = store.expenses.findIndex((e) => e.id === clean.id);
  if (index >= 0) store.expenses[index] = clean;
  else store.expenses.push(clean);
  writeStore(store);
  return publicState(store);
});

ipcMain.handle("expenses:delete", (_event, expenseId) => {
  const store = readStore();
  store.expenses = store.expenses.filter((e) => e.id !== expenseId);
  writeStore(store);
  return publicState(store);
});

ipcMain.handle("settings:save", (_event, settings) => {
  const store = readStore();
  const regularInvoiceNumber = Number.parseInt(settings.regularInvoiceNumber, 10);
  const haypInvoiceNumber = Number.parseInt(settings.haypInvoiceNumber, 10);
  const mileageRate = Number.parseFloat(settings.mileageRate);
  if (!Number.isInteger(regularInvoiceNumber) || regularInvoiceNumber < 1) throw new Error("Regular invoice number must be a positive whole number.");
  if (!Number.isInteger(haypInvoiceNumber) || haypInvoiceNumber < 1) throw new Error("HA/YP invoice number must be a positive whole number.");
  if (!Number.isFinite(mileageRate) || mileageRate < 0) throw new Error("Mileage rate must be zero or more.");
  store.settings = {
    ...store.settings,
    regularInvoiceNumber,
    haypInvoiceNumber,
    mileageRate
  };
  writeStore(store);
  return publicState(store);
});

ipcMain.handle("reports:revenue", () => {
  const store = readStore();
  const destination = path.join(paths().reportsDir, "Revenue_Report.csv");
  createCsv(revenueRows(store), destination);
  shell.showItemInFolder(destination);
  return destination;
});

ipcMain.handle("reports:monthly", (_event, month) => {
  const store = readStore();
  const invoiceRows = store.invoices.filter((i) => monthKey(i.date) === month).map((i) => ({
    Date: displayDate(i.date),
    Type: "Invoice",
    Description: `${i.clientName} invoice ${i.invoiceNumber}`,
    Revenue: i.total,
    Miles: i.totalMiles,
    Expense: "",
    Cost: ""
  }));
  const expenseRows = store.expenses.filter((e) => monthKey(e.date) === month).map((e) => ({
    Date: displayDate(e.date),
    Type: "Expense",
    Description: e.description,
    Revenue: "",
    Miles: "",
    Expense: e.category,
    Cost: e.cost
  }));
  const rows = [...invoiceRows, ...expenseRows].sort((a, b) => a.Date.localeCompare(b.Date));
  rows.push({
    Date: "",
    Type: "TOTAL",
    Description: "",
    Revenue: invoiceRows.reduce((sum, row) => sum + moneyNumber(row.Revenue), 0),
    Miles: invoiceRows.reduce((sum, row) => sum + Number(row.Miles || 0), 0),
    Expense: "",
    Cost: expenseRows.reduce((sum, row) => sum + moneyNumber(row.Cost), 0)
  });
  const destination = path.join(paths().reportsDir, `Monthly_Report_${month}.csv`);
  createCsv(rows, destination);
  shell.showItemInFolder(destination);
  return destination;
});

ipcMain.handle("legacy:importFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], title: "Choose the old Resources folder" });
  if (result.canceled || !result.filePaths[0]) return publicState();
  const store = readStore();
  mergeLegacyData(store, result.filePaths[0]);
  copyLegacyTemplates(result.filePaths[0]);
  store.migratedAt = new Date().toISOString();
  writeStore(store);
  return publicState(store);
});

ipcMain.handle("shell:openOutputFolder", () => {
  shell.openPath(paths().outputDir);
  return paths().outputDir;
});

ipcMain.handle("shell:openFile", (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) throw new Error("That invoice file could not be found.");
  shell.openPath(filePath);
  return filePath;
});

ipcMain.handle("updates:check", async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return result ? "Update check started." : "No update provider is configured.";
  } catch {
    return "Update check could not complete.";
  }
});

ipcMain.handle("updates:install", () => {
  if (!updateReadyToInstall) return "No downloaded update is ready to install.";
  installDownloadedUpdate();
  return "Installing update...";
});
