import { useEffect, useId, useRef, useState } from 'react';
import type { Repo } from '@nabi/protocol';
import { requestRecommendations } from '../live/connection';
import { DEMO_MODEL, useStation } from '../state/store';

/** Clipboard API first; a hidden textarea where it is unavailable or refused. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

/**
 * Copies the fix prompt. A result without one (written before fix prompts existed, or
 * with nothing high or medium to fix) offers to write it instead of hiding the button.
 */
function CopyPromptButton({
  repoId,
  prompt,
}: {
  repoId: string;
  prompt?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2200);
    return () => clearTimeout(timer);
  }, [state]);
  if (!prompt)
    return (
      <button
        className="primary-button copy-prompt"
        title="This result has no fix prompt yet; Gemma writes one with fresh recommendations."
        onClick={() => requestRecommendations(repoId)}
      >
        Write fix prompt
      </button>
    );
  return (
    <button
      className="primary-button copy-prompt"
      onClick={async () =>
        setState((await copyText(prompt)) ? 'copied' : 'failed')
      }
    >
      {state === 'copied'
        ? 'Copied: paste it into your agent'
        : state === 'failed'
          ? 'Copy failed: select the text below'
          : 'Copy fix prompt'}
    </button>
  );
}

/** The local model's advice in a modal: strengths, improvements, and the fix prompt. */
function RecommendationsDialog({
  repo,
  open,
  onClose,
}: {
  repo: Repo;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const result = useStation((state) => state.recommendations[repo.id]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const fixes = result?.state === 'ready' ? result.recommendations : undefined;
  const target = fixes?.recommendedImprovements.some(
    (item) => item.priority === 'high',
  )
    ? 'high-priority'
    : 'medium-priority';
  return (
    <dialog
      ref={dialog}
      className="recommendations-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(event) => event.target === dialog.current && onClose()}
    >
      <header>
        <div>
          <p className="eyebrow">Recommendations · local model</p>
          <h2 id={titleId}>{repo.name}</h2>
        </div>
        <button className="dialog-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="dialog-body recommendations">
        {!result || result.state === 'pending' ? (
          <p className="muted" role="status">
            Gemma is reading the analysis… The first request loads the model and
            can take half a minute.
          </p>
        ) : result.state === 'unavailable' ? (
          <>
            <p className="focus-status error" role="status">
              Recommendations unavailable: {result.message}
            </p>
            <button
              className="session-button"
              onClick={() => requestRecommendations(repo.id)}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            {fixes!.strengths.length > 0 && (
              <>
                <h3>Strengths</h3>
                <ul className="strengths">
                  {fixes!.strengths.map((strength) => (
                    <li key={strength}>{strength}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>Improvements</h3>
            {fixes!.recommendedImprovements.map((item) => (
              <div
                className={`improvement ${item.priority}`}
                key={`${item.area}/${item.suggestion}`}
              >
                <div className="improvement-head">
                  <span className={`priority ${item.priority}`}>
                    {item.priority}
                  </span>
                  <strong>{item.area}</strong>
                </div>
                <p>{item.suggestion}</p>
                <small>{item.reason}</small>
              </div>
            ))}
            {fixes!.agentPrompt && (
              <div className="fix-prompt">
                <h3>Fix with an AI agent</h3>
                <p className="muted">
                  A task for Claude Code, Codex or Cursor covering the {target}{' '}
                  items. Paste it into a session running in this repository.
                </p>
                <pre tabIndex={0}>{fixes!.agentPrompt}</pre>
              </div>
            )}
            <p className="panel-footnote">
              {result.model === DEMO_MODEL ? (
                <>
                  Example recommendations for the demo workspace. With the
                  daemon, a local Gemma model writes these for your own
                  repositories.
                </>
              ) : (
                <>
                  Generated locally by {result.model} ·{' '}
                  {new Date(result.generatedAt).toLocaleString()}
                  {result.cached ? ' · cached' : ''}. Advice only; the maturity
                  and checks are rule-based.
                </>
              )}
            </p>
          </>
        )}
      </div>
      {fixes && (
        <footer>
          <CopyPromptButton repoId={repo.id} prompt={fixes.agentPrompt} />
        </footer>
      )}
    </dialog>
  );
}

/** Panel card: starts generation and opens the dialog; the advice itself lives there. */
export function Recommendations({ repo, live }: { repo: Repo; live: boolean }) {
  const result = useStation((state) => state.recommendations[repo.id]);
  const [open, setOpen] = useState(false);
  const ready = result?.state === 'ready' ? result.recommendations : undefined;
  const high =
    ready?.recommendedImprovements.filter((item) => item.priority === 'high')
      .length ?? 0;
  // Demo data only ever shows its built-in examples, never anything generated.
  const usable = live || Boolean(ready);
  return (
    <div className="detail-section recommendations-card">
      <h3>
        Recommendations{' '}
        <span className="subtle">{live ? 'local model' : 'demo example'}</span>
      </h3>
      {!usable ? (
        <p className="muted">
          Written by a local Gemma model through Ollama when the daemon runs.
          Nothing is generated for demo data.
        </p>
      ) : (
        <>
          <p className="muted" role="status">
            {!result
              ? 'Gemma reads the checks and writes advice plus a fix prompt for your agent. It runs in Ollama on this machine; nothing leaves it.'
              : result.state === 'pending'
                ? 'Gemma is writing… The first request loads the model.'
                : result.state === 'unavailable'
                  ? `Unavailable: ${result.message}`
                  : `${ready!.recommendedImprovements.length} improvements · ${high} high priority`}
          </p>
          <div className="card-actions">
            <button
              className="session-button"
              onClick={() => {
                if (!result || result.state === 'unavailable')
                  requestRecommendations(repo.id);
                setOpen(true);
              }}
            >
              {!result
                ? 'Write recommendations'
                : result.state === 'unavailable'
                  ? 'Try again'
                  : 'Open recommendations'}
            </button>
            {ready && (
              <CopyPromptButton repoId={repo.id} prompt={ready.agentPrompt} />
            )}
          </div>
        </>
      )}
      {usable && (
        <RecommendationsDialog
          repo={repo}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
