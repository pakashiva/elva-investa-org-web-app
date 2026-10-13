import { api, getAdminToken } from '../lib/api';

export type BorrowOverview = {
  stats: { borrowers: number; pending: number; active: number; outstanding: string | number; due_today: string | number; collected_today: string | number; pending_collections: string | number; overdue_total: string | number };
  borrowers: { id: string; name: string; code: string; mobile: string; status: string; created_at: string; loan_count: number }[];
  loans: { id: string; loan_number: string; status: string; principal_amount: string | number; interest_rate_percent: string | number; start_date: string | null; maturity_date: string | null; created_at: string; borrower_name: string; borrower_code: string; product_name: string; balance: string | number; write_off_allowed: boolean; closure_mode: string }[];
  products: { id: string; name: string; interest_model: string; interest_rate_percent: string | number; interest_rate_period: string; repayment_model: string; repayment_frequency: string; approval_workflow: string; payment_allocation: string; grace_period_days: number; overdue_rule: string; overdue_charge: string | number; part_payments_allowed: boolean; advance_payment_treatment: string; receipt_required: boolean; write_off_allowed: boolean; closure_mode: string; rounding_scale: number; required_documents: string[] }[];
  collections: { id: string; due_date: string; status: string; loan_number: string; borrower_name: string; borrower_code: string; due_amount: string | number }[];
  eligibleCustomers: { id: string; full_name: string; customer_code: string; mobile_number: string }[];
};

export type LoanDetail = {
  loan: { id:string; loan_number:string; status:string; principal_amount:string|number; interest_rate_percent:string|number; terms_snapshot:Record<string,unknown>; start_date:string|null; maturity_date:string|null; disbursed_at:string|null; closed_at:string|null; close_reason:string|null; borrower_name:string; borrower_code:string; mobile_number:string; aadhaar_number:string|null; pan_number:string|null; product_name:string; receipt_required:boolean; required_documents:string[]; balance:string|number };
  schedule: { id:string; installment_number:number; due_date:string; principal_due:string|number; interest_due:string|number; overdue_charge:string|number; amount_paid:string|number; status:string }[];
  ledger: { id:string; event_type:string; principal_debit:string|number; principal_credit:string|number; interest_debit:string|number; interest_credit:string|number; overdue_debit:string|number; overdue_credit:string|number; event_date:string; description:string; reference_type:string|null; reference_id:string|null; created_at:string }[];
  payments: { id:string; received_on:string; amount_received:string|number; principal_component:string|number; interest_component:string|number; overdue_component:string|number; unapplied_amount:string|number; reference_number:string|null; created_at:string }[];
};

export const getBorrowOverview = () => api<BorrowOverview>('/api/borrowing/overview');
export const getLoanDetail = (id:string) => api<LoanDetail>('/api/borrowing/loans/'+id);
export const addBorrower = (customerId: string) => api('/api/borrowing/borrowers/' + customerId, { method: 'POST', body: '{}' });
export const setBorrowerStatus = (id: string, status: string) => api('/api/borrowing/borrowers/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
export const createLoan = (input: { borrowerId: string; productId: string; principalAmount: number; installments: number; startDate: string }) => api('/api/borrowing/loans', { method: 'POST', body: JSON.stringify(input) });
export const decideLoan = (id: string, decision: 'approve' | 'reject') => api('/api/borrowing/loans/' + id + '/decision', { method: 'PATCH', body: JSON.stringify({ decision }) });
export const disburseLoan = (id: string) => api('/api/borrowing/loans/' + id + '/disburse', { method: 'POST', body: '{}' });
export const recordLoanPayment = (id: string, amount: number, referenceNumber?: string, receivedOn?:string) => api('/api/borrowing/loans/' + id + '/payments', { method: 'POST', body: JSON.stringify({ amount, referenceNumber, receivedOn }) });
export const closeLoan = (id: string, reason: string) => api('/api/borrowing/loans/' + id + '/close', { method: 'POST', body: JSON.stringify({ reason }) });
export const writeOffLoan = (id: string, reason: string) => api('/api/borrowing/loans/' + id + '/write-off', { method: 'POST', body: JSON.stringify({ reason }) });

export async function downloadLoanReport(){
  const headers=new Headers();const token=getAdminToken();if(token)headers.set('Authorization',`Bearer ${token}`);
  const response=await fetch('/api/borrowing/reports/loans.csv',{headers,credentials:'include'});
  if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error(payload.error||'Could not export borrowing report.');}
  const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='borrowing-loans.csv';link.click();URL.revokeObjectURL(url);
}

export async function downloadCollectionsReport(){
  const headers=new Headers();const token=getAdminToken();if(token)headers.set('Authorization',`Bearer ${token}`);
  const response=await fetch('/api/borrowing/reports/collections.csv',{headers,credentials:'include'});
  if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error(payload.error||'Could not export collections report.');}
  const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='borrowing-collections.csv';link.click();URL.revokeObjectURL(url);
}
