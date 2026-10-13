import { Router } from 'express';
import { asyncHandler, requireAuth, requireClientAdmin } from '../middleware';
import { pool } from '../db';
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
  await pool.query(`UPDATE loan_schedules s SET status='overdue',
      overdue_charge=CASE lp.overdue_rule
        WHEN 'fixed_charge' THEN lp.overdue_charge
        WHEN 'percentage_charge' THEN ROUND(GREATEST(s.principal_due-s.amount_paid,0)*lp.overdue_charge/100,2)
        ELSE 0 END, updated_at=NOW()
    FROM loans l JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id
    WHERE s.loan_id=l.id AND s.client_id=l.client_id AND l.client_id=$1
      AND s.status IN ('scheduled','partial')
      AND s.due_date + lp.grace_period_days < public.admin_ist_today()`, [tenant]);
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
        WHERE l.client_id=$1 AND l.status IN ('active','overdue') AND s.status NOT IN ('paid','waived')) AS outstanding`, [tenant]),
    pool.query(`SELECT b.id, c.full_name AS name, c.customer_code AS code, c.mobile_number AS mobile,
      b.status, b.created_at, COUNT(l.id)::int AS loan_count
      FROM borrowers b JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id
      LEFT JOIN loans l ON l.borrower_id=b.id AND l.client_id=b.client_id
      WHERE b.client_id=$1 GROUP BY b.id,c.id ORDER BY b.created_at DESC LIMIT 250`, [tenant]),
    pool.query(`SELECT l.id,l.loan_number,l.status,l.principal_amount,l.interest_rate_percent,l.start_date,l.maturity_date,l.created_at,
      c.full_name AS borrower_name,c.customer_code AS borrower_code,lp.name AS product_name,lp.write_off_allowed,lp.closure_mode,
      COALESCE((SELECT SUM(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid) FROM loan_schedules s WHERE s.loan_id=l.id AND s.client_id=l.client_id AND s.status <> 'waived'),0) AS balance
      FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id
      JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id
      JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id
      WHERE l.client_id=$1 ORDER BY l.created_at DESC LIMIT 250`, [tenant]),
    pool.query(`SELECT id,name,interest_model,interest_rate_percent,interest_rate_period,repayment_model,repayment_frequency,approval_workflow,
      payment_allocation,grace_period_days,overdue_rule,overdue_charge,part_payments_allowed,advance_payment_treatment,receipt_required,write_off_allowed,closure_mode,rounding_scale,required_documents
      FROM loan_products WHERE client_id=$1 AND status='active' ORDER BY created_at`, [tenant]),
    pool.query(`SELECT t.id,t.due_date,s.status,l.loan_number,c.full_name AS borrower_name,c.customer_code AS borrower_code,
      GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0) AS due_amount
      FROM collection_tasks t JOIN loans l ON l.id=t.loan_id AND l.client_id=t.client_id
      JOIN borrowers b ON b.id=t.borrower_id AND b.client_id=t.client_id
      JOIN customers c ON c.id=b.customer_id AND c.client_id=b.client_id
      LEFT JOIN loan_schedules s ON s.id=t.schedule_id AND s.client_id=t.client_id
      WHERE t.client_id=$1 AND (t.status='pending' OR s.status='overdue') ORDER BY t.due_date LIMIT 500`, [tenant]),
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
    pool.query(`SELECT l.id,l.loan_number,l.status,l.principal_amount,l.interest_rate_percent,l.terms_snapshot,l.start_date,l.maturity_date,l.disbursed_at,l.closed_at,l.close_reason,
      c.full_name borrower_name,c.customer_code borrower_code,c.mobile_number,k.aadhaar_number,k.pan_number,lp.name product_name,lp.receipt_required,lp.required_documents,
      COALESCE((SELECT SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)) FROM loan_schedules s WHERE s.loan_id=l.id AND s.client_id=l.client_id AND s.status NOT IN ('waived')),0) balance
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
    COALESCE(SUM(GREATEST(s.principal_due+s.interest_due+s.overdue_charge-s.amount_paid,0)) FILTER(WHERE s.status NOT IN ('waived')),0) balance,
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
  const result=await pool.query(`UPDATE loans SET status=$3,approved_by=$4,updated_at=NOW()
    WHERE id=$1 AND client_id=$2 AND status='pending_approval' RETURNING id,loan_number,status`,[id,tenant,decision==='approve'?'approved':'rejected',(req as AuthedRequest).auth.id]);
  if (!result.rowCount) {res.status(409).json({error:'This loan is not awaiting approval.'});return;}
  await pool.query(`INSERT INTO loan_audit_logs (client_id,actor_id,entity_type,entity_id,action) VALUES ($1,$2,'loan',$3,$4)`,[tenant,(req as AuthedRequest).auth.id,id,decision]);
  const owner=await pool.query(`SELECT b.customer_id,l.loan_number,l.principal_amount FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id WHERE l.id=$1 AND l.client_id=$2`,[id,tenant]);
  if(owner.rowCount) await pool.query(`INSERT INTO customer_notifications (client_id,customer_id,kind,title,body,decision,reference_id)
    VALUES ($1,$2,'loan',$3,$4,$5,$6)`,[tenant,owner.rows[0].customer_id,decision==='approve'?'Loan request approved':'Loan request declined',
    decision==='approve'?`Your loan request ${owner.rows[0].loan_number} for ₹${Number(owner.rows[0].principal_amount).toLocaleString('en-IN')} was approved.`:`Your loan request ${owner.rows[0].loan_number} was declined. Contact your client for more information.`,decision==='approve'?'approved':'rejected',id]);
  res.json({loan:result.rows[0]});
}));

borrowingRouter.post('/loans/:loanId/disburse', asyncHandler(async(req,res)=>{
  const tenant=clientId(req), id=value(req.params.loanId), start=value(req.body?.date)||new Date().toISOString().slice(0,10);
  const db=await pool.connect();
  try { await db.query('BEGIN');
    const r=await db.query(`UPDATE loans SET status='active',disbursed_at=NOW(),start_date=COALESCE(start_date,$3),updated_at=NOW()
      WHERE id=$1 AND client_id=$2 AND status='approved' RETURNING id,principal_amount,loan_number,borrower_id`,[id,tenant,start]);
    if(!r.rowCount){await db.query('ROLLBACK');res.status(409).json({error:'Only approved, undistributed loans can be disbursed.'});return;}
    await db.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,principal_debit,event_date,description,actor_id) VALUES ($1,$2,'disbursement',$3,$4,'Manual disbursement recorded',$5)`,[tenant,id,r.rows[0].principal_amount,start,(req as AuthedRequest).auth.id]);
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
    const loan=await db.query(`SELECT l.id,l.loan_number,l.status,l.borrower_id,b.customer_id,lp.* FROM loans l JOIN borrowers b ON b.id=l.borrower_id AND b.client_id=l.client_id JOIN loan_products lp ON lp.id=l.product_id AND lp.client_id=l.client_id WHERE l.id=$1 AND l.client_id=$2 FOR UPDATE OF l`,[id,tenant]);
    if(!loan.rowCount || !['active','overdue'].includes(loan.rows[0].status)){await db.query('ROLLBACK');res.status(409).json({error:'Payments can only be posted to active loans.'});return;}
    const product=loan.rows[0];
    const schedules=await db.query(`SELECT * FROM loan_schedules WHERE loan_id=$1 AND client_id=$2 AND status IN ('scheduled','partial','overdue') ORDER BY due_date,installment_number FOR UPDATE`,[id,tenant]);
    const applicableSchedules=schedules.rows.filter((schedule)=>String(schedule.due_date).slice(0,10)<=receivedOn||product.advance_payment_treatment==='cover_future_dues');
    const nextSchedule=applicableSchedules[0];
    if(!product.part_payments_allowed && nextSchedule){
      const nextDue=Number(nextSchedule.principal_due)+Number(nextSchedule.interest_due)+Number(nextSchedule.overdue_charge)-Number(nextSchedule.amount_paid);
      if(amount+0.005<nextDue){await db.query('ROLLBACK');res.status(400).json({error:`Part payments are disabled. The next scheduled amount is ₹${nextDue.toFixed(2)}.`});return;}
    }
    let left=amount, principal=0, interest=0, overdue=0;
    for(const s of applicableSchedules){
      const order=product.payment_allocation==='principal_first'?['principal_due','interest_due','overdue_charge']:['overdue_charge','interest_due','principal_due'];
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
    await db.query(`INSERT INTO customer_notifications (client_id,customer_id,kind,title,body,decision,reference_id)
      VALUES ($1,$2,'loan','Loan repayment recorded',$3,'recorded',$4)`,[tenant,product.customer_id,`A repayment of ₹${amount.toLocaleString('en-IN')} for loan ${product.loan_number ?? id} was recorded.`,inserted.rows[0].id]);
    await db.query(`UPDATE collection_tasks SET status='completed',completed_by=$3,completed_at=NOW() WHERE loan_id=$1 AND client_id=$2 AND status='pending' AND schedule_id IN (SELECT id FROM loan_schedules WHERE loan_id=$1 AND status='paid')`,[id,tenant,(req as AuthedRequest).auth.id]);
    await db.query(`UPDATE loans l SET
      status=CASE
        WHEN lp.closure_mode='automatic' AND NOT EXISTS (SELECT 1 FROM loan_schedules s WHERE s.client_id=l.client_id AND s.loan_id=l.id AND s.status NOT IN ('paid','waived')) THEN 'closed'
        WHEN l.status='overdue' AND NOT EXISTS (SELECT 1 FROM loan_schedules s WHERE s.client_id=l.client_id AND s.loan_id=l.id AND s.status='overdue') THEN 'active'
        ELSE l.status END,
      closed_at=CASE WHEN lp.closure_mode='automatic' AND NOT EXISTS (SELECT 1 FROM loan_schedules s WHERE s.client_id=l.client_id AND s.loan_id=l.id AND s.status NOT IN ('paid','waived')) THEN NOW() ELSE l.closed_at END,
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
