const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("invoiceApi", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveContact: (contact) => ipcRenderer.invoke("contacts:save", contact),
  deleteContact: (id) => ipcRenderer.invoke("contacts:delete", id),
  createInvoice: (invoice) => ipcRenderer.invoke("invoices:create", invoice),
  saveExpense: (expense) => ipcRenderer.invoke("expenses:save", expense),
  deleteExpense: (id) => ipcRenderer.invoke("expenses:delete", id),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  exportRevenueReport: () => ipcRenderer.invoke("reports:revenue"),
  exportMonthlyReport: (month) => ipcRenderer.invoke("reports:monthly", month),
  importLegacyFolder: () => ipcRenderer.invoke("legacy:importFolder"),
  openOutputFolder: () => ipcRenderer.invoke("shell:openOutputFolder"),
  openFile: (filePath) => ipcRenderer.invoke("shell:openFile", filePath),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateMessage: (handler) => {
    ipcRenderer.on("updates:message", (_event, message) => handler(message));
  },
  onUpdateStatus: (handler) => {
    ipcRenderer.on("updates:status", (_event, status) => handler(status));
  }
});
