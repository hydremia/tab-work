import { NavLink, Outlet, useOutletContext, useParams } from 'react-router';
import { useEquipmentList, useIssues, useProject, useProjectStatus, type ProjectStatus } from '../../data/hooks';
import type { Equipment, Issue, Project } from '../../data/types';
import { AppHeader, ModeBanner } from '../components/AppHeader';

export interface ProjectContext {
  project: Project;
  equipment: Equipment[];
  issues: Issue[];
  status: ProjectStatus | undefined;
}

export function useProjectContext(): ProjectContext {
  return useOutletContext<ProjectContext>();
}

export function ProjectLayout() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const equipment = useEquipmentList(projectId);
  const issues = useIssues(projectId);
  const status = useProjectStatus(projectId);

  if (project === null) {
    return (
      <>
        <AppHeader title="Project not found" back="/" />
        <main className="page">
          <p>This project is not on this device.</p>
        </main>
      </>
    );
  }
  if (!project || !equipment || !issues) return <AppHeader title="Loading…" back="/" />;

  const open = issues.filter((i) => i.status === 'Open').length;
  const tabs = [
    { to: 'info', label: 'Info' },
    { to: 'equipment', label: 'Equipment', count: equipment.length },
    { to: 'issues', label: 'Issues', count: open || undefined },
    { to: 'photos', label: 'Photos' },
    { to: 'export', label: 'Export' },
  ];
  return (
    <>
      <AppHeader
        title={project.name}
        subtitle={typeof project.info.address === 'string' ? project.info.address : undefined}
        back="/"
      />
      <ModeBanner />
      <nav className="tabs" aria-label="Project sections">
        <div className="tabs-inner">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {t.label}
              {t.count !== undefined && <span className="tab-count">{t.count}</span>}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="page">
        <Outlet context={{ project, equipment, issues, status } satisfies ProjectContext} />
      </main>
    </>
  );
}
