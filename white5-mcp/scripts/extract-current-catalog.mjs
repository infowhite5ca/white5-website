import { readFileSync, writeFileSync } from "node:fs";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error("Usage: node extract-current-catalog.mjs <deployed-index.js> <output.json>");
const source = readFileSync(sourcePath, "utf8");
const marker = "var upstream_tools_default = ";
const start = source.indexOf(marker);
const end = source.indexOf("\n\n// src/catalog.ts", start);
if (start < 0 || end < 0) throw new Error("The deployed White5 catalog markers were not found.");
let literal = source.slice(start + marker.length, end).trim();
if (literal.endsWith(";")) literal = literal.slice(0, -1);
const data = Function(`"use strict"; return (${literal});`)();
writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(Object.fromEntries(Object.entries(data).map(([provider, tools]) => [provider, tools.length])));
