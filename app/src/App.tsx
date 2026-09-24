import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider } from 'react-router';
import { SyncProvider } from './sync/SyncProvider';
import { ProjectLayout } from './ui/pages/ProjectLayout';
import { ProjectListPage } from './ui/pages/ProjectListPage';
import { Screen } from './ui/components/Screen';
import { UpdateToast } from './ui/components/PwaPrompts';

/**
 * Route-level code splitting: the project list and the project frame load with the app; every page is its own
 * chunk, fetched on first use (and precached by the service worker, so it works offline).
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ReactNode {
  const C: ComponentType = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
  return <C />;
}
const AddEquipmentPage = page(() => import('./ui/pages/AddEquipmentPage'), 'AddEquipmentPage');
const AttentionPage = page(() => import('./ui/pages/AttentionPage'), 'AttentionPage');
const EquipmentListPage = page(() => import('./ui/pages/EquipmentListPage'), 'EquipmentListPage');
const EquipmentPage = page(() => import('./ui/pages/EquipmentPage'), 'EquipmentPage');
const ExportPage = page(() => import('./ui/pages/ExportPage'), 'ExportPage');
const HistoryPage = page(() => import('./ui/pages/HistoryPage'), 'HistoryPage');
const ImportPage = page(() => import('./ui/pages/ImportPage'), 'ImportPage');
const IssuesPage = page(() => import('./ui/pages/IssuesPage'), 'IssuesPage');
const NewProjectPage = page(() => import('./ui/pages/NewProjectPage'), 'NewProjectPage');
const PhotosPage = page(() => import('./ui/pages/PhotosPage'), 'PhotosPage');
const ProjectInfoPage = page(() => import('./ui/pages/ProjectInfoPage'), 'ProjectInfoPage');
const ScheduleImportPage = page(() => import('./ui/pages/ScheduleImportPage'), 'ScheduleImportPage');

function Root() {
  return (
    <div className="app">
      <Suspense fallback={<p className="page muted">Loading…</p>}>
        <Outlet />
      </Suspense>
      <UpdateToast />
    </div>
  );
}

function NotFound() {
  return (
    <Screen title="Not found" back="/">
      <p>
        Nothing here. <Link to="/">Back to projects</Link>
      </p>
    </Screen>
  );
}

export const routes = [
  {
    path: '/',
    element: <Root />,
    children: [
      { index: true, element: <ProjectListPage /> },
      { path: 'new', element: NewProjectPage },
      { path: 'import', element: ImportPage },
      {
        path: 'p/:projectId',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Navigate to="equipment" replace /> },
          { path: 'info', element: ProjectInfoPage },
          { path: 'equipment', element: EquipmentListPage },
          { path: 'issues', element: IssuesPage },
          { path: 'attention', element: AttentionPage },
          { path: 'photos', element: PhotosPage },
          { path: 'export', element: ExportPage },
          { path: 'history', element: HistoryPage },
        ],
      },
      { path: 'p/:projectId/add', element: AddEquipmentPage },
      { path: 'p/:projectId/schedule', element: ScheduleImportPage },
      { path: 'p/:projectId/e/:equipmentId', element: EquipmentPage },
      { path: '*', element: <NotFound /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>
  );
}
