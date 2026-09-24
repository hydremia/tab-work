import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider } from 'react-router';
import { SyncProvider } from './sync/SyncProvider';
import { AddEquipmentPage } from './ui/pages/AddEquipmentPage';
import { EquipmentListPage } from './ui/pages/EquipmentListPage';
import { EquipmentPage } from './ui/pages/EquipmentPage';
import { ExportPage } from './ui/pages/ExportPage';
import { ImportPage } from './ui/pages/ImportPage';
import { IssuesPage } from './ui/pages/IssuesPage';
import { NewProjectPage } from './ui/pages/NewProjectPage';
import { PhotosPage } from './ui/pages/PhotosPage';
import { ProjectInfoPage } from './ui/pages/ProjectInfoPage';
import { ProjectLayout } from './ui/pages/ProjectLayout';
import { ProjectListPage } from './ui/pages/ProjectListPage';
import { Screen } from './ui/components/Screen';

function Root() {
  return (
    <div className="app">
      <Outlet />
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
      { path: 'new', element: <NewProjectPage /> },
      { path: 'import', element: <ImportPage /> },
      {
        path: 'p/:projectId',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Navigate to="equipment" replace /> },
          { path: 'info', element: <ProjectInfoPage /> },
          { path: 'equipment', element: <EquipmentListPage /> },
          { path: 'issues', element: <IssuesPage /> },
          { path: 'photos', element: <PhotosPage /> },
          { path: 'export', element: <ExportPage /> },
        ],
      },
      { path: 'p/:projectId/add', element: <AddEquipmentPage /> },
      { path: 'p/:projectId/e/:equipmentId', element: <EquipmentPage /> },
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
