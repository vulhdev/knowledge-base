#!/usr/bin/env node
import { openDb } from "../db/client.js";
import { addMember } from "../db/members.js";

const [, , github_login, workspace] = process.argv;

if (!github_login || !workspace) {
  console.error("Usage: knowledge-base invite <github_login> <workspace>");
  process.exit(1);
}

const db = openDb();
addMember(db, github_login, workspace, process.env.KB_INVITER);

console.log(`Added ${github_login} to workspace "${workspace}".`);
