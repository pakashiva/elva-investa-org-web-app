import { useOutletContext } from 'react-router-dom';
import { ExternalLink, Globe, Linkedin, Mail, Phone } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import type { AdminOutletContext } from '../layouts/AdminLayout';

const DEV_LINKS = [
  {
    label: 'Company Website',
    href: 'https://www.elvatech.in/',
    description: 'Official company site',
    icon: Globe,
  },
  {
    label: 'Support Email',
    href: 'mailto:support@example.com',
    description: 'support@example.com',
    icon: Mail,
  },
  {
    label: 'Support Phone',
    href: 'tel:+919876543210',
    description: '+91 98765 43210',
    icon: Phone,
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/105881641/admin/dashboard/',
    description: 'Company LinkedIn page',
    icon: Linkedin,
  },
  // {
  //   label: 'Developer Portal',
  //   href: 'https://dev.example.com',
  //   description: 'Internal docs and release notes (placeholder)',
  //   icon: ExternalLink,
  // },
] as const;

export function ContactOpsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();

  return (
    <>
      <AppHeader
        title="Contact Ops Dev"
        subtitle="Reach the company developing and supporting this admin portal."
        onOpenMenu={onOpenMenu}
      />

      <article className="card settings-card contact-ops-card">
        <h2>Development Company</h2>
        <p className="contact-ops-intro">
          Use the links below for escalations, portal issues, and product support. Placeholder URLs
          for now — replace with the final contacts when ready.
        </p>

        <ul className="contact-ops-list">
          {DEV_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.label}>
                <a
                  className="contact-ops-link"
                  href={item.href}
                  target={item.href.startsWith('http') ? '_blank' : undefined}
                  rel={item.href.startsWith('http') ? 'noreferrer' : undefined}
                >
                  <span className="contact-ops-icon">
                    <Icon size={18} />
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <ExternalLink size={16} className="contact-ops-open" />
                </a>
              </li>
            );
          })}
        </ul>
      </article>
    </>
  );
}
