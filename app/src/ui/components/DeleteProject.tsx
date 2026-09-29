/**
 * Deleting a whole project: from the project header's ⋯ menu and Info → Danger zone. Signed in (and the project is
 * not kept on this device only) it is ONE synced change that removes the project, its photos and its history on
 * every device and in the cloud, so the confirmation says so.
 */
import { useNavigate } from 'react-router';
import { deleteRecord } from '../../data/repo';
import type { Project } from '../../data/types';
import { localOnlyProjects } from '../../sync/outbox';
import { useSync } from '../../sync/SyncProvider';
import { IconTrash } from './Icons';

export function deleteProjectMessage(name: string, everywhere: boolean): string {
  return everywhere
    ? `Delete "${name}" for everyone?\n\nIt is removed from every device and from the cloud, with its photos and history. This cannot be undone: export the workbook first if you may need it.`
    : `Delete "${name}" and all its data from this device?\n\nThis cannot be undone: export the workbook first if you may need it.`;
}

export function useDeleteProject(project: Project) {
  const nav = useNavigate();
  const { user } = useSync();
  return async () => {
    const everywhere = Boolean(user) && !(await localOnlyProjects()).has(project.id);
    if (!window.confirm(deleteProjectMessage(project.name, everywhere))) return;
    await deleteRecord('projects', project.id);
    nav('/', { replace: true, state: { projectDeleted: true } });
  };
}

export function DeleteProjectButton({ project }: { project: Project }) {
  const del = useDeleteProject(project);
  return (
    <button className="btn btn-danger" type="button" data-testid="delete-project" onClick={() => void del()}>
      <IconTrash size={16} /> Delete project
    </button>
  );
}

/** The project header's ⋯ menu. */
export function ProjectMenu({ project }: { project: Project }) {
  const del = useDeleteProject(project);
  return (
    <details className="header-menu" data-testid="project-menu">
      <summary aria-label="Project actions">⋯</summary>
      <div className="header-menu-list" role="menu">
        <button
          type="button"
          role="menuitem"
          className="btn btn-ghost btn-danger-text"
          data-testid="menu-delete-project"
          onClick={(e) => {
            (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
            void del();
          }}
        >
          <IconTrash size={16} /> Delete project…
        </button>
      </div>
    </details>
  );
}
