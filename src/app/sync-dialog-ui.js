/** Preserve sync modal disclosure state and scroll across root.innerHTML renders. */
export function captureSyncDialogUi(root) {
  const modal = root.querySelector('.modal');
  if (!modal) return null;
  return {
    scrollTop: modal.scrollTop,
    expanded: Array.from(modal.querySelectorAll('details.sync-fallback'), element => element.open),
  };
}

export function restoreSyncDialogUi(root, snapshot) {
  if (!snapshot) return;
  const modal = root.querySelector('.modal');
  if (!modal) return;
  modal.querySelectorAll('details.sync-fallback').forEach((element, i) => {
    element.open = Boolean(snapshot.expanded[i]);
  });
  modal.scrollTop = snapshot.scrollTop;
}

/** Update only the live progress element, avoiding full DOM replacement per page. */
export function updateSyncStatus(root, message) {
  const status = root.querySelector('#sync-public-progress');
  if (status) {
    status.textContent = message;
    status.hidden = !message;
  }
}
