/**
 * src/app/admin/payments/page.tsx
 *
 * Admin panel — payments list with filters, search, receipt download, log viewer.
 * Protected: only accessible with is_admin = true in JWT user_metadata.
 *
 * Uses Next.js Server Components + Client Components for interactivity.
 */

import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies }                       from 'next/headers';
import { redirect }                      from 'next/navigation';
import { PaymentsTable }                 from '@/components/admin/PaymentsTable';

export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: {
    status?:  string;
    email?:   string;
    tx?:      string;
    from?:    string;
    to?:      string;
    page?:    string;
  };
}) {
  // ── Auth guard ────────────────────────────────────────────
  const supabase = createServerComponentClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  const isAdmin = session.user?.user_metadata?.is_admin === true;
  if (!isAdmin) redirect('/');

  // ── Build query ───────────────────────────────────────────
  const PAGE_SIZE = 25;
  const page      = Math.max(1, parseInt(searchParams.page ?? '1', 10));
  const from      = (page - 1) * PAGE_SIZE;
  const to        = from + PAGE_SIZE - 1;

  // Use service role for admin reads
  const { supabaseAdmin } = await import('@/lib/supabase/admin');

  let query = supabaseAdmin
    .from('payments')
    .select(`
      id, provider, provider_transaction_id, payer_email, payer_name,
      amount, currency, product_name, plan_id, status,
      created_at, paid_at, fulfilled_at, refunded_at,
      receipt_url, access_granted, email_sent,
      invoices ( invoice_number, pdf_url )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (searchParams.status)      query = query.eq('status', searchParams.status);
  if (searchParams.email)       query = query.ilike('payer_email', `%${searchParams.email}%`);
  if (searchParams.tx)          query = query.ilike('provider_transaction_id', `%${searchParams.tx}%`);
  if (searchParams.from)        query = query.gte('created_at', searchParams.from);
  if (searchParams.to)          query = query.lte('created_at', searchParams.to + 'T23:59:59Z');

  const { data: payments, count, error } = await query;

  if (error) {
    console.error('[admin/payments] Query error:', error.message);
  }

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  return (
    <div style={{ fontFamily: '-apple-system, Helvetica, sans-serif', background: '#f0f2f5', minHeight: '100vh', padding: '24px 20px' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1c1d24' }}>
          💳 Pagos — COT Tracker Admin
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8e8e93' }}>
          {count ?? 0} transacciones totales
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Completados" value={payments?.filter(p => p.status === 'completed').length ?? 0} color="#34c759" />
        <StatCard label="Pendientes"  value={payments?.filter(p => p.status === 'pending').length ?? 0}   color="#ff9500" />
        <StatCard label="Devueltos"   value={payments?.filter(p => p.status === 'refunded').length ?? 0}  color="#ff3b30" />
        <StatCard label="Esta página" value={payments?.length ?? 0}                                       color="#0055cc" />
      </div>

      {/* Filters */}
      <form method="GET" style={{ background: 'white', borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FilterInput name="email"  label="Email"          placeholder="usuario@gmail.com" defaultValue={searchParams.email} />
        <FilterInput name="tx"     label="Transaction ID" placeholder="3TU74..."          defaultValue={searchParams.tx} />
        <FilterInput name="from"   label="Desde"          type="date"                     defaultValue={searchParams.from} />
        <FilterInput name="to"     label="Hasta"          type="date"                     defaultValue={searchParams.to} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#8e8e93', fontWeight: 600 }}>Estado</label>
          <select name="status" defaultValue={searchParams.status ?? ''} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}>
            <option value="">Todos</option>
            <option value="completed">Completado</option>
            <option value="pending">Pendiente</option>
            <option value="denied">Denegado</option>
            <option value="refunded">Devuelto</option>
            <option value="disputed">Disputado</option>
          </select>
        </div>
        <button type="submit" style={{ padding: '8px 18px', background: '#0055cc', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Filtrar
        </button>
        <a href="/admin/payments" style={{ padding: '8px 14px', color: '#8e8e93', fontSize: 13, textDecoration: 'none' }}>
          Limpiar
        </a>
      </form>

      {/* Table */}
      <PaymentsTable
        payments={payments ?? []}
        page={page}
        totalPages={totalPages}
        searchParams={searchParams}
      />

    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'white', borderRadius: 10, padding: '14px 16px', borderLeft: `4px solid ${color}` }}>
      <p style={{ margin: 0, fontSize: 11, color: '#8e8e93', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color }}>{value}</p>
    </div>
  );
}

function FilterInput({ name, label, placeholder, type = 'text', defaultValue }: {
  name: string; label: string; placeholder?: string; type?: string; defaultValue?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#8e8e93', fontWeight: 600 }}>{label}</label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, minWidth: 160 }}
      />
    </div>
  );
}
