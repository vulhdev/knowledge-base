#!/usr/bin/env node
const [, , command] = process.argv;

switch (command) {
  case "init":
    await import("./init.js");
    break;
  case "gui":
    await import("./gui.js");
    break;
  case undefined:
    // No subcommand — start the MCP server (stdio transport, called by Claude Code)
    await import("../index.js");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage: knowledge-base [init|gui]");
    process.exit(1);
}
