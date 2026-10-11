#!/usr/bin/env node
const [, , command] = process.argv;

switch (command) {
  case "init":
    await import("./init.js");
    break;
  case "gui":
    await import("./gui.js");
    break;
  case "serve":
    await import("./serve.js");
    break;
  case "login":
    await import("./login.js");
    break;
  case "invite":
    await import("./invite.js");
    break;
  case "kick":
    await import("./kick.js");
    break;
  case "update":
    await import("./update.js");
    break;
  case "link-code":
    await import("./link-code.js");
    break;
  case "push":
    await import("./push.js");
    break;
  case "rollback":
    await import("./rollback.js");
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
    console.error("Usage: knowledge-base [init|gui|serve|login|invite|kick|update|link-code|push|rollback|import-sources]");
    process.exit(1);
}
