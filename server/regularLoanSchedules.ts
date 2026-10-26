import { pool } from './db';

function dateOnly(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0,10);
  const raw=String(value??'').trim();
  const iso=raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if(iso){const parsed=new Date(`${iso[1]}T00:00:00Z`);return Number.isNaN(parsed.getTime())?null:iso[1];}
  const parsed=new Date(raw);
  return Number.isNaN(parsed.getTime())?null:parsed.toISOString().slice(0,10);
}

export async function ensureRegularInterestSchedules(tenant:string, through:string) {
  const throughDate=dateOnly(through);
  if(!throughDate)return;
  const loans=await pool.query(`SELECT l.id,l.borrower_id,l.start_date,l.interest_rate_percent,l.principal_amount,l.status,l.disbursed_at
    FROM loans l WHERE l.client_id=$1 AND l.request_type='regular' AND l.status IN ('approved','active','overdue')`,[tenant]);
  for(const loan of loans.rows){
    const latest=await pool.query(`SELECT installment_number,due_date FROM loan_schedules WHERE client_id=$1 AND loan_id=$2 ORDER BY installment_number DESC LIMIT 1`,[tenant,loan.id]);
    let installment=Number(latest.rows[0]?.installment_number||0);
    const anchor=dateOnly(latest.rows[0]?.due_date??loan.start_date??loan.disbursed_at);
    if(!anchor||!Number.isInteger(installment)||installment<0)continue;
    let due=new Date(`${anchor}T00:00:00Z`);
    const limit=new Date(`${throughDate}T00:00:00Z`);
    while(installment<600){
      const next=new Date(due);const day=next.getUTCDate();next.setUTCDate(1);next.setUTCMonth(next.getUTCMonth()+1);const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();next.setUTCDate(Math.min(day,last));if(Number.isNaN(next.getTime())||next>limit)break;
      const dueDate=next.toISOString().slice(0,10);
      const balance=await pool.query(`SELECT COALESCE(SUM(principal_debit-principal_credit),0) AS principal FROM loan_ledger WHERE client_id=$1 AND loan_id=$2 AND event_date<$3`,[tenant,loan.id,dueDate]);
      const ledgerPrincipal=Math.max(0,Number(balance.rows[0].principal));
      const principal=ledgerPrincipal>0?ledgerPrincipal:loan.status==='approved'?Number(loan.principal_amount):0;
      if(principal<=0)break;
      const interest=Number((principal*Number(loan.interest_rate_percent)/100).toFixed(2));
      const saved=await pool.query(`INSERT INTO loan_schedules (client_id,loan_id,installment_number,due_date,principal_due,interest_due) VALUES ($1,$2,$3,$4,0,$5) ON CONFLICT (loan_id,installment_number) DO NOTHING RETURNING id`,[tenant,loan.id,installment+1,dueDate,interest]);
      if(saved.rowCount){
        await pool.query(`INSERT INTO collection_tasks (client_id,borrower_id,loan_id,schedule_id,due_date) VALUES ($1,$2,$3,$4,$5)`,[tenant,loan.borrower_id,loan.id,saved.rows[0].id,dueDate]);
        await pool.query(`INSERT INTO loan_ledger (client_id,loan_id,event_type,interest_debit,event_date,description) VALUES ($1,$2,'interest_accrued',$3,$4,'Monthly interest on outstanding principal')`,[tenant,loan.id,interest,dueDate]);
      }
      due=next;installment++;
    }
  }
}
