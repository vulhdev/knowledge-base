#!/usr/bin/env node
// Seeds the host DB: workspace + team config + 3 docs + invite for e2e-peer.
// Writes the invite code to /shared/invite.txt.
import { writeFileSync, mkdirSync } from "node:fs";
import { openDb } from "/app/dist/db/client.js";
import { createWorkspace } from "/app/dist/db/workspaces.js";
import { insertTeam } from "/app/dist/db/team.js";
import { generateNoiseKeypair, generateSecret } from "/app/dist/team/generate.js";
import { generateInvite } from "/app/dist/team/invite.js";

const WORKSPACE = "e2e-workspace";
const PEER_USERNAME = "e2e-peer";

const db = openDb();
const ws = createWorkspace(db, WORKSPACE);

const kp = generateNoiseKeypair();
const secret = generateSecret();
insertTeam(db, ws.id, {
  role: "host",
  secret,
  noise_public_key: kp.publicKey,
  noise_secret_key: kp.secretKey,
  host_public_key: null,
  last_synced_at: null,
});

const features = ["alpha", "beta", "gamma"];
for (const featureName of features) {
  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, featureName);
  const feature = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, featureName);
  const row = db
    .prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?) RETURNING id")
    .get("doc", `${featureName} doc`, `E2E seed content for ${featureName}`);
  db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(row.id, feature.id);
}

const invite = generateInvite(db, WORKSPACE, PEER_USERNAME);

mkdirSync("/shared", { recursive: true });
writeFileSync("/shared/invite.txt", invite);
console.log(`[seed-host] Seeded 3 docs. Invite written to /shared/invite.txt`);
