#!/usr/bin/env node
/* Generate a simple SVG coverage badge from coverage/coverage-summary.json */
const fs = require('fs');
const path = require('path');

const summaryPath = path.join(__dirname, '..', 'coverage', 'coverage-summary.json');
const outDir = path.join(__dirname, '..', 'docs', 'badges');

function pct(n) { return typeof n === 'number' ? n.toFixed(0) : '0'; }

(async function main() {
  if (!fs.existsSync(summaryPath)) {
    console.error('coverage-summary.json not found. Run coverage first.');
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(summaryPath,'utf8'));
  const total = json.total || {};
  const stmts = pct(total.statements && total.statements.pct);
  const color = (p => p>=90?'#2e963d':p>=80?'#4ab04a':p>=70?'#a7b338':p>=60?'#c7a435':'#c65239')(Number(stmts));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20" role="img" aria-label="coverage: ${stmts}%"><linearGradient id="a" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><rect rx="3" width="120" height="20" fill="#555"/><rect rx="3" x="62" width="58" height="20" fill="${color}"/><path fill="${color}" d="M62 0h4v20h-4z"/><rect rx="3" width="120" height="20" fill="url(#a)"/><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="31" y="15" fill="#010101" fill-opacity=".3">coverage</text><text x="31" y="14">coverage</text><text x="90" y="15" fill="#010101" fill-opacity=".3">${stmts}%</text><text x="90" y="14">${stmts}%</text></g></svg>`;
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'coverage.svg');
  fs.writeFileSync(outFile, svg);
  console.log('Coverage badge written to', outFile);
})();
