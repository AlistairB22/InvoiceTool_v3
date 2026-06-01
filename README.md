# Invoice Tool v3

A local Windows desktop invoice tool rebuilt from the old Python/Tkinter app.

## What it does

- Runs as a normal desktop app from a shortcut after installation.
- Stores contacts, invoice numbers, invoice records, and expenses locally in the user's app data folder.
- Starts with an empty local data store.
- Can import a v2 `Resources` folder from Settings.
- Does not bundle client, invoice, expense, or template data in the installer.
- Creates professional DOCX invoices and optional PDF copies.
- Exports revenue and monthly revenue/expense reports as Excel-compatible CSV files.
- Checks GitHub releases for updates when an internet connection is available.

## Development

```powershell
npm install
npm start
```

## Build an installer

```powershell
npm run dist
```

The NSIS installer is written to `release/` and creates a desktop shortcut.

## GitHub auto-update setup

The app is configured for GitHub releases at `AlistairB22/InvoiceTool_v3`. The workflow in `.github/workflows/release.yml` builds and publishes the Windows installer when you push a version tag:

```powershell
git tag v3.0.1
git push origin v3.0.1
```

Installed apps will check for updates on startup when online.
