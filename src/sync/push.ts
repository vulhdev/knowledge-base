const activePushers = new Map<string, Set<() => void>>();

export function registerPusher(workspace: string, push: () => void): () => void {
  let pushers = activePushers.get(workspace);
  if (!pushers) {
    pushers = new Set();
    activePushers.set(workspace, pushers);
  }
  pushers.add(push);
  return () => {
    pushers.delete(push);
    if (pushers.size === 0) activePushers.delete(workspace);
  };
}

export function pushToWorkspace(workspace: string): void {
  const pushers = activePushers.get(workspace);
  if (!pushers) return;
  for (const push of pushers) push();
}

export function pushToAllWorkspaces(): void {
  for (const workspace of activePushers.keys()) pushToWorkspace(workspace);
}
