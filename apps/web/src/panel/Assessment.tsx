import {
  checkAreas,
  maturities,
  maturityNames,
  type Check,
  type Repo,
  type RepoAnalysis,
} from '@nabi/protocol';
import { Recommendations } from './Recommendations';

const areaNames: Record<(typeof checkAreas)[number], string> = {
  documentation: 'Documentation',
  testing: 'Testing',
  quality: 'Code quality',
  automation: 'Automation',
  delivery: 'Delivery',
  maintenance: 'Maintenance',
};
const statusMark: Record<Check['status'], string> = {
  pass: '✓',
  partial: '◐',
  missing: '✕',
};
const activityText: Record<RepoAnalysis['activity'], string> = {
  active: 'Active this week',
  recent: 'Changed this month',
  quiet: 'Quiet for weeks',
  dormant: 'Dormant',
};

const bytes = (value: number) =>
  value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KiB`
    : `${(value / 1024 / 1024).toFixed(1)} MiB`;

/** The deterministic verdict, its evidence, and the local model's advice. */
export function Assessment({ repo, live }: { repo: Repo; live: boolean }) {
  const analysis = repo.analysis!;
  const level = maturities.indexOf(analysis.maturity);
  return (
    <>
      <div className="detail-section">
        <h3>
          {maturityNames[analysis.maturity]}{' '}
          <span className="subtle">Score {analysis.score}/100</span>
        </h3>
        <div
          className="tier-meter maturity-meter"
          aria-label={`${maturityNames[analysis.maturity]}, level ${level} of 4`}
        >
          {maturities.slice(1).map((maturity, index) => (
            <i
              key={maturity}
              title={maturityNames[maturity]}
              className={index < level ? 'filled' : ''}
            />
          ))}
        </div>
        <div className="assessment-facts">
          <div className="key-value">
            <span>Activity</span>
            <span className={`activity-pill ${analysis.activity}`}>
              {activityText[analysis.activity]}
            </span>
          </div>
          <div className="key-value">
            <span>Size</span>
            <code>
              {analysis.fileCount} files · {bytes(analysis.trackedBytes)}
            </code>
          </div>
          <div className="key-value">
            <span>Commits</span>
            <code>
              {analysis.commits.total} · {analysis.commits.last30Days} in 30 d ·{' '}
              {analysis.commits.authors90Days}{' '}
              {analysis.commits.authors90Days === 1 ? 'author' : 'authors'}
            </code>
          </div>
          <div className="key-value">
            <span>TODO / FIXME</span>
            <code>
              {analysis.todos.todo} / {analysis.todos.fixme}
            </code>
          </div>
        </div>
        <div className="tags assessment-tags">
          {analysis.languages.map((language) => (
            <span className="tag" key={language.name}>
              {language.name} {Math.round(language.share * 100)}%
            </span>
          ))}
          {analysis.frameworks.map((framework) => (
            <span className="tag framework" key={framework}>
              {framework}
            </span>
          ))}
          {analysis.packageManagers.map((manager) => (
            <span className="tag" key={manager}>
              {manager}
            </span>
          ))}
        </div>
      </div>
      <div className="detail-section">
        <h3>
          Checks{' '}
          <span className="subtle">
            {analysis.checks.filter((check) => check.status === 'pass').length}/
            {analysis.checks.length} passing
          </span>
        </h3>
        {checkAreas.map((area) => {
          const checks = analysis.checks.filter((check) => check.area === area);
          if (checks.length === 0) return null;
          return (
            <div className="check-group" key={area}>
              <p className="eyebrow">{areaNames[area]}</p>
              {checks.map((check) => (
                <div className={`check-row ${check.status}`} key={check.id}>
                  <span className="check-mark" aria-label={check.status}>
                    {statusMark[check.status]}
                  </span>
                  <div>
                    <strong>{check.label}</strong>
                    <small>{check.evidence}</small>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {analysis.scripts.length > 0 && (
          <div className="tags scripts">
            {analysis.scripts.slice(0, 12).map((script) => (
              <code key={script}>{script}</code>
            ))}
          </div>
        )}
      </div>
      <Recommendations repo={repo} live={live} />
    </>
  );
}
