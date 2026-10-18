import { lazy, Suspense, useEffect } from 'react';
import { needsAttention } from '@nabi/protocol';
import { Details } from './panel/Details';
import { agentMark, sessionLine } from './panel/sessionLine';
import { useStation, type Connection } from './state/store';
import { SceneLabels } from './city/LabelLayer';
import { Icon } from './Icon';

const Scene = lazy(() =>
  import('./city/Scene').then((module) => ({ default: module.Scene })),
);

const connectionLabel: Record<Connection, string> = {
  demo: 'Local demo',
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Daemon offline',
};

export function App() {
  const {
    world,
    connection,
    view,
    setView,
    selection,
    select,
    paused,
    togglePaused,
    reducedMotion,
    setReducedMotion,
    nextAttention,
    focus,
  } = useStation();
  const attention = world.agents.filter(needsAttention).length;
  const sessions = world.agents.filter((agent) => agent.activity !== 'ended');
  const projects = new Set(sessions.map((agent) => agent.repoId ?? agent.cwd))
    .size;
  const working = sessions.flatMap((agent) =>
    (agent.helpers ?? []).filter((helper) => helper.state === 'active'),
  ).length;
  const hasSessions = (repoId: string) =>
    sessions.some((agent) => agent.repoId === repoId);
  const live = world.mode === 'live';
  // No world from the daemon yet: show nothing rather than anything invented.
  const waiting = connection !== 'demo' && world.version === 0;
  const district =
    world.districts.length === 1
      ? world.districts[0]!
      : world.districts.length === 0
        ? { name: 'Not connected', rootPath: 'Start the Nabi daemon' }
        : {
            name: `${world.districts.length} districts`,
            rootPath: world.districts.map((d) => d.rootPath).join(' · '),
          };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        target?.closest(
          'input, select, textarea, button, [contenteditable="true"]',
        )
      )
        return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        nextAttention();
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [focus, nextAttention]);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to workspace
      </a>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView('sessions');
          }}
          aria-label="Nabi Station home"
        >
          <span className="brand-symbol" aria-hidden="true">
            <Icon name="terminal" size={17} />
          </span>
          <span>
            Nabi <b>Station</b>
          </span>
        </a>
        <nav className="segmented" aria-label="Workspace view">
          <button
            onClick={() => setView('sessions')}
            aria-pressed={view === 'sessions'}
          >
            <Icon name="activity" size={15} />
            Active sessions
          </button>
          <button
            onClick={() => setView('city')}
            aria-pressed={view === 'city'}
          >
            <Icon name="city" size={15} />
            Workspace
          </button>
          <button
            onClick={() => setView('gallery')}
            aria-pressed={view === 'gallery'}
          >
            <Icon name="assets" size={15} />
            Asset gallery
          </button>
        </nav>
        <div className="connection">
          <span className={`status-dot ${connection}`} />{' '}
          {connectionLabel[connection]} <span className="version">v0.1</span>
        </div>
      </header>
      <div className="workspace-layout">
        <aside className="sidebar" aria-label="Workspace navigation">
          <p className="eyebrow">Workspace</p>
          <h2>{district.name}</h2>
          <p className="root-path">{district.rootPath}</p>
          <div className="sidebar-section-heading">
            <span>Active sessions</span>
            <span>{sessions.length.toString().padStart(2, '0')}</span>
          </div>
          <div className="agent-list">
            {sessions.length === 0 && (
              <p className="sidebar-empty">
                {waiting ? 'Waiting for the daemon.' : 'No sessions running.'}
              </p>
            )}
            {sessions.map((agent) => (
              <button
                className={`agent-nav ${selection?.id === agent.id ? 'active' : ''}`}
                key={agent.id}
                onClick={() => {
                  select({ kind: 'agent', id: agent.id });
                  setView('sessions');
                }}
              >
                <span className={`avatar ${agent.kind}`}>
                  {agentMark(agent.kind)}
                </span>
                <span>
                  <strong>{agent.name}</strong>
                  <small className={needsAttention(agent) ? 'amber-text' : ''}>
                    {sessionLine(agent)}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="sidebar-section-heading">
            <span>Repositories</span>
            <span>{world.repos.length.toString().padStart(2, '0')}</span>
          </div>
          <div className="repo-list">
            {world.repos.map((repo) => (
              <button
                key={repo.id}
                className={`repo-button ${selection?.id === repo.id ? 'active' : ''}`}
                onClick={() => {
                  select({ kind: 'repo', id: repo.id });
                  setView(hasSessions(repo.id) ? 'sessions' : 'city');
                }}
              >
                <span className={`repo-dot ${repo.building.archetype}`} />
                <span>{repo.name}</span>
                {hasSessions(repo.id) && <i className="tiny-dot" />}
              </button>
            ))}
          </div>
          <div className="sidebar-bottom">
            <Icon name="activity" size={15} />
            <span>
              {connectionLabel[connection]}
              <small>{live ? 'Local observation' : 'Sample workspace'}</small>
            </span>
            <span className={`status-dot ${connection}`} />
          </div>
        </aside>
        <main id="main" className="city-panel" tabIndex={-1}>
          <div className="scene-heading">
            <div>
              <h1>
                {view === 'sessions'
                  ? 'Active sessions'
                  : view === 'city'
                    ? 'Workspace overview'
                    : 'Asset preview'}
              </h1>
              <p>
                {view === 'sessions'
                  ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} in ${projects} ${projects === 1 ? 'project' : 'projects'} / ${working} ${working === 1 ? 'helper' : 'helpers'} working`
                  : view === 'city'
                    ? `${world.repos.length} repositories / ${world.agents.length} agents`
                    : 'Models / helpers / animations / architecture'}
              </p>
            </div>
            <span className="demo-badge">
              {connection === 'demo'
                ? 'Demo workspace'
                : waiting
                  ? 'Not connected'
                  : 'Live workspace'}
            </span>
          </div>
          <div
            className="scene-container"
            aria-label={
              view === 'sessions'
                ? 'Active sessions and their helpers'
                : view === 'city'
                  ? 'Interactive workspace city'
                  : 'Interactive asset gallery'
            }
          >
            <Suspense
              fallback={<div className="scene-fallback">Loading viewport…</div>}
            >
              <Scene />
            </Suspense>
            <SceneLabels />
            {waiting && view !== 'gallery' && (
              <div className="not-connected" role="status">
                <h2>
                  {connection === 'connecting'
                    ? 'Connecting to the Nabi daemon…'
                    : 'Not connected to the Nabi daemon'}
                </h2>
                <p>
                  Nothing is shown until real data arrives. Start the daemon
                  with the folders to watch, then reload this page:
                </p>
                <code>pnpm nabi serve D:/path/to/your/projects</code>
                <p className="muted">
                  It can also read the folders from <code>roots</code> in{' '}
                  <code>~/.nabi/config.json</code>. Sample data is available at{' '}
                  <a href="?demo">?demo</a>.
                </p>
              </div>
            )}
            {!waiting && view === 'sessions' && sessions.length === 0 && (
              <div className="not-connected" role="status">
                <h2>No active sessions</h2>
                <p>
                  Claude Code, Codex and Cursor sessions appear here as soon as
                  they start, with the tools they hand work to around them.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setView('city')}
                >
                  <Icon name="city" size={14} />
                  <span>Browse workspace</span>
                </button>
              </div>
            )}
          </div>
          <div className="scene-bottom">
            <div className="legend">
              <span>
                <i className="legend-dot blue" /> Working
              </span>
              <span>
                <i className="legend-dot teal" /> Helper working
              </span>
              <span>
                <i className="legend-dot amber" /> Attention
              </span>
              <span>
                <i className="legend-dot grey" /> Idle
              </span>
            </div>
            <p>
              Drag to pan <span>·</span> Scroll to zoom <span>·</span>{' '}
              <kbd>F</kbd> Focus
            </p>
          </div>
          <div className="scene-toolbar">
            <button
              className={`attention-button ${attention ? 'has-attention' : ''}`}
              onClick={nextAttention}
            >
              <Icon name="activity" size={14} />
              {attention
                ? `${attention} ${attention === 1 ? 'agent requires' : 'agents require'} attention`
                : 'No alerts'}{' '}
              <kbd>N</kbd>
            </button>
            <div className="motion-controls">
              <button onClick={togglePaused} aria-pressed={paused}>
                <Icon name={paused ? 'play' : 'pause'} size={13} />
                {paused ? 'Resume' : 'Pause'} animations
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={(event) => setReducedMotion(event.target.checked)}
                />{' '}
                Reduced motion
              </label>
            </div>
          </div>
        </main>
        <Details />
      </div>
      <footer className="statusbar">
        <span>
          <Icon name="shield" size={12} /> Local only
        </span>
        <span>
          {world.repos.length} repositories <span className="divider">/</span>{' '}
          {world.agents.length} agents <span className="divider">/</span>{' '}
          {connection === 'demo'
            ? 'Fixture snapshot'
            : waiting
              ? 'Not connected'
              : `Updated ${new Date(world.updatedAt).toLocaleTimeString()}`}
        </span>
      </footer>
    </div>
  );
}
