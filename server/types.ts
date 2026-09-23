import type { Request } from 'express';

export type UserRole = 'super_admin' | 'client_admin';

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  fullName: string;
  clientId: string | null;
};

export type AuthedRequest = Request & { auth: AuthUser };

export type CustomerRequest = Request & { customer: CustomerAuth };

export type CustomerAuth = {
  id: string;
  fullName: string;
  mobileNumber: string;
  emailAddress: string;
  customerCode: string;
  referralCode: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  mobileVerified: boolean;
};

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  client_id: string | null;
  full_name: string;
  is_active: boolean;
};
