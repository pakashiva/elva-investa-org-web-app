import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { EmptyState, ErrorBanner } from '../components/States';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { listClients, setClientStatus } from '../services/clientService';
import type { ClientRecord } from '../types/platform';
import { formatDate, formatInr } from '../utils/format';

export function ClientsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      setClients(await listClients());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load clients.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleStatus(client: ClientRecord) {
    const next = client.status === 'active' ? 'inactive' : 'active';
    setBusyId(client.id);
    setError(null);
    try {
      const updated = await setClientStatus(client.id, next);
      setClients((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update client.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <AppHeader
        title="Clients"
        subtitle="Onboard traders and open a read-only view of each tenant book."
        onOpenMenu={onOpenMenu}
        actions={
          <Link className="primary-btn" to="/clients/new">
            + Add Client
          </Link>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <section className="table-shell">
        {isLoading ? (
          <p className="state-box">Loading clients…</p>
        ) : clients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            message="Add a client with min/max investment and one admin login."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Code</th>
                  <th>Admin</th>
                  <th>Customers</th>
                  <th>AUM</th>
                  <th>Investment range</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link className="text-action" to={`/clients/${client.id}`}>
                        <strong>{client.name}</strong>
                      </Link>
                    </td>
                    <td>{client.clientCode}</td>
                    <td>
                      {client.adminFullName}
                      <div className="muted-line">{client.adminUsername}</div>
                    </td>
                    <td>{(client.customerCount ?? 0).toLocaleString('en-IN')}</td>
                    <td>{formatInr(client.totalInvested ?? 0)}</td>
                    <td>
                      {formatInr(client.minInvestmentAmount)} – {formatInr(client.maxInvestmentAmount)}
                    </td>
                    <td>
                      <span className={`status-pill ${client.status}`}>{client.status}</span>
                    </td>
                    <td>{formatDate(client.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <Link className="text-action" to={`/clients/${client.id}`}>
                          View
                        </Link>
                        <button
                          type="button"
                          className="text-action"
                          disabled={busyId === client.id}
                          onClick={() => void toggleStatus(client)}
                        >
                          {client.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
