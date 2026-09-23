import { useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import type { AdminOutletContext } from '../layouts/AdminLayout';

type Props = {
  title: string;
  subtitle: string;
};

export function PlaceholderPage({ title, subtitle }: Props) {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();

  return (
    <>
      <AppHeader title={title} subtitle={subtitle} onOpenMenu={onOpenMenu} />
      <section className="placeholder-page">
        <h2>{title}</h2>
        <p>This workspace is wired for navigation. The screen will be built from the next design.</p>
      </section>
    </>
  );
}
