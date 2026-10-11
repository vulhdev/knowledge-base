#!/usr/bin/env node
import { openDb } from "../db/client.js";
import { addMember } from "../db/members.js";

const args = process.argv.slice(2);
const roleIdx = args.indexOf("--role");
const role = roleIdx !== -1 ? args[roleIdx + 1] : undefined;
const positional = args.filter((_, i) => i !== roleIdx && i !== roleIdx + 1);
const [github_login, workspace] = positional;

if (!github_login || !workspace) {
  console.error("Usage: knowledge-base invite <github_login> <workspace> [--role <role>]");
  process.exit(1);
}

const db = openDb();
addMember(db, github_login, workspace, process.env.KB_INVITER, role);

console.log(`Added ${github_login} to workspace "${workspace}"${role ? ` as ${role}` : ""}.`);
