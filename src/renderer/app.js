let state = null;
let lineItems = [];
let toastTimer = null;
let creatingInvoice = false;
const MAX_LINE_ITEMS = 4;

const $ = (id) => document.getElementById(id);
const money = (value) => `£${Number(value || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthIso = () => new Date().toISOString().slice(0, 7);

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3600);
}

function displayDate(iso) {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-GB");
}

function currentMileageRate() {
  return Number(state?.settings?.mileageRate || 0.45);
}

function lineTotal(item) {
  return Number(item.price || 0) + Number(item.miles || 0) * currentMileageRate();
}

function invoiceTotal() {
  return lineItems.reduce((sum, item) => sum + lineTotal(item), 0);
}

function readContactForm() {
  return {
    name: $("clientName").value.trim(),
    vendorNumber: $("vendorNumber").value.trim(),
    postcode: $("postcode").value.trim(),
    address1: $("address1").value.trim(),
    address2: $("address2").value.trim(),
    address3: $("address3").value.trim(),
    address4: $("address4").value.trim()
  };
}

function fillContact(contact) {
  $("clientName").value = contact?.name || "";
  $("vendorNumber").value = contact?.vendorNumber || "";
  $("postcode").value = contact?.postcode || "";
  $("address1").value = contact?.address1 || "";
  $("address2").value = contact?.address2 || "";
  $("address3").value = contact?.address3 || "";
  $("address4").value = contact?.address4 || "";
}

function clearInvoice() {
  fillContact(null);
  $("jobDescription").value = "";
  $("haypInvoice").checked = false;
  $("pdfNeeded").checked = true;
  lineItems = [];
  render();
}

function render() {
  if (!state) return;
  renderInvoiceNumbers();
  renderInvoiceHistory();
  renderContacts();
  renderLineItems();
  renderExpenses();
  renderSettings();
}

function renderInvoiceNumbers() {
  const isHayp = $("haypInvoice").checked;
  $("invoiceTypeLabel").textContent = isHayp ? "HA/YP" : "Regular";
  $("nextInvoiceNumber").textContent = isHayp ? state.settings.haypInvoiceNumber : state.settings.regularInvoiceNumber;
}

function renderContacts() {
  $("clientSuggestions").innerHTML = state.contacts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((contact) => `<option value="${escapeAttr(contact.name)}"></option>`)
    .join("");

  $("contactsBody").innerHTML = state.contacts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((contact) => {
      const address = [contact.address1, contact.address2, contact.address3, contact.address4].filter(Boolean).join(", ");
      return `<tr><td>${escapeHtml(contact.name)}</td><td>${escapeHtml(contact.vendorNumber)}</td><td>${escapeHtml(contact.postcode)}</td><td>${escapeHtml(address)}</td><td><button class="danger table-action" data-delete-contact="${contact.id}">Delete</button></td></tr>`;
    })
    .join("");
}

function renderInvoiceHistory() {
  const invoices = [...state.invoices].sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.invoiceNumber || 0) - Number(a.invoiceNumber || 0));
  if (invoices.length === 0) {
    $("invoiceHistoryBody").innerHTML = `<tr><td colspan="7" class="empty-row">No invoices yet.</td></tr>`;
    return;
  }
  $("invoiceHistoryBody").innerHTML = invoices.map((invoice) => {
    const files = Array.isArray(invoice.outputFiles) ? invoice.outputFiles : [];
    const docx = files.find((file) => file.toLowerCase().endsWith(".docx"));
    const pdf = files.find((file) => file.toLowerCase().endsWith(".pdf"));
    const fileButtons = [
      docx ? `<button class="secondary table-action" data-open-file="${escapeAttr(docx)}">DOCX</button>` : "",
      pdf ? `<button class="secondary table-action" data-open-file="${escapeAttr(pdf)}">PDF</button>` : ""
    ].join("");
    return `
      <tr>
        <td>${displayDate(invoice.date)}</td>
        <td>${escapeHtml(invoice.clientName)}</td>
        <td>${invoice.hayp ? "HA/YP" : "Regular"}</td>
        <td>${escapeHtml(invoice.invoiceNumber)}</td>
        <td>${money(invoice.total)}</td>
        <td>${invoice.totalMiles || 0}</td>
        <td><div class="history-actions">${fileButtons || `<span class="line-count">Migrated</span>`}</div></td>
      </tr>
    `;
  }).join("");
}

function renderLineItems() {
  $("lineItemsBody").innerHTML = lineItems.map((item, index) => `
    <tr>
      <td>${displayDate(item.date)}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${money(item.price)}</td>
      <td>${item.miles ? `${item.miles}` : ""}</td>
      <td>${money(lineTotal(item))}</td>
      <td><button class="danger table-action" data-remove-line="${index}">Remove</button></td>
    </tr>
  `).join("");
  $("invoiceTotal").textContent = money(invoiceTotal());
  const limitReached = lineItems.length >= MAX_LINE_ITEMS;
  $("lineCountBadge").textContent = `${lineItems.length}/${MAX_LINE_ITEMS}`;
  $("lineCountBadge").classList.toggle("limit-reached", limitReached);
  $("addLineButton").disabled = limitReached;
  $("addLineButton").textContent = limitReached ? "Max 4" : "Add";
}

function renderExpenses() {
  $("expensesBody").innerHTML = state.expenses
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((expense) => `
      <tr>
        <td>${displayDate(expense.date)}</td>
        <td>${escapeHtml(expense.category)}</td>
        <td>${escapeHtml(expense.description)}</td>
        <td>${money(expense.cost)}</td>
        <td><button class="danger table-action" data-delete-expense="${expense.id}">Delete</button></td>
      </tr>
    `)
    .join("");
}

function renderSettings() {
  $("regularNumberSetting").value = state.settings.regularInvoiceNumber;
  $("haypNumberSetting").value = state.settings.haypInvoiceNumber;
  $("mileageRateSetting").value = Number(state.settings.mileageRate || 0).toFixed(2);
  $("templateStatus").textContent = state.templateStatus?.regular && state.templateStatus?.hayp ? "Imported" : "Missing";
  $("dataPath").textContent = state.paths.dataFile;
  $("outputPath").textContent = state.paths.outputDir;
}

function setFieldError(inputId, message) {
  const input = $(inputId);
  if (!input) return;
  input.classList.toggle("invalid", Boolean(message));
  let error = input.parentElement.querySelector(".field-error");
  if (!error && message) {
    error = document.createElement("div");
    error.className = "field-error";
    input.parentElement.appendChild(error);
  }
  if (error) {
    error.textContent = message || "";
    if (!message) error.remove();
  }
}

function clearFieldErrors(inputIds) {
  inputIds.forEach((id) => setFieldError(id, ""));
}

function validateLineItemForm() {
  clearFieldErrors(["lineDate", "lineDescription", "linePrice"]);
  let valid = true;
  if (lineItems.length >= MAX_LINE_ITEMS) {
    showToast("The invoice templates support up to four line items.");
    return false;
  }
  if (!$("lineDate").value) {
    setFieldError("lineDate", "Required");
    valid = false;
  }
  if (!$("lineDescription").value.trim()) {
    setFieldError("lineDescription", "Required");
    valid = false;
  }
  if (!Number.isFinite(Number($("linePrice").value)) || $("linePrice").value === "") {
    setFieldError("linePrice", "Enter a price");
    valid = false;
  }
  return valid;
}

function validateInvoiceForm() {
  clearFieldErrors(["clientName"]);
  let valid = true;
  if (!$("clientName").value.trim()) {
    setFieldError("clientName", "Client name is required");
    valid = false;
  }
  if (lineItems.length === 0) {
    showToast("Add at least one invoice line.");
    valid = false;
  }
  return valid;
}

function validateExpenseForm() {
  clearFieldErrors(["expenseDate", "expenseDescription", "expenseCost"]);
  let valid = true;
  if (!$("expenseDate").value) {
    setFieldError("expenseDate", "Required");
    valid = false;
  }
  if (!$("expenseDescription").value.trim()) {
    setFieldError("expenseDescription", "Required");
    valid = false;
  }
  if (!Number.isFinite(Number($("expenseCost").value)) || $("expenseCost").value === "") {
    setFieldError("expenseCost", "Enter a cost");
    valid = false;
  }
  return valid;
}

function validateSettingsForm() {
  clearFieldErrors(["regularNumberSetting", "haypNumberSetting", "mileageRateSetting"]);
  let valid = true;
  if (!Number.isInteger(Number($("regularNumberSetting").value)) || Number($("regularNumberSetting").value) < 1) {
    setFieldError("regularNumberSetting", "Use a positive whole number");
    valid = false;
  }
  if (!Number.isInteger(Number($("haypNumberSetting").value)) || Number($("haypNumberSetting").value) < 1) {
    setFieldError("haypNumberSetting", "Use a positive whole number");
    valid = false;
  }
  if (!Number.isFinite(Number($("mileageRateSetting").value)) || Number($("mileageRateSetting").value) < 0) {
    setFieldError("mileageRateSetting", "Use zero or more");
    valid = false;
  }
  return valid;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function reload() {
  state = await window.invoiceApi.getState();
  render();
}

function bindNavigation() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      $(button.dataset.view).classList.add("active");
    });
  });
}

function bindInvoice() {
  $("lineDate").value = todayIso();
  $("expenseDate").value = todayIso();
  $("reportMonth").value = monthIso();

  $("haypInvoice").addEventListener("change", renderInvoiceNumbers);
  $("clientName").addEventListener("change", () => {
    const contact = state.contacts.find((c) => c.name.toLowerCase() === $("clientName").value.trim().toLowerCase());
    if (contact) fillContact(contact);
  });

  $("saveContactFromInvoice").addEventListener("click", async () => {
    const contact = readContactForm();
    if (!contact.name) return showToast("Enter a client name first.");
    const existing = state.contacts.find((c) => c.name.toLowerCase() === contact.name.toLowerCase());
    state = await window.invoiceApi.saveContact({ ...existing, ...contact });
    render();
    showToast("Contact saved.");
  });

  $("addLineButton").addEventListener("click", () => {
    if (!validateLineItemForm()) return;
    const item = {
      date: $("lineDate").value,
      description: $("lineDescription").value.trim(),
      price: Number($("linePrice").value),
      miles: Number($("lineMiles").value || 0)
    };
    lineItems.push(item);
    $("lineDescription").value = "";
    $("linePrice").value = "";
    $("lineMiles").value = "";
    clearFieldErrors(["lineDate", "lineDescription", "linePrice"]);
    renderLineItems();
  });

  $("lineItemsBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-line]");
    if (!button) return;
    lineItems.splice(Number(button.dataset.removeLine), 1);
    renderLineItems();
  });

  $("createInvoiceButton").addEventListener("click", async () => {
    if (creatingInvoice) return;
    const contact = readContactForm();
    if (!validateInvoiceForm()) return;
    setCreateInvoiceLoading(true);
    try {
      const result = await window.invoiceApi.createInvoice({
        ...contact,
        clientName: contact.name,
        jobDescription: $("jobDescription").value.trim(),
        hayp: $("haypInvoice").checked,
        pdfNeeded: $("pdfNeeded").checked,
        lineItems
      });
      state = result.store;
      clearInvoice();
      showToast(`Invoice ${result.invoice.invoiceNumber} created.`);
    } catch (error) {
      showToast(error.message || "Invoice could not be created.");
    } finally {
      setCreateInvoiceLoading(false);
    }
  });
}

function setCreateInvoiceLoading(isLoading) {
  creatingInvoice = isLoading;
  const button = $("createInvoiceButton");
  button.disabled = isLoading;
  button.classList.toggle("loading", isLoading);
  $("createInvoiceButtonText").textContent = isLoading ? "Creating invoice..." : "Create Invoice";
}

function bindExpenses() {
  $("addExpenseButton").addEventListener("click", async () => {
    if (!validateExpenseForm()) return;
    const expense = {
      date: $("expenseDate").value,
      category: $("expenseCategory").value,
      description: $("expenseDescription").value.trim(),
      cost: Number($("expenseCost").value)
    };
    state = await window.invoiceApi.saveExpense(expense);
    $("expenseDescription").value = "";
    $("expenseCost").value = "";
    clearFieldErrors(["expenseDate", "expenseDescription", "expenseCost"]);
    render();
    showToast("Expense saved.");
  });

  $("expensesBody").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-expense]");
    if (!button) return;
    if (!window.confirm("Delete this expense?")) return;
    state = await window.invoiceApi.deleteExpense(button.dataset.deleteExpense);
    render();
  });
}

function bindContacts() {
  $("contactsBody").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-contact]");
    if (!button) return;
    if (!window.confirm("Delete this contact?")) return;
    state = await window.invoiceApi.deleteContact(button.dataset.deleteContact);
    render();
  });
}

function bindReportsAndSettings() {
  $("invoiceHistoryBody").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-open-file]");
    if (!button) return;
    try {
      await window.invoiceApi.openFile(button.dataset.openFile);
    } catch (error) {
      showToast(error.message || "Invoice file could not be opened.");
    }
  });

  $("revenueReportButton").addEventListener("click", async () => {
    const file = await window.invoiceApi.exportRevenueReport();
    showToast(`Revenue report exported: ${file}`);
  });
  $("monthlyReportButton").addEventListener("click", async () => {
    const month = $("reportMonth").value;
    if (!month) return showToast("Choose a month first.");
    const file = await window.invoiceApi.exportMonthlyReport(month);
    showToast(`Monthly report exported: ${file}`);
  });
  $("importLegacyButton").addEventListener("click", async () => {
    state = await window.invoiceApi.importLegacyFolder();
    render();
    showToast("Legacy data imported.");
  });
  $("saveSettingsButton").addEventListener("click", async () => {
    if (!validateSettingsForm()) return;
    try {
      state = await window.invoiceApi.saveSettings({
        regularInvoiceNumber: $("regularNumberSetting").value,
        haypInvoiceNumber: $("haypNumberSetting").value,
        mileageRate: $("mileageRateSetting").value
      });
      render();
      showToast("Settings saved.");
    } catch (error) {
      showToast(error.message || "Settings could not be saved.");
    }
  });
  $("openOutputButton").addEventListener("click", () => window.invoiceApi.openOutputFolder());
  $("updateButton").addEventListener("click", async () => showToast(await window.invoiceApi.checkForUpdates()));
  window.invoiceApi.onUpdateMessage((message) => {
    $("statusText").textContent = message;
    showToast(message);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindNavigation();
  bindInvoice();
  bindExpenses();
  bindContacts();
  bindReportsAndSettings();
  await reload();
});
