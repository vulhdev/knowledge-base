import type { PeerRow } from "../../team/kick.js";
import { layout, esc } from "./_layout.js";

function renderPeerRow(workspace: string, peer: PeerRow): string {
  const username = peer.github_username ? `@${esc(peer.github_username)}` : esc(peer.display_name);
  const joined = peer.joined_at.slice(0, 10);

  if (peer.is_active) {
    const confirmMsg = `Remove @${peer.github_username ?? peer.display_name} from team?`;
    return `<tr>
      <td class="peer-status">●</td>
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

  return `<tr class="peer-kicked">
    <td class="peer-status">○</td>
    <td class="peer-name">${username} <span class="kicked-label">(kicked)</span></td>
    <td class="peer-joined">${esc(joined)}</td>
    <td></td>
  </tr>`;
}

export function renderTeamPage(workspace: string, peers: PeerRow[]): string {
  const crumb = `<p class="breadcrumb"><a href="/">Home</a> / <a href="/ws/${encodeURIComponent(workspace)}">${esc(workspace)}</a> / Team</p>`;

  const bodyContent = peers.length === 0
    ? `<p class="empty-state">No team members yet. Use <code>knowledge-base team invite</code> to add someone.</p>`
    : `<table class="team-table">
        <thead><tr><th></th><th>Member</th><th>Joined</th><th></th></tr></thead>
        <tbody>${peers.map((p) => renderPeerRow(workspace, p)).join("\n")}</tbody>
       </table>`;

  const body = `${crumb}<h1>Team Members</h1>${bodyContent}`;
  return layout(`Team — ${esc(workspace)}`, body);
}
