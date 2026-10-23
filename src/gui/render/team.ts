import type { PeerRow } from "../../team/kick.js";
import { layout, esc } from "./_layout.js";

function peerBadge(peer: PeerRow): string {
  if (peer.is_active === 0) return `<span class="peer-badge peer-badge-kicked">KICKED</span>`;
  if (peer.last_seen_at !== null) return `<span class="peer-badge peer-badge-online">ONLINE</span>`;
  return `<span class="peer-badge peer-badge-offline">OFFLINE</span>`;
}

function renderPeerRow(workspace: string, peer: PeerRow): string {
  const username = peer.github_username ? `@${esc(peer.github_username)}` : esc(peer.display_name);
  const joined = peer.joined_at.slice(0, 10);
  const badge = peerBadge(peer);

  if (peer.is_active === 1) {
    const confirmMsg = `Remove @${peer.github_username ?? peer.display_name} from team?`;
    return `<tr>
      <td>${badge}</td>
      <td class="peer-name">${username}</td>
      <td class="peer-joined">${esc(joined)}</td>
      <td>
        <form method="post" action="/ws/${encodeURIComponent(workspace)}/team/kick"
              onsubmit="return confirm('${esc(confirmMsg)}')">
          <input type="hidden" name="github_username" value="${esc(peer.github_username ?? peer.display_name)}" />
          <button type="submit" class="btn-remove">Remove</button>
        </form>
      </td>
    </tr>`;
  }

  const confirmMsg = `Permanently delete ${peer.github_username ?? peer.display_name}? They can be re-invited after.`;
  return `<tr class="peer-kicked">
    <td>${badge}</td>
    <td class="peer-name">${username}</td>
    <td class="peer-joined">${esc(joined)}</td>
    <td>
      <form method="post" action="/ws/${encodeURIComponent(workspace)}/team/delete"
            onsubmit="return confirm('${esc(confirmMsg)}')">
        <input type="hidden" name="github_username" value="${esc(peer.github_username ?? peer.display_name)}" />
        <button type="submit" class="btn-delete">Delete</button>
      </form>
    </td>
  </tr>`;
}

export function renderTeamPage(workspace: string, peers: PeerRow[]): string {
  const crumb = `<p class="breadcrumb"><a href="/">Home</a> / <a href="/ws/${encodeURIComponent(workspace)}">${esc(workspace)}</a> / Team</p>`;

  const bodyContent = peers.length === 0
    ? `<p class="empty-state">No team members yet. Use <code>knowledge-base team invite</code> to add someone.</p>`
    : `<table class="team-table">
        <thead><tr><th>Status</th><th>Member</th><th>Joined</th><th></th></tr></thead>
        <tbody>${peers.map((p) => renderPeerRow(workspace, p)).join("\n")}</tbody>
       </table>`;

  const body = `${crumb}<h1>Team Members</h1>${bodyContent}`;
  return layout(`Team — ${esc(workspace)}`, body);
}
