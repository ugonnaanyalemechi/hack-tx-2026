#!/usr/bin/env node
/**
 * Lists every `RUNTIME-PLACEHOLDER(#n)` marker under web/, grouped by runtime
 * ticket, as a markdown table (paste it into #57). No dependencies.
 *
 *   npm run placeholders            # table, exit 0
 *   npm run placeholders -- --check # exit 1 if any marker is left
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "test-results", "playwright-report", ".git"]);
const SKIP_FILES = new Set(["runtime-placeholders.mjs", "RUNTIME-HANDOFF.md", "package-lock.json"]);
const TEXT = /\.(ts|tsx|mjs|js|json|md|css)$/;
const MARKER = /RUNTIME-PLACEHOLDER\(#(\d+)\)\s*:?\s*(.*)/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (TEXT.test(name)) yield path;
  }
}

const found = [];
for (const file of walk(root)) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      const match = line.match(MARKER);
      if (!match) return;
      const note = match[2].replace(/\*\/\s*$/, "").trim();
      found.push({
        ticket: Number(match[1]),
        location: `${relative(root, file)}:${index + 1}`,
        note: note.length > 110 ? `${note.slice(0, 107)}...` : note,
      });
    });
}

found.sort((a, b) => a.ticket - b.ticket || a.location.localeCompare(b.location));

if (found.length === 0) {
  console.log("No RUNTIME-PLACEHOLDER markers left.");
} else {
  const tickets = [...new Set(found.map((f) => f.ticket))];
  console.log(`${found.length} RUNTIME-PLACEHOLDER markers across ${tickets.length} runtime tickets\n`);
  console.log("| Ticket | Location | What is faked |");
  console.log("| --- | --- | --- |");
  for (const f of found) {
    console.log(`| #${f.ticket} | \`web/${f.location}\` | ${f.note.replaceAll("|", "\\|")} |`);
  }
}

if (process.argv.includes("--check") && found.length > 0) process.exit(1);
