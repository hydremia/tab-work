import { Suspense, useEffect, useRef } from 'react';
import { useLocation, NavLink, Outlet, useOutletContext, useParams } from 'react-router';
import {
  useAttention,
  useConflicts,
  useEquipmentList,
  useIssues,
  useLibraryConflicts,
  useProject,
  useProjectLibraryIds,
  useProjectStatus,
  type ProjectStatus,
} from '../../data/hooks';
import type { Equipment, Issue, Project, SyncConflict } from '../../data/types';
import type { AttentionItem } from '../../domain/attention';
import { AppHeader, ModeBanner } from '../components/AppHeader';
import { ExportReminderGuard } from '../components/ExportReminder';
import { LockBanner } from '../components/LockBanner';
import { ProjectMenu } from '../components/DeleteProject';
import { openDeficiencies } from '../../domain/issues';
import { migrateProjectStatic } from '../../data/repo';

export interface ProjectContext {
  project: Project;
  equipment: Equipment[];
  issues: Issue[];
  status: ProjectStatus | undefined;
  attention: AttentionItem[] | undefined;
  /** Open sync conflicts (Attention tab, unit badges). */
  conflicts: SyncConflict[] | undefined;
  /** Open sync conflicts of the library instruments the project's calibration rows came from (Attention tab). */
  libraryConflicts: SyncConflict[] | undefined;
  /** The report was issued (project locked): pages are read-only. */
  locked: boolean;
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
  const attention = useAttention(projectId, status);
  const conflicts = useConflicts(projectId);
  const libraryConflicts = useLibraryConflicts(useProjectLibraryIds(projectId) ?? []);
  const tabsRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  // static profile readings entered before template revision 08: moved to their components once per opening
  const unlocked = Boolean(project && !project.lock);
  useEffect(() => {
    if (projectId && unlocked) void migrateProjectStatic(projectId);
  }, [projectId, unlocked]);
  // the tab bar scrolls sideways on a phone: keep the active tab in view
  useEffect(() => {
    const active = tabsRef.current?.querySelector('a.active') as HTMLElement | null;
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [pathname, project]);

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

  const open = openDeficiencies(issues).length;
  const tabs: { to: string; label: string; count?: number; tone?: string }[] = [
    { to: 'info', label: 'Info' },
    { to: 'equipment', label: 'Equipment', count: equipment.length },
    { to: 'issues', label: 'Issues', count: open || undefined },
    {
      to: 'attention',
      label: 'Attention',
      count: (attention?.length ?? 0) + (conflicts?.length ?? 0) + (libraryConflicts?.length ?? 0) || undefined,
      tone: 'attention',
    },
    { to: 'photos', label: 'Photos' },
    { to: 'export', label: 'Export' },
    { to: 'history', label: 'History' },
  ];
  return (
    <>
      <AppHeader
        title={project.name}
        subtitle={typeof project.info.address === 'string' ? project.info.address : undefined}
        back="/"
        actions={<ProjectMenu project={project} />}
      />
      <ModeBanner />
      <nav className="tabs" aria-label="Project sections">
        <div className="tabs-inner" ref={tabsRef}>
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {t.label}
              {t.count !== undefined && (
                <span className="tab-count" data-tone={t.tone} data-testid={`tab-count-${t.to}`}>
                  {t.count}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="page">
        <LockBanner project={project} />
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Outlet
            context={
              {
                project,
                equipment,
                issues,
                status,
                attention,
                conflicts,
                libraryConflicts,
                locked: Boolean(project.lock),
              } satisfies ProjectContext
            }
          />
        </Suspense>
      </main>
      <ExportReminderGuard project={project} />
    </>
  );
}
