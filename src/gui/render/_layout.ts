const GOOGLE_FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap";

export function searchBar(defaultQ = "", defaultWs = ""): string {
  return `
    <form class="search-form" method="get" action="/search">
      <input name="q" type="search" placeholder="Search…" value="${esc(defaultQ)}" />
      ${defaultWs ? `<input type="hidden" name="workspace" value="${esc(defaultWs)}" />` : ""}
      <button type="submit">Search</button>
    </form>`;
}

export function layout(title: string, body: string, searchQ = "", searchWs = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — knowledge-base</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="${GOOGLE_FONTS}" />
  <link rel="stylesheet" href="/assets/app.css" />
</head>
<body>
  <header>
    <nav class="nav">
      <a href="/" class="nav-brand"><img src="/assets/kb-lockup-tagline-dark.png" alt="knowledge-base" /></a>
      <a href="/search" class="nav-link">Search</a>
      <a href="/errors" class="nav-link">Errors</a>
    </nav>
  </header>
  <main>
    ${searchBar(searchQ, searchWs)}
    ${body}
  </main>
</body>
</html>`;
}

export function typeBadge(type: string): string {
  const colors: Record<string, string> = {
    spec: "#7c3aed",
    plan: "#a15100",
    idea: "#1d4ed8",
  };
  const bg = colors[type] ?? "#41474f";
  return `<span class="badge" style="background:${bg}">${esc(type)}</span>`;
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
