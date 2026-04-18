'use client';

/**
 * src/components/admin/PaymentsTable.tsx
 *
 * Client component: interactive table for payments admin panel.
 * Features: receipt download, fulfillment logs modal, status badges.
 */

import { useState } from 'react';

type Payment = {
  id:                      string;
  provider:                string;
  provider_transaction_id: string;
  payer_email:             string;
  payer_name:              string | null;
  amount:                  number;
  currency:                string;
  product_name:            string;
  plan_id:                 string | null;
  status:                  string;
  created_at:              string;
  paid_at:                 string | null;
  fulfilled_at:            string | null;
  receipt_url:             string | null;
  access_granted:          boolean;
  email_sent:              boolean;
  invoices:                { invoice_number: string; pdf_url: string | null } | null;
};

type FulfillmentLog = {
  id:         string;
  action:     string;
  status:     string;
  details:    Record<string, unknown>;
  created_at: string;
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  completed: { bg: 'rgba(52,199,89,0.12)',  color: '#16a34a', label: '✓ Completado' },
  pending:   { bg: 'rgba(255,149,0,0.12)',  color: '#c2410c', label: '⏳ Pendiente' },
  denied:    { bg: 'rgba(255,59,48,0.12)',  color: '#dc2626', label: '✕ Denegado'  },
  refunded:  { bg: 'rgba(99,102,241,0.12)', color: '#4f46e5', label: '↩ Devuelto'  },
  disputed:  { bg: 'rgba(234,179,8,0.12)',  color: '#a16207', label: '⚠ Disputado' },
};

export function PaymentsTable({
  payments,
  page,
  totalPages,
  searchParams,
}: {
  payments:     Payment[];
  page:         number;
  totalPages:   number;
  searchParams: Record<string, string | undefined>;
}) {
  const [logsModal, setLogsModal] = useState<{ paymentId: string; email: string } | null>(null);
  const [logs,      setLogs]      = useState<FulfillmentLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const openLogs = async (paymentId: string, email: string) => {
    setLogsModal({ paymentId, email });
    setLogsLoading(true);
    try {
      const res  = await fetch(`/api/admin/fulfillment-logs?payment_id=${paymentId}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const paginationHref = (p: number) => {
    const params = new URLSearchParams(searchParams as Record<string, string>);
    params.set('page', String(p));
    return `/admin/payments?${params.toString()}`;
  };

  if (!payments.length) {
    return (
      <div style={{ background: 'white', borderRadius: 12, padding: '40px', textAlign: 'center', color: '#8e8e93' }}>
        <p style={{ fontSize: 15 }}>No se encontraron transacciones</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ background: 'white', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8f9fc', borderBottom: '2px solid #e5e7eb' }}>
                {['Fecha', 'Email', 'Plan', 'Importe', 'TX ID', 'Estado', 'Factura', 'Acceso', 'Acciones'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#8e8e93', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => {
                const st = STATUS_STYLES[p.status] ?? STATUS_STYLES.pending;
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#fafafa' }}>

                    {/* Date */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#555' }}>
                      <div style={{ fontSize: 12 }}>{formatDate(p.created_at)}</div>
                      {p.fulfilled_at && (
                        <div style={{ fontSize: 10, color: '#34c759', marginTop: 2 }}>
                          ✓ {formatDate(p.fulfilled_at)}
                        </div>
                      )}
                    </td>

                    {/* Email */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600, color: '#1c1d24' }}>{p.payer_email}</div>
                      {p.payer_name && <div style={{ fontSize: 11, color: '#8e8e93' }}>{p.payer_name}</div>}
                    </td>

                    {/* Plan */}
                    <td style={{ padding: '10px 14px', color: '#0055cc', fontWeight: 600 }}>
                      {p.plan_id ?? '—'}
                    </td>

                    {/* Amount */}
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: '#1c1d24', whiteSpace: 'nowrap' }}>
                      {formatAmount(p.amount, p.currency)}
                    </td>

                    {/* TX ID */}
                    <td style={{ padding: '10px 14px' }}>
                      <code style={{ fontSize: 11, background: '#f0f2f5', padding: '2px 6px', borderRadius: 4, color: '#555' }}>
                        {p.provider_transaction_id.slice(0, 12)}…
                      </code>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ background: st.bg, color: st.color, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {st.label}
                      </span>
                    </td>

                    {/* Invoice */}
                    <td style={{ padding: '10px 14px', fontSize: 11, color: '#8e8e93' }}>
                      {p.invoices?.invoice_number ?? '—'}
                    </td>

                    {/* Access */}
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <span style={{ fontSize: 16 }}>{p.access_granted ? '✅' : '⏳'}</span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {p.receipt_url && (
                          <a
                            href={p.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Descargar recibo PDF"
                            style={{ padding: '4px 10px', background: '#0055cc', color: 'white', borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
                          >
                            📄 PDF
                          </a>
                        )}
                        <button
                          onClick={() => openLogs(p.id, p.payer_email)}
                          style={{ padding: '4px 10px', background: '#f0f2f5', color: '#555', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          📋 Logs
                        </button>
                      </div>
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px' }}>
            {page > 1 && (
              <a href={paginationHref(page - 1)} style={paginBtn}>← Anterior</a>
            )}
            <span style={{ fontSize: 13, color: '#8e8e93' }}>Página {page} de {totalPages}</span>
            {page < totalPages && (
              <a href={paginationHref(page + 1)} style={paginBtn}>Siguiente →</a>
            )}
          </div>
        )}
      </div>

      {/* Fulfillment Logs Modal */}
      {logsModal && (
        <div
          onClick={() => setLogsModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 620, maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Logs de cumplimiento</p>
                <p style={{ margin: 0, fontSize: 12, color: '#8e8e93' }}>{logsModal.email}</p>
              </div>
              <button onClick={() => setLogsModal(null)} style={{ background: '#f0f2f5', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
                ✕ Cerrar
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: '16px 20px' }}>
              {logsLoading ? (
                <p style={{ color: '#8e8e93', textAlign: 'center' }}>Cargando…</p>
              ) : logs.length === 0 ? (
                <p style={{ color: '#8e8e93', textAlign: 'center' }}>Sin logs disponibles</p>
              ) : (
                logs.map(log => (
                  <div key={log.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14 }}>{log.status === 'ok' ? '✅' : log.status === 'error' ? '❌' : '⏭'}</span>
                      <code style={{ fontSize: 12, fontWeight: 700, color: '#1c1d24' }}>{log.action}</code>
                      <span style={{ fontSize: 11, color: '#8e8e93', marginLeft: 'auto' }}>{formatDate(log.created_at)}</span>
                    </div>
                    {Object.keys(log.details).length > 0 && (
                      <pre style={{ margin: 0, fontSize: 11, color: '#555', background: '#f8f9fc', padding: '8px 10px', borderRadius: 6, overflowX: 'auto' }}>
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────

const paginBtn: React.CSSProperties = {
  padding: '6px 14px',
  background: '#0055cc',
  color: 'white',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  textDecoration: 'none',
};

// ── Helpers ───────────────────────────────────────────────────

function formatDate(s: string): string {
  return new Date(s).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
}
