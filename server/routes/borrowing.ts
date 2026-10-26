import { Router } from 'express';
import { asyncHandler, requireAuth, requireClientAdmin } from '../middleware';
import { pool } from '../db';
import { ensureRegularInterestSchedules } from '../regularLoanSchedules';
import type { AuthedRequest } from '../types';

export const borrowingRouter = Router();
borrowingRouter.use(requireAuth, requireClientAdmin);

function clientId(req: Parameters<typeof requireClientAdmin>[0]) {
  return (req as AuthedRequest).auth.clientId!;
}
function value(input: unknown) { return String(input ?? '').trim(); }
function positive(input: unknown) { const n = Number(input); return Number.isFinite(n) && n > 0 ? n : NaN; }

async function requireBorrowing(client: ReturnType<typeof clientId>) {
  const result = await pool.query(`SELECT
    'borrow'=ANY(COALESCE(c.enabled_modules,ARRAY['invest']::text[])) AS module_enabled,
    (
      EXISTS(SELECT 1 FROM loan_products lp WHERE lp.client_id=c.id AND lp.status='active')
      OR EXISTS(SELECT 1 FROM borrowers b WHERE b.client_id=c.id)
      OR EXISTS(SELECT 1 FROM loans l WHERE l.client_id=c.id)
    ) AS configured
    FROM clients c WHERE c.id=$1`, [client]);
  return Boolean(result.rows[0]?.module_enabled || result.rows[0]?.configured);
}

borrowingRouter.use(asyncHandler(async (req, res, next) => {
  if (!(await requireBorrowing(clientId(req)))) {
    res.status(403).json({ error: 'Borrowing is not enabled for this client.' });
    return;
  }
  next();
}));

borrowingRouter.get('/overview', asyncHandler(async (req, res) => {
  const tenant = clientId(req);
  const clientToday=await pool.query(`SELECT public.admin_ist_today()::text AS today`);
  const undatedApproved=await pool.query(`SELECT l.id,l.borrower_id,l.request_type,l.principal_amount,l.interest_rate_percent,l.custom_duration_days,l.terms_snapshot,
      COALESCE(l.start_date,(l.updated_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS approval_date
    FROM loans l WHERE l.client_id=$1 AND l.status='approved' AND l.request_type IN ('daily','regular','custom')
      AND NOT EXISTS(SELECT 1 FROM loan_schedules s WHERE s.client_id=l.client_id AND s.loan_id=l.id)`,[tenant]);
  for(const loan of undatedApproved.rows){
    const start=String(loan.approval_date||clientToday.rows[0]?.today),startDate=new Date(`${start}T00:00:00Z`);
    if(Number.isNaN(startDate.getTime()))continue;
    if(loan.request_type==='daily'){
      const days=Number(loan.terms_snapshot?.collection_days??loan.custom_duration_days),face=Number(loan.principal_amount);
      if(!Number.isInteger(days)||days<1||days>3650)continue;
      for(let day=1;day<=days;day++){
        const due=new Date(startDate);due.setUTCDate(due.getUTCDate()+day);const dueDate=due.toISOString().slice(0,10);
        const amount=Number((day===days?face-Number((face/days).toFixed(2))*(days-1):face/days).toFixed(2));
        const saved=await pool.query(`INSERT INTO loan_schedules(client_id,loan_id,installment_number,due_date,principal_due) VALUES($1,$2,$3,$4,$5) ON CONFLICT(loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,loan.id,day,dueDate,amount]);
        if(saved.rowCount)await pool.query(`INSERT INTO collection_tasks(client_id,borrower_id,loan_id,schedule_id,due_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[tenant,loan.borrower_id,loan.id,saved.rows[0].id,dueDate]);
      }
      const maturity=new Date(startDate);maturity.setUTCDate(maturity.getUTCDate()+days);
      await pool.query(`UPDATE loans SET start_date=COALESCE(start_date,$3),maturity_date=COALESCE(maturity_date,$4) WHERE id=$1 AND client_id=$2`,[tenant,loan.id,start,maturity.toISOString().slice(0,10)]);
    }else if(loan.request_type==='regular'){
      const due=new Date(startDate),day=due.getUTCDate();due.setUTCDate(1);due.setUTCMonth(due.getUTCMonth()+1);due.setUTCDate(Math.min(day,new Date(Date.UTC(due.getUTCFullYear(),due.getUTCMonth()+1,0)).getUTCDate()));
      const dueDate=due.toISOString().slice(0,10),interest=Number((Number(loan.principal_amount)*Number(loan.interest_rate_percent)/100).toFixed(2));
      const saved=await pool.query(`INSERT INTO loan_schedules(client_id,loan_id,installment_number,due_date,principal_due,interest_due) VALUES($1,$2,1,$3,0,$4) ON CONFLICT(loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,loan.id,dueDate,interest]);
      if(saved.rowCount)await pool.query(`INSERT INTO collection_tasks(client_id,borrower_id,loan_id,schedule_id,due_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[tenant,loan.borrower_id,loan.id,saved.rows[0].id,dueDate]);
      await pool.query(`UPDATE loans SET start_date=COALESCE(start_date,$3) WHERE id=$1 AND client_id=$2`,[tenant,loan.id,start]);
    }else{
      const days=Number(loan.custom_duration_days),rate=Number(loan.interest_rate_percent);
      if(!Number.isInteger(days)||days<1||days>3650||!Number.isFinite(rate))continue;
      const due=new Date(startDate);due.setUTCDate(due.getUTCDate()+days);const dueDate=due.toISOString().slice(0,10),interest=Number((Number(loan.principal_amount)*rate/100).toFixed(2));
      const saved=await pool.query(`INSERT INTO loan_schedules(client_id,loan_id,installment_number,due_date,principal_due,interest_due) VALUES($1,$2,1,$3,$4,$5) ON CONFLICT(loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,loan.id,dueDate,loan.principal_amount,interest]);
      if(saved.rowCount)await pool.query(`INSERT INTO collection_tasks(client_id,borrower_id,loan_id,schedule_id,due_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[tenant,loan.borrower_id,loan.id,saved.rows[0].id,dueDate]);
      await pool.query(`UPDATE loans SET start_date=COALESCE(start_date,$3),maturity_date=COALESCE(maturity_date,$4) WHERE id=$1 AND client_id=$2`,[tenant,loan.id,start,dueDate]);
    }
  }
  const regularScheduleHorizon=await pool.query(`SELECT (public.admin_ist_today()+INTERVAL '1 month')::date::text AS through_date`);
  await ensureRegularInterestSchedules(tenant,String(regularScheduleHorizon.rows[0]?.through_date));
  await pool.query(`UPDATE loan_schedules s SET status='overdue',
      overdue_charge=CASE COALESCE(l.terms_snapshot->>'overdue_rule',lp.overdue_rule)
        WHEN 'fixed_charge' THEN COALESCE(NULLIF(l.terms_snapshot->>'overdue_charge','')::numeric,lp.overdue_charge)
        WHEN 'percentage_charge' THEN ROUND(GREATEST(s.principal_due-s.amount_paid,0)*COALESCE(NULLIF(l.terms_snapshot->>'overdue_charge','')::numeric,lp.overdue_charge)/100,2)
        ELSE 0 END, updated_at=NOW()
    FROM loans l JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id
    WHERE s.loan_id=l.id AND s.client_id=l.client_id AND l.client_id=$1
      AND s.status IN ('scheduled','partial')
      AND s.due_date + COALESCE(NULLIF(l.terms_snapshot->>'grace_period_days','')::int,lp.grace_period_days) < public.admin_ist_today()`, [tenant]);
  await pool.query(`UPDATE loans l SET status='overdue',updated_at=NOW()
    WHERE l.client_id=$1 AND l.status='active'
      AND EXISTS (SELECT 1 FROM loan_schedules s WHERE s.client_id=l.client_id AND s.loan_id=l.id AND s.status='overdue')`, [tenant]);
  const [stats, borrowers, loans, products, collections, eligibleCustomers] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM borrowers b WHERE b.client_id=$1 AND b.status='active') AS borrowers,
      (SELECT COUNT(*)::int FROM loans l WHERE l.client_id=$1 AND l.status IN ('pending_approval','approved')) AS pending,
      (SELECT COUNT(*)::int FROM loans l WHERE l.client_id=$1 AND l.status IN ('active','overdue')) AS active,
      (SELECT COALESCE(SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)),0)
        FROM loans l JOIN loan_schedules s ON s.loan_id=l.id AND s.client_id=l.client_id
        WHERE l.client_id=$1 AND l.status IN ('active','overdue') AND s.due_date=public.admin_ist_today() AND s.status NOT IN ('paid','waived')) AS due_today,
      (SELECT COALESCE(SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)),0)
        FROM loans l JOIN loan_schedules s ON s.loan_id=l.id AND s.client_id=l.client_id
        WHERE l.client_id=$1 AND l.status IN ('active','overdue') AND s.due_date<=public.admin_ist_today() AND s.status NOT IN ('paid','waived')) AS pending_collections,
      (SELECT COALESCE(SUM(p.amount_received),0) FROM loan_payments p WHERE p.client_id=$1 AND p.received_on=public.admin_ist_today() AND p.status='posted') AS collected_today,
      (SELECT COALESCE(SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)),0)
        FROM loans l JOIN loan_schedules s ON s.loan_id=l.id AND s.client_id=l.client_id
        WHERE l.client_id=$1 AND l.status IN ('active','overdue') AND s.due_date+(
          SELECT lp.grace_period_days FROM loan_products lp WHERE lp.id=l.product_id AND lp.client_id=l.client_id
        )<public.admin_ist_today() AND s.status NOT IN ('paid','waived')) AS overdue_total,
      (SELECT COALESCE(SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)),0)
        FROM loans l JOIN loan_schedules s ON s.loan_id=l.id AND s.client_id=l.client_id
        WHERE l.client_id=$1 AND l.status IN ('active','overdue') AND s.status NOT IN ('paid','waived')) +
      (SELECT COALESCE(SUM(GREATEST(bal.principal,0)),0) FROM loans rl CROSS JOIN LATERAL (SELECT COALESCE(SUM(principal_debit-principal_credit),0) principal FROM loan_ledger WHERE loan_id=rl.id AND client_id=rl.client_id) bal WHERE rl.client_id=$1 AND rl.request_type='regular' AND rl.status IN ('active','overdue')) AS outstanding`, [tenant]),
    pool.query(`SELECT b.id, c.full_name AS name, c.customer_code AS code, c.mobile_number AS mobile,
      b.status, b.created_at, COUNT(l.id)::int AS loan_count
      FROM borrowers b JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id
      LEFT JOIN loans l ON l.borrower_id=b.id AND l.client_id=b.client_id
      WHERE b.client_id=$1 GROUP BY b.id,c.id ORDER BY b.created_at DESC LIMIT 250`, [tenant]),
    pool.query(`SELECT l.id,l.loan_number,l.status,l.principal_amount,l.interest_rate_percent,l.start_date,l.maturity_date,l.created_at,l.request_type,l.custom_duration_days,l.repayment_preference,l.counter_offer,l.rollover_from_loan_id,l.terms_snapshot,
      (SELECT COALESCE(SUM(GREATEST(ps.principal_due+ps.interest_due+ps.overdue_charge-ps.amount_paid,0)),0) FROM loan_schedules ps WHERE ps.client_id=l.client_id AND ps.loan_id=l.rollover_from_loan_id AND ps.status NOT IN ('paid','waived')) AS rollover_balance,
      l.terms_snapshot->>'borrower_notes' AS borrower_notes,l.terms_snapshot->>'purpose' AS borrower_purpose,
      NULLIF(l.terms_snapshot->>'requested_interest_rate_percent','')::numeric AS requested_interest_rate_percent,
      c.full_name AS borrower_name,c.customer_code AS borrower_code,lp.name AS product_name,lp.write_off_allowed,lp.closure_mode,
      CASE WHEN l.request_type='regular' THEN COALESCE((SELECT SUM(principal_debit-principal_credit) FROM loan_ledger ll WHERE ll.loan_id=l.id AND ll.client_id=l.client_id),0)+COALESCE((SELECT SUM(GREATEST(s.interest_due+s.overdue_charge-s.amount_paid,0)) FROM loan_schedules s WHERE s.loan_id=l.id AND s.client_id=l.client_id AND s.status <> 'waived'),0) ELSE COALESCE((SELECT SUM(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid) FROM loan_schedules s WHERE s.loan_id=l.id AND s.client_id=l.client_id AND s.status <> 'waived'),0) END AS balance
      FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id
      JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id
      JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id
      WHERE l.client_id=$1 ORDER BY l.created_at DESC LIMIT 250`, [tenant]),
    pool.query(`SELECT id,name,interest_model,interest_rate_percent,interest_rate_period,interest_frequency,repayment_model,repayment_frequency,approval_workflow,
      payment_allocation,grace_period_days,overdue_rule,overdue_charge,part_payments_allowed,advance_payment_treatment,receipt_required,write_off_allowed,closure_mode,rounding_scale,required_documents
      FROM loan_products WHERE client_id=$1 AND status='active' ORDER BY created_at`, [tenant]),
    pool.query(`SELECT t.id,t.due_date,s.status,l.loan_number,
      CASE WHEN l.request_type='daily' THEN 'Daily collection loan' WHEN l.request_type='regular' THEN 'Regular loan · monthly interest' WHEN l.request_type='custom' THEN 'Custom loan' ELSE lp.name END AS loan_type,
      c.full_name AS borrower_name,c.customer_code AS borrower_code,
      GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0) AS due_amount
      FROM collection_tasks t JOIN loans l ON l.id=t.loan_id AND l.client_id=t.client_id
      JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id
      JOIN borrowers b ON b.id=t.borrower_id AND b.client_id=t.client_id
      JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id
      LEFT JOIN loan_schedules s ON s.id=t.schedule_id AND s.client_id=t.client_id
      WHERE t.client_id=$1 AND t.due_date<=public.admin_ist_today() AND t.status='pending' AND l.status IN ('approved','active','overdue') AND s.status NOT IN ('paid','waived') ORDER BY t.due_date,c.full_name`, [tenant]),
    pool.query(`SELECT c.id,c.full_name,c.customer_code,c.mobile_number FROM customers c
      WHERE c.client_id=$1 AND c.status='active'
        AND NOT EXISTS (SELECT 1 FROM borrowers b WHERE b.client_id=c.client_id AND b.customer_id=c.id)
      ORDER BY c.full_name LIMIT 250`, [tenant]),
  ]);
  res.json({ stats: stats.rows[0], borrowers: borrowers.rows, loans: loans.rows, products: products.rows, collections: collections.rows, eligibleCustomers: eligibleCustomers.rows });
}));

borrowingRouter.get('/reports/collections.csv', asyncHandler(async (req,res)=>{
  const tenant=clientId(req);
  const result=await pool.query(`SELECT s.due_date,l.loan_number,c.full_name,c.customer_code,s.status,
    s.principal_due,s.interest_due,s.overdue_charge,s.amount_paid,
    GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0) AS balance
    FROM loan_schedules s JOIN loans l ON l.id=s.loan_id AND l.client_id=s.client_id
    JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id
    JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id
    WHERE s.client_id=$1 AND l.status IN ('active','overdue') AND s.status NOT IN ('paid','waived')
    ORDER BY s.due_date,c.full_name`,[tenant]);
  const q=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[['Due date','Loan','Borrower','Customer code','Status','Principal due','Interest due','Overdue charge','Paid','Outstanding'].map(q).join(','),...result.rows.map(r=>[r.due_date,r.loan_number,r.full_name,r.customer_code,r.status,r.principal_due,r.interest_due,r.overdue_charge,r.amount_paid,r.balance].map(q).join(','))];
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="borrowing-collections.csv"');res.send(rows.join('\r\n'));
}));

borrowingRouter.get('/loans/:loanId', asyncHandler(async (req, res) => {
  const tenant=clientId(req), id=value(req.params.loanId);
  const [loan,schedule,ledger,payments]=await Promise.all([
    pool.query(`SELECT l.id,l.loan_number,l.status,l.request_type,l.principal_amount,l.interest_rate_percent,l.terms_snapshot,l.start_date,l.maturity_date,l.disbursed_at,l.closed_at,l.close_reason,
      c.full_name borrower_name,c.customer_code borrower_code,c.mobile_number,k.aadhaar_number,k.pan_number,lp.name product_name,lp.receipt_required,lp.required_documents,
      CASE WHEN l.request_type='regular' THEN COALESCE((SELECT SUM(principal_debit-principal_credit) FROM loan_ledger ll WHERE ll.loan_id=l.id AND ll.client_id=l.client_id),0)+COALESCE((SELECT SUM(GREATEST(s.interest_due+s.overdue_charge-s.amount_paid,0)) FROM loan_schedules s WHERE s.loan_id=l.id AND s.client_id=l.client_id AND s.status NOT IN ('waived')),0) ELSE COALESCE((SELECT SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)) FROM loan_schedules s WHERE s.loan_id=l.id AND s.client_id=l.client_id AND s.status NOT IN ('waived')),0) END balance
      FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id
      JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id LEFT JOIN kyc_documents k ON k.customer_id=c.id AND k.client_id=c.client_id WHERE l.id=$1 AND l.client_id=$2`,[id,tenant]),
    pool.query(`SELECT id,installment_number,due_date,principal_due,interest_due,overdue_charge,amount_paid,status FROM loan_schedules WHERE loan_id=$1 AND client_id=$2 ORDER BY installment_number`,[id,tenant]),
    pool.query(`SELECT id,event_type,principal_debit,principal_credit,interest_debit,interest_credit,overdue_debit,overdue_credit,event_date,description,reference_type,reference_id,created_at FROM loan_ledger WHERE loan_id=$1 AND client_id=$2 ORDER BY event_date DESC,created_at DESC`,[id,tenant]),
    pool.query(`SELECT id,received_on,amount_received,principal_component,interest_component,overdue_component,unapplied_amount,reference_number,created_at FROM loan_payments WHERE loan_id=$1 AND client_id=$2 AND status='posted' ORDER BY received_on DESC,created_at DESC`,[id,tenant]),
  ]);
  if(!loan.rowCount){res.status(404).json({error:'Loan not found.'});return;}
  res.json({loan:loan.rows[0],schedule:schedule.rows,ledger:ledger.rows,payments:payments.rows});
}));

borrowingRouter.get('/reports/loans.csv', asyncHandler(async(req,res)=>{
  const tenant=clientId(req);
  const result=await pool.query(`SELECT l.loan_number,c.full_name,c.customer_code,lp.name product_name,l.status,l.principal_amount,
    CASE WHEN l.request_type='regular' THEN COALESCE((SELECT SUM(principal_debit-principal_credit) FROM loan_ledger ll WHERE ll.loan_id=l.id AND ll.client_id=l.client_id),0)+COALESCE(SUM(GREATEST(s.interest_due+s.overdue_charge-s.amount_paid,0)) FILTER(WHERE s.status NOT IN ('waived')),0) ELSE COALESCE(SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)) FILTER(WHERE s.status NOT IN ('waived')),0) END balance,
    l.start_date,l.maturity_date FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id
    JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id
    LEFT JOIN loan_schedules s ON s.loan_id=l.id AND s.client_id=l.client_id WHERE l.client_id=$1
    GROUP BY l.id,c.id,lp.id ORDER BY l.created_at DESC`,[tenant]);
  const q=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
  const lines=[['Loan','Borrower','Customer code','Product','Status','Principal','Outstanding','Start date','Maturity date'].map(q).join(','),...result.rows.map(r=>[r.loan_number,r.full_name,r.customer_code,r.product_name,r.status,r.principal_amount,r.balance,r.start_date,r.maturity_date].map(q).join(','))];
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="borrowing-loans.csv"');res.send(lines.join('\r\n'));
}));

borrowingRouter.post('/borrowers/:customerId', asyncHandler(async (req, res) => {
  const tenant = clientId(req), customerId = value(req.params.customerId);
  const customer = await pool.query(`SELECT id FROM customers WHERE id=$1 AND client_id=$2`, [customerId, tenant]);
  if (!customer.rowCount) { res.status(404).json({ error: 'Customer not found in this client.' }); return; }
  const result = await pool.query(`INSERT INTO borrowers (client_id,customer_id,created_by)
    VALUES ($1,$2,$3) ON CONFLICT (client_id,customer_id) DO UPDATE SET status='active',updated_at=NOW() RETURNING id`,
  [tenant, customerId, (req as AuthedRequest).auth.id]);
  await pool.query(`UPDATE customers SET customer_type=CASE WHEN customer_type='investor' THEN 'both' ELSE 'borrower' END WHERE id=$1 AND client_id=$2`, [customerId,tenant]);
  res.status(201).json({ borrowerId: result.rows[0].id });
}));

borrowingRouter.post('/loans', asyncHandler(async (req, res) => {
  const tenant = clientId(req), borrowerId = value(req.body?.borrowerId), productId = value(req.body?.productId);
  const principal = positive(req.body?.principalAmount), term = Number(req.body?.installments), startDate = value(req.body?.startDate);
  if (!Number.isInteger(term) || term < 1 || term > 600 || !Number.isFinite(principal) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    res.status(400).json({ error: 'Enter a valid borrower, principal, start date, and installment count.' }); return;
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const [b, p] = await Promise.all([
      db.query(`SELECT id FROM borrowers WHERE id=$1 AND client_id=$2 AND status='active' FOR UPDATE`, [borrowerId,tenant]),
      db.query(`SELECT * FROM loan_products WHERE id=$1 AND client_id=$2 AND status='active' FOR UPDATE`, [productId,tenant]),
    ]);
    const product = p.rows[0];
    if (!b.rowCount || !product) { await db.query('ROLLBACK'); res.status(404).json({ error: 'Choose an active borrower and loan product from this client.' }); return; }
    const serial = await db.query(`SELECT nextval('loan_number_seq') AS n`);
    const loanNumber = `LN-${String(serial.rows[0].n).padStart(8,'0')}`;
    const approvedState = product.approval_workflow === 'direct_activation' ? 'approved' : 'pending_approval';
    const maturity = new Date(`${startDate}T00:00:00Z`);
    const months = product.repayment_frequency === 'weekly' ? Math.ceil(term/4) : product.repayment_frequency === 'quarterly' ? term*3 : product.repayment_frequency === 'at_maturity' ? term : term;
    maturity.setUTCMonth(maturity.getUTCMonth()+months);
    const loanResult = await db.query(`INSERT INTO loans (client_id,borrower_id,product_id,loan_number,status,principal_amount,interest_rate_percent,terms_snapshot,start_date,maturity_date,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING id`,
      [tenant,borrowerId,productId,loanNumber,approvedState,principal,product.interest_rate_percent,JSON.stringify({...product,installments:term}),startDate,maturity.toISOString().slice(0,10),(req as AuthedRequest).auth.id]);
    const loanId = loanResult.rows[0].id as string;
    const rate = Number(product.interest_rate_percent) / 100;
    const divisor = product.interest_rate_period === 'annual' ? 12 : product.interest_rate_period === 'monthly' ? 1 : product.interest_rate_period === 'weekly' ? 4.345 : 30.437;
    const periodRate = rate / divisor * (product.repayment_frequency === 'quarterly' ? 3 : product.repayment_frequency === 'weekly' ? 0.23 : 1);
    const payment = product.repayment_model === 'principal_and_interest' && periodRate > 0 && product.interest_model === 'reducing_balance'
      ? principal * periodRate / (1 - Math.pow(1 + periodRate, -term))
      : principal / term + (product.repayment_model === 'principal_and_interest' ? principal * periodRate : 0);
    let balance = principal;
    const scheduleCount = product.repayment_frequency === 'at_maturity' ? 1 : term;
    for (let i=1;i<=scheduleCount;i++) {
      const dueDate = new Date(`${startDate}T00:00:00Z`);
      if (product.repayment_frequency === 'at_maturity') dueDate.setUTCMonth(dueDate.getUTCMonth()+months);
      else if (product.repayment_frequency === 'weekly') dueDate.setUTCDate(dueDate.getUTCDate()+7*i);
      else dueDate.setUTCMonth(dueDate.getUTCMonth()+(product.repayment_frequency === 'quarterly' ? 3*i : i));
      let principalDue = 0, interestDue = 0;
      const interestBasis = product.interest_model === 'reducing_balance' ? balance : principal;
      if (product.repayment_model === 'bullet') { principalDue = i===scheduleCount ? balance : 0; interestDue = interestBasis*periodRate*(product.repayment_frequency==='at_maturity'?term:1); }
      else if (product.repayment_model === 'interest_only') { interestDue = interestBasis*periodRate*(product.repayment_frequency==='at_maturity'?term:1); principalDue = i===scheduleCount ? balance : 0; }
      else { interestDue = interestBasis*periodRate*(product.repayment_frequency==='at_maturity'?term:1); principalDue = Math.min(balance, payment-interestDue); if (i===scheduleCount) principalDue=balance; }
      balance = Math.max(0,balance-principalDue);
      const sch = await db.query(`INSERT INTO loan_schedules (client_id,loan_id,installment_number,due_date,principal_due,interest_due)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [tenant,loanId,i,dueDate.toISOString().slice(0,10),principalDue.toFixed(2),interestDue.toFixed(2)]);
      await db.query(`INSERT INTO collection_tasks (client_id,borrower_id,loan_id,schedule_id,due_date) VALUES ($1,$2,$3,$4,$5)`,[tenant,borrowerId,loanId,sch.rows[0].id,dueDate.toISOString().slice(0,10)]);
    }
    await db.query(`INSERT INTO loan_audit_logs (client_id,actor_id,entity_type,entity_id,action,changes) VALUES ($1,$2,'loan',$3,'created',$4::jsonb)`,[tenant,(req as AuthedRequest).auth.id,loanId,JSON.stringify({status:approvedState,principalAmount:principal,productId})]);
    await db.query('COMMIT');
    res.status(201).json({ loanId, loanNumber, status: approvedState });
  } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}));

borrowingRouter.patch('/loans/:loanId/decision', asyncHandler(async (req,res) => {
  const tenant=clientId(req), id=value(req.params.loanId), decision=value(req.body?.decision);
  if (decision !== 'approve' && decision !== 'reject') { res.status(400).json({error:'Decision must be approve or reject.'});return; }
  const db=await pool.connect(); let owner, decisionResult;
  try { await db.query('BEGIN');
  const current=await db.query(`SELECT l.*,b.customer_id,lp.* FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id WHERE l.id=$1 AND l.client_id=$2 AND l.status='pending_approval' AND l.request_type IN ('standard','regular','daily') FOR UPDATE OF l`,[id,tenant]);
  if (!current.rowCount) { await db.query('ROLLBACK');res.status(409).json({error:'This loan is not awaiting approval.'});return; }
  const loan=current.rows[0], terms={...loan.terms_snapshot};
  const approvalDayResult=await db.query(`SELECT public.admin_ist_today()::text AS today`),approvalDate=String(approvalDayResult.rows[0]?.today);
  if(decision==='approve') {
    if(loan.request_type==='daily') {
      const rate=Number(req.body?.terms?.interest_rate_percent??terms.interest_rate_percent),months=Number(req.body?.terms?.interest_duration_months??terms.interest_duration_months),days=Number(req.body?.terms?.collection_days??terms.collection_days);
      if(!Number.isFinite(rate)||rate<0||rate>100||!Number.isInteger(months)||months<1||months>600||!Number.isInteger(days)||days<1||days>3650){await db.query('ROLLBACK');res.status(400).json({error:'Enter a valid monthly rate, interest duration, and collection term.'});return;}
      const upfrontPercent=rate*months;if(upfrontPercent>=100){await db.query('ROLLBACK');res.status(400).json({error:'The total upfront interest must be less than the requested amount.'});return;}
      terms.interest_rate_percent=rate;terms.interest_model='flat';terms.interest_rate_period='monthly';terms.interest_duration_months=months;terms.collection_days=days;terms.repayment_model='daily_collection';terms.repayment_frequency='daily';terms.upfront_interest_amount=Number((Number(loan.principal_amount)*upfrontPercent/100).toFixed(2));terms.net_disbursement_amount=Number((Number(loan.principal_amount)-Number(terms.upfront_interest_amount)).toFixed(2));
      terms.overdue_rule=String(req.body?.terms?.overdue_rule??terms.overdue_rule);terms.overdue_charge=Number(req.body?.terms?.overdue_charge??terms.overdue_charge);terms.grace_period_days=Number(req.body?.terms?.grace_period_days??terms.grace_period_days);
      if(!['status_only','percentage_charge','fixed_charge'].includes(terms.overdue_rule)||!Number.isFinite(terms.overdue_charge)||terms.overdue_charge<0||!Number.isInteger(terms.grace_period_days)||terms.grace_period_days<0){await db.query('ROLLBACK');res.status(400).json({error:'Enter valid overdue treatment settings.'});return;}
      const approvalStart=new Date(`${approvalDate}T00:00:00Z`);
      for(let day=1;day<=days;day++){
        const due=new Date(approvalStart);due.setUTCDate(due.getUTCDate()+day);const dueDate=due.toISOString().slice(0,10);
        const face=Number(loan.principal_amount),amount=Number((day===days?face-Number((face/days).toFixed(2))*(days-1):face/days).toFixed(2));
        const saved=await db.query(`INSERT INTO loan_schedules(client_id,loan_id,installment_number,due_date,principal_due) VALUES($1,$2,$3,$4,$5) ON CONFLICT(loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,id,day,dueDate,amount]);
        if(saved.rowCount)await db.query(`INSERT INTO collection_tasks(client_id,borrower_id,loan_id,schedule_id,due_date) VALUES($1,$2,$3,$4,$5)`,[tenant,loan.borrower_id,id,saved.rows[0].id,dueDate]);
      }
      const maturity=new Date(approvalStart);maturity.setUTCDate(maturity.getUTCDate()+days);
      await db.query(`UPDATE loans SET status='approved',interest_rate_percent=$3,custom_duration_days=$4,start_date=$5,maturity_date=$6,terms_snapshot=$7::jsonb,approved_by=$8,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[id,tenant,rate,days,approvalDate,maturity.toISOString().slice(0,10),JSON.stringify(terms),(req as AuthedRequest).auth.id]);
    } else if(loan.request_type==='regular') {
      const requested=Number(terms.requested_interest_rate_percent);
      const rawRate=req.body?.terms?.interest_rate_percent===undefined?requested:Number(req.body.terms.interest_rate_percent);
      if(!Number.isFinite(rawRate)||rawRate<0||rawRate>100){await db.query('ROLLBACK');res.status(400).json({error:'Interest rate must be between 0 and 100 percent.'});return;}
      terms.interest_rate_percent=rawRate;terms.interest_model='simple';terms.interest_rate_period='monthly';terms.interest_frequency='monthly';terms.repayment_model='interest_only';terms.repayment_frequency='monthly';terms.payment_allocation='interest_first';terms.part_payments_allowed=true;terms.has_fixed_term=false;
      const due=new Date(`${approvalDate}T00:00:00Z`),day=due.getUTCDate();due.setUTCDate(1);due.setUTCMonth(due.getUTCMonth()+1);due.setUTCDate(Math.min(day,new Date(Date.UTC(due.getUTCFullYear(),due.getUTCMonth()+1,0)).getUTCDate()));
      const dueDate=due.toISOString().slice(0,10),interest=Number((Number(loan.principal_amount)*rawRate/100).toFixed(2));
      const saved=await db.query(`INSERT INTO loan_schedules(client_id,loan_id,installment_number,due_date,principal_due,interest_due) VALUES($1,$2,1,$3,0,$4) ON CONFLICT(loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,id,dueDate,interest]);
      if(saved.rowCount)await db.query(`INSERT INTO collection_tasks(client_id,borrower_id,loan_id,schedule_id,due_date) VALUES($1,$2,$3,$4,$5)`,[tenant,loan.borrower_id,id,saved.rows[0].id,dueDate]);
      await db.query(`UPDATE loans SET status='approved',interest_rate_percent=$3,start_date=$4,terms_snapshot=$5::jsonb,approved_by=$6,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[id,tenant,rawRate,approvalDate,JSON.stringify(terms),(req as AuthedRequest).auth.id]);
    } else {
    const allowed=['interest_model','interest_rate_percent','interest_rate_period','interest_frequency','repayment_frequency','grace_period_days','overdue_rule','overdue_charge'];
    for(const key of allowed) if(req.body?.terms?.[key]!==undefined) terms[key]=req.body.terms[key];
    if(!['simple','flat','reducing_balance'].includes(terms.interest_model)||!['daily','weekly','monthly','annual'].includes(terms.interest_rate_period)||!['daily','weekly','monthly','quarterly','at_maturity'].includes(terms.interest_frequency)||!['weekly','monthly','quarterly','at_maturity'].includes(terms.repayment_frequency)||!['status_only','percentage_charge','fixed_charge'].includes(terms.overdue_rule)) { await db.query('ROLLBACK');res.status(400).json({error:'Choose valid loan approval terms.'});return; }
    const grace=Number(terms.grace_period_days),overdueCharge=Number(terms.overdue_charge);if(!Number.isInteger(grace)||grace<0||!Number.isFinite(overdueCharge)||overdueCharge<0||(terms.overdue_rule==='status_only'&&overdueCharge!==0)){await db.query('ROLLBACK');res.status(400).json({error:'Enter a valid grace period and overdue charge.'});return;}
    const rate=Number(terms.interest_rate_percent); if(!Number.isFinite(rate)||rate<0||rate>100){await db.query('ROLLBACK');res.status(400).json({error:'Interest rate must be between 0 and 100 percent.'});return;}
    const term=Math.max(1,Number(loan.terms_snapshot?.installments)||1),principal=Number(loan.principal_amount),scheduleCount=terms.repayment_frequency==='at_maturity'?1:term;
    const periodRate=(rate/100)/(terms.interest_rate_period==='annual'?12:terms.interest_rate_period==='monthly'?1:terms.interest_rate_period==='weekly'?4.345:30.437)*(terms.repayment_frequency==='quarterly'?3:terms.repayment_frequency==='weekly'?0.23:1);
    const payment=terms.repayment_model==='principal_and_interest'&&periodRate>0&&terms.interest_model==='reducing_balance'?principal*periodRate/(1-Math.pow(1+periodRate,-term)):principal/term+(terms.repayment_model==='principal_and_interest'?principal*periodRate:0); let balance=principal;
    for(let i=1;i<=scheduleCount;i++){
      const due=new Date(`${approvalDate}T00:00:00Z`);
      if(terms.repayment_frequency==='at_maturity')due.setUTCMonth(due.getUTCMonth()+term);
      else if(terms.repayment_frequency==='weekly')due.setUTCDate(due.getUTCDate()+7*i);
      else due.setUTCMonth(due.getUTCMonth()+(terms.repayment_frequency==='quarterly'?3*i:i));
      const basis=terms.interest_model==='reducing_balance'?balance:principal;let pd=0,interest=0;
      if(terms.repayment_model==='bullet'){pd=i===scheduleCount?balance:0;interest=basis*periodRate*(terms.repayment_frequency==='at_maturity'?term:1);}
      else if(terms.repayment_model==='interest_only'){pd=i===scheduleCount?balance:0;interest=basis*periodRate*(terms.repayment_frequency==='at_maturity'?term:1);}
      else{interest=basis*periodRate*(terms.repayment_frequency==='at_maturity'?term:1);pd=Math.min(balance,payment-interest);if(i===scheduleCount)pd=balance;}
      balance=Math.max(0,balance-pd);const dueDate=due.toISOString().slice(0,10);
      const saved=await db.query(`INSERT INTO loan_schedules(client_id,loan_id,installment_number,due_date,principal_due,interest_due) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(loan_id,installment_number) DO UPDATE SET due_date=EXCLUDED.due_date,principal_due=EXCLUDED.principal_due,interest_due=EXCLUDED.interest_due RETURNING id`,[tenant,id,i,dueDate,pd.toFixed(2),interest.toFixed(2)]);
      const scheduleId=saved.rows[0].id;
      const updatedTask=await db.query(`UPDATE collection_tasks SET due_date=$4,status='pending' WHERE client_id=$1 AND loan_id=$2 AND schedule_id=$3 RETURNING id`,[tenant,id,scheduleId,dueDate]);
      if(!updatedTask.rowCount)await db.query(`INSERT INTO collection_tasks(client_id,borrower_id,loan_id,schedule_id,due_date) VALUES($1,$2,$3,$4,$5)`,[tenant,loan.borrower_id,id,scheduleId,dueDate]);
    }
    await db.query(`UPDATE loans SET status='approved',interest_rate_percent=$3,start_date=$4,terms_snapshot=$5::jsonb,approved_by=$6,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[id,tenant,rate,approvalDate,JSON.stringify(terms),(req as AuthedRequest).auth.id]);
    }
  } else await db.query(`UPDATE loans SET status='rejected',approved_by=$3,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[id,tenant,(req as AuthedRequest).auth.id]);
  decisionResult=await db.query(`SELECT id,loan_number,status FROM loans WHERE id=$1 AND client_id=$2`,[id,tenant]);
  await db.query(`INSERT INTO loan_audit_logs (client_id,actor_id,entity_type,entity_id,action,changes) VALUES ($1,$2,'loan',$3,$4,$5::jsonb)`,[tenant,(req as AuthedRequest).auth.id,id,decision,JSON.stringify({terms:decision==='approve'?terms:undefined})]);
  owner=await db.query(`SELECT b.customer_id,l.loan_number,l.principal_amount FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id WHERE l.id=$1 AND l.client_id=$2`,[id,tenant]); await db.query('COMMIT');
  } catch(e){await db.query('ROLLBACK');throw e;} finally{db.release();}
  if(owner.rowCount) await pool.query(`INSERT INTO customer_notifications (client_id,customer_id,kind,title,body,decision,reference_id)
    VALUES ($1,$2,'loan',$3,$4,$5,$6)`,[tenant,owner.rows[0].customer_id,decision==='approve'?'Loan request approved':'Loan request declined',
    decision==='approve'?`Your loan request ${owner.rows[0].loan_number} for ₹${Number(owner.rows[0].principal_amount).toLocaleString('en-IN')} was approved.`:`Your loan request ${owner.rows[0].loan_number} was declined. Contact your client for more information.`,decision==='approve'?'approved':'rejected',id]);
  res.json({loan:decisionResult.rows[0]});
}));

borrowingRouter.patch('/loans/:loanId/custom-offer', asyncHandler(async(req,res)=>{
  const tenant=clientId(req),id=value(req.params.loanId),decision=value(req.body?.decision);
  if(!['offer','reject'].includes(decision)){res.status(400).json({error:'Choose offer or reject.'});return;}
  const db=await pool.connect();let customer;
  try{
    await db.query('BEGIN');
    const found=await db.query(`SELECT l.*,b.customer_id FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id WHERE l.id=$1 AND l.client_id=$2 AND l.request_type='custom' AND l.status='pending_approval' FOR UPDATE OF l`,[id,tenant]);
    if(!found.rowCount){await db.query('ROLLBACK');res.status(409).json({error:'This custom request is no longer awaiting review.'});return;}
    const loan=found.rows[0];customer=loan.customer_id;
    if(decision==='offer'){
      if(Number(loan.counter_offer_count)!==0){await db.query('ROLLBACK');res.status(409).json({error:'Only one revised offer can be sent.'});return;}
      const principal=Number(req.body?.principalAmount),rate=Number(req.body?.interestRatePercent),days=Number(req.body?.durationDays),preference='maturity';
      if(!Number.isFinite(principal)||principal<=0||principal>1_000_000_000||!Number.isFinite(rate)||rate<0||rate>100||!Number.isInteger(days)||days<1||days>3650){await db.query('ROLLBACK');res.status(400).json({error:'Enter a valid amount, flat interest rate, and term.'});return;}
      if(loan.rollover_from_loan_id){
        const balance=await db.query(`SELECT COALESCE(SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)),0) AS amount FROM loan_schedules s JOIN loans p ON p.id=s.loan_id AND p.client_id=s.client_id WHERE s.client_id=$1 AND s.loan_id=$2 AND s.status NOT IN ('paid','waived') AND p.status IN ('active','overdue')`,[tenant,loan.rollover_from_loan_id]);
        if(Math.abs(Number(balance.rows[0]?.amount||0)-principal)>0.005){await db.query('ROLLBACK');res.status(409).json({error:`The rollover amount must match the current outstanding balance of ₹${Number(balance.rows[0]?.amount||0).toFixed(2)}. Update the offer amount and retry.`});return;}
      }
      const offer={principal_amount:principal,interest_rate_percent:rate,duration_days:days,repayment_preference:preference,total_repayment:Number((principal*(1+rate/100)).toFixed(2))};
      await db.query(`UPDATE loans SET status='pending_customer_acceptance',counter_offer_count=1,counter_offer=$3::jsonb,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[id,tenant,JSON.stringify(offer)]);
      await db.query(`INSERT INTO customer_notifications (client_id,customer_id,kind,title,body,decision,reference_id) VALUES ($1,$2,'loan','Custom loan offer', $3,'offer',$4)`,[tenant,customer,`Your client offers ₹${principal.toLocaleString('en-IN')} at ${rate}% flat interest for ${days} days. Total repayment: ₹${offer.total_repayment.toLocaleString('en-IN')}. Review and accept or decline in the app.`,id]);
    }else{
      await db.query(`UPDATE loans SET status='rejected',approved_by=$3,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[id,tenant,(req as AuthedRequest).auth.id]);
      await db.query(`INSERT INTO customer_notifications (client_id,customer_id,kind,title,body,decision,reference_id) VALUES ($1,$2,'loan','Custom loan request declined','Your custom loan request was declined. You may submit a new request.','rejected',$3)`,[tenant,customer,id]);
    }
    await db.query(`INSERT INTO loan_audit_logs (client_id,actor_id,entity_type,entity_id,action,changes) VALUES ($1,$2,'loan',$3,$4,$5::jsonb)`,[tenant,(req as AuthedRequest).auth.id,id,decision==='offer'?'custom_offer_sent':'custom_request_rejected',JSON.stringify({offer:decision==='offer'?{principalAmount:req.body?.principalAmount,interestRatePercent:req.body?.interestRatePercent,durationDays:req.body?.durationDays,repaymentPreference:req.body?.repaymentPreference}:undefined})]);
    await db.query('COMMIT');res.json({status:decision==='offer'?'pending_customer_acceptance':'rejected'});
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}));

borrowingRouter.post('/loans/:loanId/custom-late-charge',asyncHandler(async(req,res)=>{
  const tenant=clientId(req),id=value(req.params.loanId),charge=positive(req.body?.amount),db=await pool.connect();
  if(!Number.isFinite(charge)){res.status(400).json({error:'Enter an extra one-time charge greater than zero.'});return;}
  try{
    await db.query('BEGIN');
    const loan=await db.query(`SELECT l.id,l.status FROM loans l WHERE l.id=$1 AND l.client_id=$2 AND l.request_type='custom' AND l.status IN ('active','overdue') FOR UPDATE`,[id,tenant]);
    if(!loan.rowCount){await db.query('ROLLBACK');res.status(409).json({error:'Extra charges are available only for active custom loans.'});return;}
    const schedule=await db.query(`SELECT id,due_date FROM loan_schedules WHERE loan_id=$1 AND client_id=$2 AND status IN ('scheduled','partial','overdue') AND due_date<public.admin_ist_today() ORDER BY due_date DESC LIMIT 1 FOR UPDATE`,[id,tenant]);
    if(!schedule.rowCount){await db.query('ROLLBACK');res.status(409).json({error:'An extra charge can be recorded only after maturity.'});return;}
    await db.query(`UPDATE loan_schedules SET overdue_charge=overdue_charge+$3,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[schedule.rows[0].id,tenant,charge]);
    await db.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,overdue_debit,event_date,description,actor_id) VALUES ($1,$2,'adjustment',$3,public.admin_ist_today(),'Admin recorded optional post-maturity charge',$4)`,[tenant,id,charge,(req as AuthedRequest).auth.id]);
    await db.query(`UPDATE collection_tasks SET status='pending' WHERE loan_id=$1 AND client_id=$2 AND schedule_id=$3`,[id,tenant,schedule.rows[0].id]);
    await db.query(`INSERT INTO loan_audit_logs (client_id,actor_id,entity_type,entity_id,action,changes) VALUES ($1,$2,'loan',$3,'custom_late_charge',$4::jsonb)`,[tenant,(req as AuthedRequest).auth.id,id,JSON.stringify({amount:charge})]);
    await db.query('COMMIT');res.json({amount:charge});
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}));

borrowingRouter.post('/loans/:loanId/disburse', asyncHandler(async(req,res)=>{
  const tenant=clientId(req), id=value(req.params.loanId), start=value(req.body?.date)||new Date().toISOString().slice(0,10);
  const db=await pool.connect();
  try { await db.query('BEGIN');
    const selected=await db.query(`SELECT l.id,l.request_type,l.custom_duration_days,l.interest_rate_percent,l.principal_amount,l.loan_number,l.borrower_id,l.repayment_preference,l.terms_snapshot,l.start_date FROM loans l WHERE l.id=$1 AND l.client_id=$2 AND l.status='approved' FOR UPDATE`,[id,tenant]);
    if(!selected.rowCount){await db.query('ROLLBACK');res.status(409).json({error:'Only approved, undistributed loans can be disbursed.'});return;}
  const row=selected.rows[0],scheduleStart=row.start_date?String(row.start_date).slice(0,10):start;
    const recordedDisbursement=row.request_type==='daily'?Number(row.terms_snapshot?.net_disbursement_amount??Number(row.principal_amount)*(1-Number(row.interest_rate_percent)*Number(row.terms_snapshot?.interest_duration_months)/100)):Number(row.principal_amount);
    const maturity=row.request_type==='custom'?new Date(`${scheduleStart}T00:00:00Z`):null;
    if(maturity)maturity.setUTCDate(maturity.getUTCDate()+Number(row.custom_duration_days));
    const r=await db.query(`UPDATE loans SET status='active',disbursed_at=NOW(),start_date=COALESCE(start_date,$3),maturity_date=COALESCE(maturity_date,$4),updated_at=NOW()
      WHERE id=$1 AND client_id=$2 RETURNING id,principal_amount,loan_number,borrower_id`,[id,tenant,start,maturity?.toISOString().slice(0,10)??null]);
    if(!r.rowCount){await db.query('ROLLBACK');res.status(409).json({error:'Only approved, undistributed loans can be disbursed.'});return;}
    await db.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,principal_debit,event_date,description,actor_id) VALUES ($1,$2,'disbursement',$3,$4,$5,$6)`,[tenant,id,recordedDisbursement,start,row.request_type==='daily'?'Daily loan net amount recorded as disbursed':'Manual disbursement recorded',(req as AuthedRequest).auth.id]);
    if(row.request_type==='custom'){
      const interest=Number((Number(row.principal_amount)*Number(row.interest_rate_percent)/100).toFixed(2));
      const dueDate=maturity!.toISOString().slice(0,10),saved=await db.query(`INSERT INTO loan_schedules (client_id,loan_id,installment_number,due_date,principal_due,interest_due) VALUES ($1,$2,1,$3,$4,$5) ON CONFLICT(loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,id,dueDate,row.principal_amount,interest]);
      if(saved.rowCount)await db.query(`INSERT INTO collection_tasks (client_id,borrower_id,loan_id,schedule_id,due_date) VALUES ($1,$2,$3,$4,$5)`,[tenant,row.borrower_id,id,saved.rows[0].id,dueDate]);
      await db.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,interest_debit,event_date,description,actor_id) VALUES ($1,$2,'interest_accrued',$3,$4,'One-time flat custom loan interest',$5)`,[tenant,id,interest,start,(req as AuthedRequest).auth.id]);
    }
    if(row.request_type==='daily'){
      const days=Number(row.terms_snapshot.collection_days),months=Number(row.terms_snapshot.interest_duration_months),rate=Number(row.interest_rate_percent),face=Number(row.principal_amount);
      if(!Number.isInteger(days)||days<1||!Number.isInteger(months)||months<1||rate*months>=100){await db.query('ROLLBACK');res.status(409).json({error:'Daily loan terms are incomplete or produce a non-positive payout.'});return;}
      const net=Number((face*(1-rate*months/100)).toFixed(2)),upfront=Number((face-net).toFixed(2));
      const finalDate=new Date(`${scheduleStart}T00:00:00Z`);finalDate.setUTCDate(finalDate.getUTCDate()+days);const maturityDate=finalDate.toISOString().slice(0,10);
      await db.query(`UPDATE loans SET maturity_date=$3,terms_snapshot=terms_snapshot||$4::jsonb WHERE id=$1 AND client_id=$2`,[id,tenant,maturityDate,JSON.stringify({net_disbursement_amount:net,upfront_interest_amount:upfront})]);
      if(upfront>0)await db.query(`INSERT INTO loan_ledger(client_id,loan_id,event_type,principal_debit,event_date,description,actor_id) VALUES($1,$2,'adjustment',$3,$4,'Upfront interest deduction included in the face amount due',$5)`,[tenant,id,upfront,start,(req as AuthedRequest).auth.id]);
      for(let day=1;day<=days;day++){
        const due=new Date(`${scheduleStart}T00:00:00Z`);due.setUTCDate(due.getUTCDate()+day);const dueDate=due.toISOString().slice(0,10);
        const dailyAmount=Number((day===days?face-Number((face/days).toFixed(2))*(days-1):face/days).toFixed(2));
        const saved=await db.query(`INSERT INTO loan_schedules(client_id,loan_id,installment_number,due_date,principal_due) VALUES($1,$2,$3,$4,$5) ON CONFLICT(loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,id,day,dueDate,dailyAmount]);
        if(saved.rowCount)await db.query(`INSERT INTO collection_tasks(client_id,borrower_id,loan_id,schedule_id,due_date) VALUES($1,$2,$3,$4,$5)`,[tenant,row.borrower_id,id,saved.rows[0].id,dueDate]);
      }
    }
    if(row.request_type==='regular'){
      const due=new Date(`${scheduleStart}T00:00:00Z`);const day=due.getUTCDate();due.setUTCDate(1);due.setUTCMonth(due.getUTCMonth()+1);due.setUTCDate(Math.min(day,new Date(Date.UTC(due.getUTCFullYear(),due.getUTCMonth()+1,0)).getUTCDate()));
      const dueDate=due.toISOString().slice(0,10),interest=Number((Number(row.principal_amount)*Number(row.interest_rate_percent)/100).toFixed(2));
      const saved=await db.query(`INSERT INTO loan_schedules (client_id,loan_id,installment_number,due_date,principal_due,interest_due) VALUES ($1,$2,1,$3,0,$4) ON CONFLICT(loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,id,dueDate,interest]);
      if(saved.rowCount)await db.query(`INSERT INTO collection_tasks (client_id,borrower_id,loan_id,schedule_id,due_date) VALUES ($1,$2,$3,$4,$5)`,[tenant,row.borrower_id,id,saved.rows[0].id,dueDate]);
      await db.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,interest_debit,event_date,description,actor_id) VALUES ($1,$2,'interest_accrued',$3,$4,'Monthly interest on outstanding principal',$5)`,[tenant,id,interest,dueDate,(req as AuthedRequest).auth.id]);
    }
    await db.query(`INSERT INTO loan_audit_logs (client_id,actor_id,entity_type,entity_id,action) VALUES ($1,$2,'loan',$3,'disbursed')`,[tenant,(req as AuthedRequest).auth.id,id]);
    const customer=await db.query(`SELECT customer_id FROM borrowers WHERE id=$1 AND client_id=$2`,[r.rows[0].borrower_id,tenant]);
    if(customer.rowCount) await db.query(`INSERT INTO customer_notifications (client_id,customer_id,kind,title,body,decision,reference_id)
      VALUES ($1,$2,'loan','Loan disbursed',$3,'recorded',$4)`,[tenant,customer.rows[0].customer_id,`Your loan ${r.rows[0].loan_number} has been disbursed and is now active.`,id]);
    await db.query('COMMIT');res.json({loan:r.rows[0]});
  } catch(e){await db.query('ROLLBACK');throw e;} finally{db.release();}
}));

borrowingRouter.post('/loans/:loanId/payments', asyncHandler(async(req,res)=>{
  const tenant=clientId(req), id=value(req.params.loanId), amount=positive(req.body?.amount), receivedOn=value(req.body?.receivedOn)||new Date().toISOString().slice(0,10), reference=value(req.body?.referenceNumber)||null;
  if(!Number.isFinite(amount)){res.status(400).json({error:'Enter a payment amount greater than zero.'});return;}
  const db=await pool.connect();
  try {await db.query('BEGIN');
    const loan=await db.query(`SELECT l.id,l.loan_number,l.status,l.request_type,l.maturity_date::text AS maturity_date,l.borrower_id,b.customer_id,lp.* FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id WHERE l.id=$1 AND l.client_id=$2 FOR UPDATE OF l`,[id,tenant]);
    if(!loan.rowCount || !['active','overdue'].includes(loan.rows[0].status)){await db.query('ROLLBACK');res.status(409).json({error:'Payments can only be posted to active loans.'});return;}
    const product=loan.rows[0];
    if(product.request_type==='regular')await ensureRegularInterestSchedules(tenant,receivedOn);
    const schedules=await db.query(`SELECT * FROM loan_schedules WHERE loan_id=$1 AND client_id=$2 AND status IN ('scheduled','partial','overdue') ORDER BY due_date,installment_number FOR UPDATE`,[id,tenant]);
    const isCustom=product.request_type==='custom',isRegular=product.request_type==='regular',isDaily=product.request_type==='daily';
    if(isCustom&&product.maturity_date&&receivedOn<String(product.maturity_date).slice(0,10)){
      const fullBalance=schedules.rows.reduce((sum:number,s:any)=>sum+Math.max(0,Number(s.principal_due)+Number(s.interest_due)+Number(s.overdue_charge)-Number(s.amount_paid)),0);
      if(amount+0.005<fullBalance){await db.query('ROLLBACK');res.status(400).json({error:`Custom loans can be partially paid only at maturity. To settle early, record the full balance of ₹${fullBalance.toFixed(2)}.`});return;}
    }
    const remainingBalance=schedules.rows.reduce((sum:number,s:any)=>sum+Math.max(0,Number(s.principal_due)+Number(s.interest_due)+Number(s.overdue_charge)-Number(s.amount_paid)),0);
    const dueBalance=schedules.rows.filter((s:any)=>String(s.due_date).slice(0,10)<=receivedOn).reduce((sum:number,s:any)=>sum+Math.max(0,Number(s.principal_due)+Number(s.interest_due)+Number(s.overdue_charge)-Number(s.amount_paid)),0);
    if(isDaily&&(amount>remainingBalance+0.005||(amount+0.005<dueBalance)||(amount>dueBalance+0.005&&amount+0.005<remainingBalance))){await db.query('ROLLBACK');res.status(400).json({error:`Daily loan payments must cover all accumulated collections (₹${dueBalance.toFixed(2)}) or settle the full remaining balance (₹${remainingBalance.toFixed(2)}).`});return;}
    const applicableSchedules=isCustom?schedules.rows:isDaily&&amount+0.005>=remainingBalance?schedules.rows:schedules.rows.filter((schedule)=>String(schedule.due_date).slice(0,10)<=receivedOn||(!isRegular&&product.advance_payment_treatment==='cover_future_dues'));
    const nextSchedule=applicableSchedules[0];
    if(!isCustom&&!isRegular&&!product.part_payments_allowed && nextSchedule){
      const nextDue=Number(nextSchedule.principal_due)+Number(nextSchedule.interest_due)+Number(nextSchedule.overdue_charge)-Number(nextSchedule.amount_paid);
      if(amount+0.005<nextDue){await db.query('ROLLBACK');res.status(400).json({error:`Part payments are disabled. The next scheduled amount is ₹${nextDue.toFixed(2)}.`});return;}
    }
    let left=amount, principal=0, interest=0, overdue=0;
    for(const s of applicableSchedules){
      const order=product.request_type==='regular'?['overdue_charge','interest_due','principal_due']:product.payment_allocation==='principal_first'?['principal_due','interest_due','overdue_charge']:['overdue_charge','interest_due','principal_due'];
      let priorPaid=Number(s.amount_paid), schedulePaid=Number(s.amount_paid);
      for(const component of order){
        const componentDue=Number(s[component]);
        const alreadyOnComponent=Math.min(componentDue,priorPaid); priorPaid=Math.max(0,priorPaid-alreadyOnComponent);
        const remaining=Math.max(0,componentDue-alreadyOnComponent); if(!remaining || !left)continue;
        const applied=Math.min(left,remaining); left-=applied;
        if(component==='principal_due')principal+=applied;else if(component==='interest_due')interest+=applied;else overdue+=applied;
        schedulePaid+=applied;
      }
      if(schedulePaid>Number(s.amount_paid)){
        const total=Number(s.principal_due)+Number(s.interest_due)+Number(s.overdue_charge);
        await db.query(`UPDATE loan_schedules SET amount_paid=$3,status=$4,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[s.id,tenant,schedulePaid.toFixed(2),schedulePaid+0.005>=total?'paid':'partial']);
      }
    }
    if(product.request_type==='regular'&&left>0){
      const outstanding=await db.query(`SELECT GREATEST(COALESCE(SUM(principal_debit-principal_credit),0),0) AS principal FROM loan_ledger WHERE client_id=$1 AND loan_id=$2`,[tenant,id]);
      const applied=Math.min(left,Number(outstanding.rows[0].principal));principal+=applied;left-=applied;
    }
    if(left && product.advance_payment_treatment==='reduce_principal'){
      for(const s of [...schedules.rows].reverse()){
        if(left<=0) break;
        let paidToAllocate=Number(s.amount_paid), principalAlreadyPaid=0;
        const allocationOrder=product.payment_allocation==='principal_first'?['principal_due','interest_due','overdue_charge']:['overdue_charge','interest_due','principal_due'];
        for(const component of allocationOrder){const paid=Math.min(Number(s[component]),paidToAllocate);if(component==='principal_due')principalAlreadyPaid=paid;paidToAllocate=Math.max(0,paidToAllocate-paid);}
        const principalRemaining=Math.max(0,Number(s.principal_due)-principalAlreadyPaid);
        const reduction=Math.min(left,principalRemaining);
        if(reduction<=0) continue;
        await db.query(`UPDATE loan_schedules SET principal_due=GREATEST(0,principal_due-$3),updated_at=NOW() WHERE id=$1 AND client_id=$2`,[s.id,tenant,reduction.toFixed(2)]);
        principal+=reduction; left-=reduction;
      }
    }
    const unapplied=left;
    const inserted=await db.query(`INSERT INTO loan_payments (client_id,loan_id,customer_id,received_on,amount_received,principal_component,interest_component,overdue_component,unapplied_amount,reference_number,recorded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[tenant,id,product.customer_id,receivedOn,amount.toFixed(2),principal.toFixed(2),interest.toFixed(2),overdue.toFixed(2),unapplied.toFixed(2),reference,(req as AuthedRequest).auth.id]);
    await db.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,principal_credit,interest_credit,overdue_credit,reference_type,reference_id,event_date,description,actor_id) VALUES ($1,$2,'payment',$3,$4,$5,'payment',$6,$7,'Repayment recorded',$8)`,[tenant,id,principal.toFixed(2),interest.toFixed(2),overdue.toFixed(2),inserted.rows[0].id,receivedOn,(req as AuthedRequest).auth.id]);
    if(product.request_type==='regular'){
      const remaining=await db.query(`SELECT COALESCE(SUM(principal_debit-principal_credit),0) AS principal FROM loan_ledger WHERE client_id=$1 AND loan_id=$2`,[tenant,id]);
      if(Number(remaining.rows[0].principal)<=0.005){
        await db.query(`UPDATE loan_schedules SET status='waived',updated_at=NOW() WHERE client_id=$1 AND loan_id=$2 AND due_date>$3 AND status IN ('scheduled','partial','overdue')`,[tenant,id,receivedOn]);
        await db.query(`UPDATE collection_tasks SET status='completed',completed_by=$3,completed_at=NOW() WHERE client_id=$1 AND loan_id=$2 AND status='pending' AND schedule_id IN (SELECT id FROM loan_schedules WHERE client_id=$1 AND loan_id=$2 AND status='waived')`,[tenant,id,(req as AuthedRequest).auth.id]);
      }
    }
    await db.query(`INSERT INTO customer_notifications (client_id,customer_id,kind,title,body,decision,reference_id)
      VALUES ($1,$2,'loan','Loan repayment recorded',$3,'recorded',$4)`,[tenant,product.customer_id,`A repayment of ₹${amount.toLocaleString('en-IN')} for loan ${product.loan_number ?? id} was recorded.`,inserted.rows[0].id]);
    await db.query(`UPDATE collection_tasks SET status='completed',completed_by=$3,completed_at=NOW() WHERE loan_id=$1 AND client_id=$2 AND status='pending' AND schedule_id IN (SELECT id FROM loan_schedules WHERE loan_id=$1 AND status='paid')`,[id,tenant,(req as AuthedRequest).auth.id]);
    await db.query(`UPDATE loans l SET
      status=CASE
        WHEN (l.request_type IN ('custom','regular','daily') OR lp.closure_mode='automatic') AND NOT EXISTS (SELECT 1 FROM loan_schedules s WHERE s.client_id=l.client_id AND s.loan_id=l.id AND s.status NOT IN ('paid','waived')) AND NOT EXISTS (SELECT 1 FROM loan_ledger ll WHERE ll.client_id=l.client_id AND ll.loan_id=l.id GROUP BY ll.loan_id HAVING SUM(ll.principal_debit-ll.principal_credit)>0.005) THEN 'closed'
        WHEN l.status='overdue' AND NOT EXISTS (SELECT 1 FROM loan_schedules s WHERE s.client_id=l.client_id AND s.loan_id=l.id AND s.status='overdue') THEN 'active'
        ELSE l.status END,
      closed_at=CASE WHEN (l.request_type IN ('custom','regular','daily') OR lp.closure_mode='automatic') AND NOT EXISTS (SELECT 1 FROM loan_schedules s WHERE s.client_id=l.client_id AND s.loan_id=l.id AND s.status NOT IN ('paid','waived')) AND NOT EXISTS (SELECT 1 FROM loan_ledger ll WHERE ll.client_id=l.client_id AND ll.loan_id=l.id GROUP BY ll.loan_id HAVING SUM(ll.principal_debit-ll.principal_credit)>0.005) THEN NOW() ELSE l.closed_at END,
      updated_at=NOW() FROM loan_products lp WHERE l.id=$1 AND l.client_id=$2 AND lp.id=l.product_id AND lp.client_id=l.client_id`,[id,tenant]);
    await db.query('COMMIT');res.status(201).json({paymentId:inserted.rows[0].id,amount,principal,interest,overdue,unapplied});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}));

borrowingRouter.post('/loans/:loanId/close', asyncHandler(async(req,res)=>{
  const tenant=clientId(req),id=value(req.params.loanId);
  const result=await pool.query(`UPDATE loans l SET status='closed',closed_at=NOW(),close_reason=$3,updated_at=NOW()
    FROM loan_products lp WHERE l.id=$1 AND l.client_id=$2 AND lp.id=l.product_id AND lp.client_id=l.client_id
      AND l.status IN ('active','overdue') AND lp.closure_mode='manual'
      AND NOT EXISTS(SELECT 1 FROM loan_schedules s WHERE s.loan_id=l.id AND s.client_id=l.client_id AND s.status NOT IN ('paid','waived'))
    RETURNING l.id,l.loan_number,l.status`,[id,tenant,value(req.body?.reason)||'Closed by Client Admin']);
  if(!result.rowCount){res.status(409).json({error:'Manual closure is configured only for loans with no outstanding dues.'});return;}
  await pool.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,event_date,description,actor_id) VALUES ($1,$2,'closure',public.admin_ist_today(),'Loan closed',$3)`,[tenant,id,(req as AuthedRequest).auth.id]);
  await pool.query(`INSERT INTO loan_audit_logs (client_id,actor_id,entity_type,entity_id,action) VALUES ($1,$2,'loan',$3,'closed')`,[tenant,(req as AuthedRequest).auth.id,id]);
  res.json({loan:result.rows[0]});
}));

borrowingRouter.post('/loans/:loanId/write-off', asyncHandler(async(req,res)=>{
  const tenant=clientId(req),id=value(req.params.loanId),db=await pool.connect();
  try {await db.query('BEGIN');
    const result=await db.query(`SELECT l.id,l.status,lp.write_off_allowed FROM loans l JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id
      WHERE l.id=$1 AND l.client_id=$2 FOR UPDATE OF l`,[id,tenant]);
    if(!result.rowCount||!result.rows[0].write_off_allowed||!['active','overdue'].includes(result.rows[0].status)){await db.query('ROLLBACK');res.status(409).json({error:'Write-off is not allowed for this loan.'});return;}
    const balances=await db.query(`SELECT COALESCE(SUM(GREATEST(principal_due-amount_paid,0)),0) AS principal,
      COALESCE(SUM(GREATEST(interest_due+overdue_charge,0)),0) AS charges FROM loan_schedules WHERE loan_id=$1 AND client_id=$2 AND status NOT IN ('paid','waived')`,[id,tenant]);
    const principal=Number(balances.rows[0].principal),charges=Number(balances.rows[0].charges);
    await db.query(`UPDATE loan_schedules SET status='waived',updated_at=NOW() WHERE loan_id=$1 AND client_id=$2 AND status NOT IN ('paid','waived')`,[id,tenant]);
    await db.query(`UPDATE loans SET status='written_off',closed_at=NOW(),close_reason=$3,updated_at=NOW() WHERE id=$1 AND client_id=$2`,[id,tenant,value(req.body?.reason)||'Written off by Client Admin']);
    await db.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,principal_credit,interest_credit,overdue_credit,event_date,description,actor_id) VALUES ($1,$2,'write_off',$3,$4,$5,public.admin_ist_today(),'Outstanding balance written off',$6)`,[tenant,id,principal.toFixed(2),charges.toFixed(2),'0',(req as AuthedRequest).auth.id]);
    await db.query(`INSERT INTO loan_audit_logs (client_id,actor_id,entity_type,entity_id,action,changes) VALUES ($1,$2,'loan',$3,'written_off',$4::jsonb)`,[tenant,(req as AuthedRequest).auth.id,id,JSON.stringify({principal,charges})]);
    await db.query('COMMIT');res.json({loanId:id,principalWrittenOff:principal,chargesWrittenOff:charges});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}));

borrowingRouter.patch('/borrowers/:borrowerId/status', asyncHandler(async(req,res)=>{
 const status=value(req.body?.status); if(!['active','inactive','blocked','closed'].includes(status)){res.status(400).json({error:'Choose a valid borrower status.'});return;}
 const result=await pool.query(`UPDATE borrowers SET status=$3,updated_at=NOW() WHERE id=$1 AND client_id=$2 RETURNING id,status`,[value(req.params.borrowerId),clientId(req),status]);
 if(!result.rowCount){res.status(404).json({error:'Borrower not found.'});return;} res.json({borrower:result.rows[0]});
}));
