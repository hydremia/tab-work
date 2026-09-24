import { Link } from 'react-router';
import { useAllExportStatus, useAllProjectRollups, useProjects } from '../../data/hooks';
import type { ExportStatus } from '../../data/exportStatus';
import type { Project } from '../../data/types';
import { rollup, type Rollup } from '../../domain/completion';
import { IconFolder, IconLock, IconPlus, IconUpload } from '../components/Icons';
import { Screen } from '../components/Screen';
import { ProgressBar, RollupCounts } from '../components/Status';
import { ExportStateLine } from '../components/ExportReminder';
import { InstallPrompt } from '../components/PwaPrompts';

const SCOPE: Record<Project['scopeProfile'], string> = {
  full: 'Full TAB',
  airflow: 'Airflow Only',
  custom: 'Custom scope',
};

export function formatDate(iso: unknown): string {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ProjectCard({ project, r, ex }: { project: Project; r: Rollup; ex?: ExportStatus }) {
  const tab = formatDate(project.info.tabDate);
  return (
    <Link to={`/p/${project.id}/equipment`} className="card card-link project-card" data-testid="project-card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{project.name}</h2>
          <div className="meta">
            {[project.info.address, tab && `TAB ${tab}`].filter(Boolean).join(' · ') || 'No address yet'}
          </div>
        </div>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {project.lock && (
            <span className="chip chip-issued" data-testid="project-issued" title="Locked: the report was issued">
              <IconLock size={12} /> {project.lock.label}
            </span>
          )}
          <span className="chip">{SCOPE[project.scopeProfile]}</span>
        </span>
      </div>
      <ProgressBar rollup={r} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">
          {r.total
            ? `${r.green} of ${r.total} units complete${r.reviewed ? ` · ${r.reviewed} reviewed` : ''}`
            : 'No equipment yet'}
        </span>
        {r.total > 0 && <RollupCounts rollup={r} />}
      </div>
      {ex && <ExportStateLine status={ex} testId="project-export-state" />}
    </Link>
  );
}

export function ProjectListPage() {
  const projects = useProjects();
  const rollups = useAllProjectRollups();
  const exports = useAllExportStatus();
  return (
    <Screen title="a2b TAB">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>{projects ? `${projects.length} on this device` : 'Loading…'}</p>
        </div>
        <div className="row">
          <Link to="/import" className="btn">
            <IconUpload size={18} /> Import workbook
          </Link>
          <Link to="/new" className="btn btn-primary">
            <IconPlus size={18} /> New project
          </Link>
        </div>
      </div>
      <InstallPrompt />
      {projects && projects.length === 0 && (
        <div className="card empty">
          <IconFolder size={40} />
          <h2 style={{ marginTop: 8 }}>No projects yet</h2>
          <p>Create a project, or import an existing TAB workbook (.xlsm).</p>
        </div>
      )}
      <div className="stack">
        {projects?.map((p) => (
          <ProjectCard key={p.id} project={p} r={rollups?.get(p.id) ?? rollup([])} ex={exports?.get(p.id)} />
        ))}
      </div>
    </Screen>
  );
}
