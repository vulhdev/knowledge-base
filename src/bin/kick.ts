#!/usr/bin/env node
import { openDb } from "../db/client.js";
import { removeMember } from "../db/members.js";

const [, , github_login, workspace] = process.argv;

if (!github_login || !workspace) {
  console.error("Usage: knowledge-base kick <github_login> <workspace>");
  process.exit(1);
}

const db = openDb();
removeMember(db, github_login, workspace);

console.log(`Removed ${github_login} from workspace "${workspace}".`);
