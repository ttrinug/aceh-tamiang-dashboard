// Publish to GitHub tab: shows the changed files in config/ and data/web/ and any commits not
// yet pushed, then commits and pushes them through the admin server.

const STATUS = { M: 'Changed', A: 'Added', D: 'Removed', R: 'Renamed', '??': 'New' };

function formatSize(bytes) {
  if (bytes === null) return '—';
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function setupGitTab({ api, el, showMessage }) {
  const changesBody = document.getElementById('git-changes');
  const unpushed = document.getElementById('git-unpushed');
  const branch = document.getElementById('git-branch');
  const message = document.getElementById('git-message');
  const push = document.getElementById('git-push');
  const status = document.getElementById('git-status');
  const label = push.textContent;

  async function refresh() {
    const state = await api('GET', '/api/git');
    const behind = state.behind ? `; GitHub has ${state.behind} newer commit(s), so ask Claude to bring them in first` : '';
    branch.textContent = `Branch ${state.branch}${behind}.`;
    changesBody.replaceChildren(...(state.changes.length
      ? state.changes.map((c) => el('tr', {}, [
        el('td', { text: STATUS[c.status] ?? c.status }),
        el('td', {}, el('code', { text: c.path })),
        el('td', { text: formatSize(c.size), class: c.size > 50e6 ? 'flag' : '' })
      ]))
      : [el('tr', {}, el('td', { colSpan: 3, class: 'muted', text: 'No changed files.' }))]));
    unpushed.replaceChildren(...(state.unpushed.length
      ? [el('p', { text: `Already committed, waiting to be pushed (${state.unpushed.length}):` }), el('ul', {}, state.unpushed.map((line) => el('li', {}, el('code', { text: line }))))]
      : []));
    if (!message.value) message.value = `Update dashboard data (${new Date().toISOString().slice(0, 10)})`;
    const nothing = !state.changes.length && !state.unpushed.length;
    push.disabled = nothing;
    status.textContent = nothing
      ? 'Nothing to publish: GitHub already has everything in config/ and data/web/.'
      : `Ready to publish: ${state.changes.length} changed file(s)${state.unpushed.length ? ` and ${state.unpushed.length} waiting commit(s)` : ''}.`;
    return state;
  }

  document.getElementById('git-refresh').addEventListener('click', () => refresh().catch((error) => showMessage(error.message, true)));

  push.addEventListener('click', async () => {
    const state = await refresh().catch((error) => showMessage(error.message, true));
    if (!state) return;
    const count = state.changes.length;
    const summary = count ? `${count} changed file(s)` : `${state.unpushed.length} waiting commit(s)`;
    if (!confirm(`Publish ${summary} to the public GitHub repository and live site?`)) return;
    push.disabled = true;
    push.setAttribute('aria-busy', 'true');
    push.textContent = 'Publishing…';
    status.textContent = 'Committing and pushing. This usually takes a few seconds; a GitHub sign-in window may open.';
    showMessage('Committing and pushing…');
    try {
      const result = await api('POST', '/api/git/push', { message: message.value });
      if (!result.pushed) showMessage(result.note);
      else showMessage(`Pushed${result.committed ? ` ${result.committed}` : ''}. The live site updates in a few minutes; a browser that opened it recently may need Ctrl+Shift+R.`);
      message.value = '';
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      push.removeAttribute('aria-busy');
      push.textContent = label;
      await refresh().catch(() => {});
    }
  });

  document.querySelector('[data-tab="github"]').addEventListener('click', () => refresh().catch((error) => showMessage(error.message, true)));
}
