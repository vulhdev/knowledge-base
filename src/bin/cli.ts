#!/usr/bin/env node
const [, , command] = process.argv;

switch (command) {
  case "init":
    await import("./init.js");
    break;
  case "gui":
    await import("./gui.js");
    break;
  default:
    console.error(`Unknown command: ${command ?? "(none)"}`);
    console.error("Usage: knowledge-base <init|gui>");
    process.exit(1);
}
