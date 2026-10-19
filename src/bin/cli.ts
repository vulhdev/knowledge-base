#!/usr/bin/env node
const [, , command] = process.argv;

switch (command) {
  case "init":
    await import("./init.js");
    break;
  case "gui":
    await import("./gui.js");
    break;
  case "update":
    await import("./update.js");
    break;
  case "link-code":
    await import("./link-code.js");
    break;
  case "status":
    await import("./status.js");
    break;
  case "team":
    await import("./team.js");
    break;
  case "upgrade":
    await import("./upgrade.js");
    break;
  case "import-sources":
    await import("./import-sources.js");
    break;
  case undefined:
    // No subcommand — start the MCP server (stdio transport, called by Claude Code)
    await import("../index.js");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage: knowledge-base [init|gui|update|upgrade|status|team|link-code|import-sources]");
    process.exit(1);
}
