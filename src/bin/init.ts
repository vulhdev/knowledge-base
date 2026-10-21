#!/usr/bin/env node
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync } from "node:fs";
import * as p from "@clack/prompts";
import { openDb } from "../db/client.js";
import { listWorkspaces, createWorkspace } from "../db/workspaces.js";
import { getTeamByName, insertTeam, updateTeamKeypair } from "../db/team.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { isCrsqliteReady, downloadCrsqlite } from "../team/crsqlite.js";
import { generateSecret, generateNoiseKeypair } from "../team/generate.js";
import { startDeviceFlow, pollForToken, getGitHubUsername } from "../team/github.js";
import { loadSettings, writeSettings } from "../config.js";
import { writeWorkspaceToClaude } from "../sync/claude-md.js";

const CREATE_NEW = "__new__";
const SKIP = "__skip__";
// 32-byte seed-only Ed25519 key, encoded as hex = 64 characters.
// Used to detect stale keypairs that need auto-migration to a full 64-byte keypair.
const STALE_KEY_HEX_LEN = 64;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_SRC = join(PACKAGE_ROOT, "skills");
const AGENTS_SRC = join(PACKAGE_ROOT, "agents");
const VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
const VERSION_MARKER = ".knowledge-base-version";


function copySkills(destBase: string): string[] {
  const copied: string[] = [];
  if (!existsSync(SKILLS_SRC)) return copied;

  const skills = readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const skill of skills) {
    const dest = join(destBase, skill);
    mkdirSync(dest, { recursive: true });
    cpSync(join(SKILLS_SRC, skill), dest, { recursive: true });
    copied.push(skill);
  }

  return copied;
}

function copyAgents(destBase: string): string[] {
  const copied: string[] = [];
  if (!existsSync(AGENTS_SRC)) return copied;

  const agents = readdirSync(AGENTS_SRC).filter((f) => f.endsWith(".md"));

  for (const agent of agents) {
    mkdirSync(destBase, { recursive: true });
    cpSync(join(AGENTS_SRC, agent), join(destBase, agent));
    copied.push(agent.replace(".md", ""));
  }

  return copied;
}

async function runGitHubAuth(): Promise<string> {
  p.log.info("Authenticate with GitHub to verify your identity as team host.");
  const flow = await startDeviceFlow();
  p.log.info(`Open ${flow.verificationUri} and enter code: ${flow.userCode}`);
  const spinner = p.spinner();
  spinner.start("Waiting for GitHub authorization…");
  try {
    const token = await pollForToken(flow.deviceCode, flow.interval, flow.expiresIn);
    const username = await getGitHubUsername(token);
    spinner.stop(`Authenticated as @${username}`);
    return username;
  } catch (err) {
    spinner.stop("GitHub authentication failed");
    p.log.error(String(err));
    process.exit(1);
  }
}

export async function main(): Promise<void> {
  p.intro("knowledge-base init");

  const db = openDb();
  const workspaces = listWorkspaces(db);

  const selected = await p.select<string>({
    message: "Select a workspace:",
    options: [
      ...workspaces.map((w) => ({ value: w.name, label: w.name })),
      { value: CREATE_NEW, label: "+ Create new workspace" },
    ],
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  let workspaceName: string;

  if ((selected) === CREATE_NEW) {
    const name = await p.text({
      message: "Workspace name:",
      placeholder: "my-project",
      validate: (v: string | undefined) => (!v?.trim() ? "Name cannot be empty" : undefined),
    });

    if (p.isCancel(name)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    createWorkspace(db, name);
    workspaceName = name;
  } else {
    workspaceName = selected;
  }

  writeWorkspaceToClaude(workspaceName);
  p.log.success(`Written knowledge-base block to CLAUDE.md (workspace: ${workspaceName})`);

  // Identity setup (global, stored once)
  const settings = loadSettings();
  if (!settings.identity) {
    p.log.info("Set your identity (used to track who created/updated documents in team mode).");
    const identityName = await p.text({
      message: "Your name:",
      placeholder: "Alice",
      validate: (v) => (!v?.trim() ? "Name cannot be empty" : undefined),
    });
    if (p.isCancel(identityName)) { p.cancel("Cancelled."); process.exit(0); }

    const identityEmail = await p.text({
      message: "Your email:",
      placeholder: "alice@example.com",
      validate: (v) => (!v?.trim() ? "Email cannot be empty" : undefined),
    });
    if (p.isCancel(identityEmail)) { p.cancel("Cancelled."); process.exit(0); }

    const updated = loadSettings();
    updated.identity = { name: identityName, email: identityEmail };
    writeSettings(updated);
    p.log.success(`Identity saved: ${identityName} <${identityEmail}>`);
  } else {
    p.log.info(`Identity: ${settings.identity.name} <${settings.identity.email}>`);
  }

  // Team mode setup for this workspace
  const ws = createWorkspace(db, workspaceName);
  const hasTeam = getTeamByName(db, workspaceName);
  if (!hasTeam) {
    const teamMode = await p.select<string>({
      message: `Enable team mode for workspace "${workspaceName}"?`,
      options: [
        { value: "create", label: "Create new team (you are the host)" },
        { value: SKIP,    label: "Skip — solo mode" },
      ],
    });
    if (p.isCancel(teamMode)) { p.cancel("Cancelled."); process.exit(0); }

    if ((teamMode) === "create") {
      const githubUsername = await runGitHubAuth();

      const kp = generateNoiseKeypair();
      insertTeam(db, ws.id, {
        role: "host",
        secret: generateSecret(),
        noise_public_key: kp.publicKey,
        noise_secret_key: kp.secretKey,
        host_public_key: null,
        last_synced_at: null,
      });
      const fresh = loadSettings();
      fresh.identity = { ...(fresh.identity ?? { name: "", email: "" }), github_username: githubUsername };
      writeSettings(fresh);
      p.log.success(`Team created. Invite peers with:`);
      p.log.info(`  knowledge-base team invite --workspace ${workspaceName} @<github-username>`);
    }
  } else if (hasTeam.noise_secret_key.length === STALE_KEY_HEX_LEN) {
    // stale Ed25519 keypair (seed-only, 32 bytes) — auto-migrate
    p.log.warn(`Outdated keypair detected for "${workspaceName}" — auto-migrating to Ed25519.`);
    const kp = generateNoiseKeypair();
    updateTeamKeypair(db, hasTeam.workspace_id, kp.publicKey, kp.secretKey);
    p.log.success("Keypair migrated.");
    p.log.warn(`Restart team server to apply the new keypair: knowledge-base team server --workspace ${workspaceName}`);
  } else {
    const reconfigureChoice = await p.select<string>({
      message: `Team mode already configured for "${workspaceName}" (role: ${hasTeam.role}). What would you like to do?`,
      options: [
        { value: "keep",        label: "Keep existing configuration" },
        { value: "reconfigure", label: "Reconfigure — generate new keypair (disconnects current peers)" },
      ],
    });
    if (p.isCancel(reconfigureChoice)) { p.cancel("Cancelled."); process.exit(0); }

    if ((reconfigureChoice) === "reconfigure") {
      p.log.warn("All peers connected to this team will lose their connection. They will need to re-join.");
      const confirmReconfig = await p.confirm({
        message: "Continue with reconfiguration?",
        initialValue: false,
      });
      if (p.isCancel(confirmReconfig) || !confirmReconfig) {
        p.log.info("Reconfiguration cancelled. Existing configuration kept.");
      } else {
        const githubUsername = await runGitHubAuth();
        const kp = generateNoiseKeypair();
        updateTeamKeypair(db, hasTeam.workspace_id, kp.publicKey, kp.secretKey);
        const fresh = loadSettings();
        fresh.identity = { ...(fresh.identity ?? { name: "", email: "" }), github_username: githubUsername };
        writeSettings(fresh);
        p.log.success("Keypair reconfigured.");
        p.log.warn(`Restart team server to apply the new keypair: knowledge-base team server --workspace ${workspaceName}`);
      }
    }
  }

  if (isModelReady()) {
    p.log.info("Embedding model already cached — skipping download.");
  } else {
    const modelSpinner = p.spinner();
    modelSpinner.start("Downloading embedding model (~120 MB, first time only)…");
    try {
      await getEmbedding("warm-up");
      modelSpinner.stop("Embedding model downloaded.");
    } catch (err) {
      modelSpinner.stop("Model download failed. Run `npx @vulhdev/knowledge-base init` again to retry.");
      p.log.warn(String(err));
    }
  }

  if (isCrsqliteReady()) {
    p.log.info("cr-sqlite extension already cached — skipping download.");
  } else {
    const crsqliteSpinner = p.spinner();
    crsqliteSpinner.start("Downloading cr-sqlite extension (~1 MB, first time only)…");
    try {
      await downloadCrsqlite();
      crsqliteSpinner.stop("cr-sqlite extension downloaded.");
    } catch (err) {
      crsqliteSpinner.stop("cr-sqlite download failed. Run `npx @vulhdev/knowledge-base init` again to retry.");
      p.log.warn(String(err));
    }
  }

  const skillsDest = await p.select<string>({
    message: "Install Claude Code skills?",
    options: [
      {
        value: join(homedir(), ".claude", "skills"),
        label: "Global (~/.claude/skills/)",
        hint: "available in all projects",
      },
      {
        value: join(process.cwd(), ".claude", "skills"),
        label: "This project (./.claude/skills/)",
        hint: "current project only",
      },
      { value: SKIP, label: "Skip" },
    ],
  });

  if (!p.isCancel(skillsDest) && (skillsDest) !== SKIP) {
    const copied = copySkills(skillsDest);
    if (copied.length > 0) {
      writeFileSync(join(skillsDest, VERSION_MARKER), VERSION, "utf8");
      p.log.success(`Installed ${copied.length} skills to ${skillsDest}`);
      for (const skill of copied) p.log.info(`  /${skill}`);
    } else {
      p.log.warn("No skills found to install.");
    }
  }

  const agentsDest = await p.select<string>({
    message: "Install Claude Code agents?",
    options: [
      {
        value: join(homedir(), ".claude", "agents"),
        label: "Global (~/.claude/agents/)",
        hint: "available in all projects",
      },
      {
        value: join(process.cwd(), ".claude", "agents"),
        label: "This project (./.claude/agents/)",
        hint: "current project only",
      },
      { value: SKIP, label: "Skip" },
    ],
  });

  if (!p.isCancel(agentsDest) && (agentsDest) !== SKIP) {
    const copied = copyAgents(agentsDest);
    if (copied.length > 0) {
      writeFileSync(join(agentsDest, VERSION_MARKER), VERSION, "utf8");
      p.log.success(`Installed ${copied.length} agents to ${agentsDest}`);
      for (const agent of copied) p.log.info(`  ${agent}`);
    } else {
      p.log.warn("No agents found to install.");
    }
  }

  p.outro("Done. Restart Claude Code to pick up the new skills and agents.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
