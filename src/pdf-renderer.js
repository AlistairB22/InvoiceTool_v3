window.renderInvoice = async (base64, regular) => {
  if (!window.docx || typeof window.docx.renderAsync !== "function") {
    throw new Error("The invoice PDF renderer could not be loaded.");
  }

  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  await window.docx.renderAsync(bytes, document.getElementById("invoice"), null, {
    hideWrapperOnPrint: true,
    renderHeaders: true,
    renderFooters: true,
    experimental: true
  });

  if (regular) {
    document.body.classList.add("regular-invoice");
    const article = document.querySelector(".docx-wrapper > section > article");
    const tables = article.querySelectorAll(":scope > table");
    if (tables.length < 3) throw new Error("The regular invoice totals could not be rendered.");
    const oldTotals = tables[tables.length - 1];
    const labels = [];
    for (let node = oldTotals.nextElementSibling; node && labels.length < 3; node = node.nextElementSibling) {
      if (node.tagName === "P" && node.textContent.trim()) labels.push(node);
    }
    if (labels.length !== 3) throw new Error("The regular invoice totals could not be rendered.");

    const amounts = Array.from(oldTotals.rows, (row) => row.textContent.trim());
    const totals = document.createElement("div");
    totals.className = "invoice-totals";
    labels.forEach((label, index) => {
      const row = document.createElement("div");
      const title = document.createElement("strong");
      const amount = document.createElement("span");
      title.textContent = label.textContent.trim();
      amount.textContent = amounts[index] || "";
      row.append(title, amount);
      totals.appendChild(row);
      label.remove();
    });
    oldTotals.replaceWith(totals);
  }

  await document.fonts.ready;
  await Promise.all(Array.from(document.images, (image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("An invoice image could not be loaded.")), { once: true });
    });
  }));

  const section = document.querySelector(".docx-wrapper > section");
  const padding = getComputedStyle(section);
  const contentHeight = section.querySelector("header").offsetHeight
    + section.querySelector("article").offsetHeight
    + parseFloat(padding.paddingTop)
    + parseFloat(padding.paddingBottom);
  return { contentHeight };
};
