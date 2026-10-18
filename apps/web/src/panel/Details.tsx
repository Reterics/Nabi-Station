import {
  animationClips,
  characterKinds,
  helperCategoryNames,
  needsAttention,
  type AgentNpc,
  type AnimationClip,
} from '@nabi/protocol';
import { requestAgentFocus } from '../live/connection';
import { selectedRepoId, useStation } from '../state/store';
import { Icon } from '../Icon';
import { Assessment } from './Assessment';
import {
  activityLabel,
  agentKindName,
  agentMark,
  sessionLine,
} from './sessionLine';

const tierNames = [
  'Empty plot',
  'Construction',
  'Small building',
  'Established',
  'Landmark',
];
export { activityLabel } from './sessionLine';

/** Brings the session's terminal (or editor) window forward so the user can answer. */
function SessionFocus({ agent }: { agent: AgentNpc }) {
  const status = useStation((state) =>
    state.focusStatus?.agentId === agent.id ? state.focusStatus : null,
  );
  if (!agent.pid && !agent.cwd) return null;
  return (
    <div className="session-focus">
      <button
        className={`session-button ${needsAttention(agent) ? 'attention' : ''}`}
        disabled={status?.state === 'pending'}
        onClick={() => requestAgentFocus(agent.id)}
      >
        {needsAttention(agent)
          ? 'Answer in terminal'
          : 'Bring session to front'}
        <span aria-hidden="true">↗</span>
      </button>
      {status && (
        <p className={`focus-status ${status.state}`} role="status">
          {status.message}
        </p>
      )}
    </div>
  );
}

const helperStateText = {
  active: 'working now',
  waiting: 'awaiting approval',
  failed: 'last call failed',
  recent: 'used recently',
} as const;

/** The tools this session has handed work to, as observed in its own log. */
function Helpers({ agent }: { agent: AgentNpc }) {
  const helpers = agent.helpers ?? [];
  return (
    <div className="detail-section">
      <h3>
        Helpers <span className="subtle">{helpers.length}</span>
      </h3>
      {helpers.length === 0 ? (
        <p className="muted">
          No MCP servers, web requests or subagents in the last 15 minutes.
        </p>
      ) : (
        helpers.map((helper) => (
          <div className={`helper-row ${helper.state}`} key={helper.id}>
            <span className={`helper-swatch ${helper.category}`} />
            <div>
              <strong>{helper.label}</strong>
              <small>
                {helperCategoryNames[helper.category]} ·{' '}
                {helperStateText[helper.state]}
                {helper.tool && (
                  <>
                    {' '}
                    · <code>{helper.tool}</code>
                  </>
                )}
              </small>
            </div>
            <span className="subtle">×{helper.calls}</span>
          </div>
        ))
      )}
    </div>
  );
}

/** How the state was observed: reported vs inferred, and from what. */
function Observation({ agent, demo }: { agent: AgentNpc; demo: boolean }) {
  return (
    <>
      {!demo && <SessionFocus agent={agent} />}
      <div className="note">
        <strong>
          {agent.confidence === 'reported'
            ? 'Reported state'
            : `Inferred · ${agent.confidence} confidence`}
        </strong>
        <br />
        {demo ? (
          <>
            Source: {agent.source}. This is an example observation, not a live
            session.
          </>
        ) : (
          <>
            Source: {agent.source}.
            {agent.detail && (
              <>
                <br />
                Observed: <code>{agent.detail}</code>
              </>
            )}
            {agent.cwd && (
              <>
                <br />
                Folder: <code>{agent.cwd}</code>
              </>
            )}
            {agent.pid && (
              <>
                <br />
                Process: <code>{agent.pid}</code>
              </>
            )}
            {agent.updatedAt && (
              <>
                <br />
                Last activity {new Date(agent.updatedAt).toLocaleTimeString()}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function Details() {
  const {
    world,
    selection,
    select,
    view,
    gallery,
    setGallery,
    clip,
    setClip,
    tier,
    setTier,
    focus,
  } = useStation();
  if (view === 'gallery')
    return (
      <aside className="details" aria-label="Asset controls">
        <p className="eyebrow">Inspector</p>
        <h2>Asset gallery</h2>
        <p className="muted">Inspect models and animation clips.</p>
        <div className="segmented compact" aria-label="Asset category">
          <button
            aria-pressed={gallery === 'characters'}
            onClick={() => setGallery('characters')}
          >
            Characters
          </button>
          <button
            aria-pressed={gallery === 'helpers'}
            onClick={() => setGallery('helpers')}
          >
            Helpers
          </button>
          <button
            aria-pressed={gallery === 'buildings'}
            onClick={() => setGallery('buildings')}
          >
            Buildings
          </button>
        </div>
        {gallery === 'helpers' ? (
          <p className="note">
            One figure per helper category, shown working. In a session, MCP
            servers, web requests and subagents stand around the agent that
            called them and light up while it waits on them.
          </p>
        ) : gallery === 'characters' ? (
          <>
            <label className="field-label" htmlFor="animation">
              Animation clip
            </label>
            <select
              id="animation"
              value={clip}
              onChange={(event) => setClip(event.target.value as AnimationClip)}
            >
              {animationClips.map((clip) => (
                <option key={clip}>{clip}</option>
              ))}
            </select>
            <div className="detail-section">
              <h3>
                Agent models{' '}
                <span className="subtle">{characterKinds.length}</span>
              </h3>
              {characterKinds.map((kind) => (
                <div className="asset-row" key={kind}>
                  <span className={`avatar ${kind}`}>{agentMark(kind)}</span>
                  <div>
                    <strong>{agentKindName(kind)}</strong>
                    <small>Skinned GLB · 10 clips</small>
                  </div>
                </div>
              ))}
            </div>
            <p className="note">Animation preview. Clips play in place.</p>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="tier">
              Building tier · {tier}
            </label>
            <input
              id="tier"
              type="range"
              min="0"
              max="4"
              value={tier}
              onChange={(event) => setTier(Number(event.target.value))}
            />
            <p>{tierNames[tier]}</p>
            <p className="note">
              Procedural geometry with capability modules. Adjust the tier to
              inspect each variation.
            </p>
          </>
        )}
      </aside>
    );

  const repo = world.repos.find(
    (repo) => repo.id === selectedRepoId(world, selection),
  );
  const agent =
    selection?.kind === 'agent'
      ? world.agents.find((agent) => agent.id === selection.id)
      : undefined;
  const agents = world.agents.filter((agent) => agent.repoId === repo?.id);
  return (
    <aside className="details" aria-label="Selection details">
      <p className="eyebrow">Inspector</p>
      <label className="sr-only" htmlFor="repository">
        Select repository
      </label>
      <select
        id="repository"
        value={repo?.id ?? ''}
        onChange={(event) => select({ kind: 'repo', id: event.target.value })}
      >
        <option disabled value="">
          Choose a repository
        </option>
        {world.repos.map((repo) => (
          <option key={repo.id} value={repo.id}>
            {repo.name}
          </option>
        ))}
      </select>
      {repo ? (
        <>
          <span className="tag entity-kind">
            {repo.language} · {repo.building.archetype}
          </span>
          <h2>{agent?.name ?? repo.name}</h2>
          <p className="muted">
            {agent ? `${sessionLine(agent)} · ${repo.name}` : repo.description}
          </p>
          <button className="primary-button" onClick={focus}>
            <Icon name="focus" size={14} />
            <span>Focus</span> <kbd>F</kbd>
          </button>
          {agent && <Helpers agent={agent} />}
          <div className="detail-section">
            <h3>Repository</h3>
            <div className="key-value">
              <span>Branch</span>
              <code>{repo.git.branch}</code>
            </div>
            <div className="git-stats">
              <span>
                <strong>{repo.git.modified}</strong> modified
              </span>
              <span>
                <strong>{repo.git.untracked}</strong> untracked
              </span>
              <span>
                <strong>↑ {repo.git.ahead}</strong> ahead
              </span>
              <span>
                <strong>↓ {repo.git.behind}</strong> behind
              </span>
            </div>
            <code className="repo-path">{repo.path}</code>
          </div>
          {/* Without a daemon analysis (demo data) only the fixture's tier is known. */}
          {!repo.analysis && (
            <div className="detail-section">
              <h3>
                {tierNames[repo.building.tier]}{' '}
                <span className="subtle">Tier {repo.building.tier}/4</span>
              </h3>
              <div
                className="tier-meter"
                aria-label={`Tier ${repo.building.tier} of 4`}
              >
                {[1, 2, 3, 4].map((tier) => (
                  <i
                    key={tier}
                    className={tier <= repo.building.tier ? 'filled' : ''}
                  />
                ))}
              </div>
              <div className="tags">
                {repo.building.modules.map((module) => (
                  <span key={module} className="tag">
                    ✓ {module}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="detail-section">
            <h3>
              Agents <span className="subtle">{agents.length}</span>
            </h3>
            {agents.length === 0 ? (
              <p className="muted">No agents at this repository.</p>
            ) : (
              agents.map((item) => (
                <button
                  className={`resident ${selection?.id === item.id ? 'active' : ''}`}
                  key={item.id}
                  onClick={() => select({ kind: 'agent', id: item.id })}
                >
                  <span className={`avatar ${item.kind}`}>
                    {agentMark(item.kind)}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small className={needsAttention(item) ? 'amber-text' : ''}>
                      {activityLabel(item.activity)}
                    </small>
                  </span>
                </button>
              ))
            )}
          </div>
          {agent && <Observation agent={agent} demo={world.mode === 'demo'} />}
          {repo.analysis && (
            <Assessment repo={repo} live={world.mode === 'live'} />
          )}
        </>
      ) : agent ? (
        <>
          <span className="tag">Outside the scanned repositories</span>
          <h2>{agent.name}</h2>
          <p className="muted">{sessionLine(agent)}</p>
          <Helpers agent={agent} />
          <Observation agent={agent} demo={world.mode === 'demo'} />
        </>
      ) : (
        <p className="muted">Select a repository or agent to inspect it.</p>
      )}
      <p className="panel-footnote">
        {world.mode === 'demo'
          ? 'Demo data · no repositories are being scanned.'
          : world.version === 0
            ? 'No data yet · waiting for the Nabi daemon.'
            : 'Live data · read on this device; nothing leaves it.'}
      </p>
    </aside>
  );
}
