const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const required = [
  "package.json",
  "src/main.js",
  "src/preload.js",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/styles.css"
];

for (const file of required) {
  const full = path.join(__dirname, "..", file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

for (const file of ["src/main.js", "src/preload.js", "src/renderer/app.js"]) {
  childProcess.execFileSync(process.execPath, ["--check", path.join(__dirname, "..", file)], { stdio: "inherit" });
}

console.log("Smoke test passed: app files load.");
