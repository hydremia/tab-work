import type { ReactNode } from 'react';
import { AppHeader, ModeBanner } from './AppHeader';

export function Screen({
  title,
  subtitle,
  back,
  actions,
  nav,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  actions?: ReactNode;
  nav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <AppHeader title={title} subtitle={subtitle} back={back} actions={actions} />
      <ModeBanner />
      {nav}
      <main className="page">{children}</main>
    </>
  );
}
