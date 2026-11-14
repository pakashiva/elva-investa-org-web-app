import { config } from './config';

type ProviderResponse = {
  success?: boolean;
  message?: string;
  expiresIn?: number;
  requestId?: string;
};

export class OtpProviderError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'OtpProviderError';
    this.status = status;
  }
}

export function toOtpPhone(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  if (digits.startsWith('91')) {
    return digits;
  }
  return `91${digits}`;
}

export function maskMobileNumber(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  const local = digits.startsWith('91') ? digits.slice(2) : digits;
  if (local.length < 5) {
    return mobile.trim() || '—';
  }
  return `+91 ${local.slice(0, 5)}XXXXX`;
}

export async function callElvatechOtp(
  path: 'send' | 'resend' | 'verify',
  phone: string,
  otp?: string
): Promise<{ message: string; expiresIn: number; requestId?: string }> {
  const payload: Record<string, string> = {
    appId: config.otp.appId,
    apiKey: config.otp.apiKey,
    brandId: config.otp.brandId,
    phone,
  };
  if (path === 'verify') {
    if (!otp) {
      throw new Error('OTP is required.');
    }
    payload.otp = otp;
  }

  let response: Response;
  try {
    response = await fetch(`${config.otp.apiBaseUrl}/otp/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.error('[OTP] Provider request failed', {
      action: path,
      reason: timedOut ? 'timeout' : 'network_error',
    });
    throw new OtpProviderError(
      timedOut
        ? 'The OTP service did not respond in time. Please try again shortly.'
        : 'The OTP service could not be reached. Please try again shortly.'
    );
  }

  let body: ProviderResponse;
  try {
    body = (await response.json()) as ProviderResponse;
  } catch {
    throw new OtpProviderError('The OTP service returned an invalid response.');
  }

  if (!response.ok || body.success === false) {
    const message = body.message ?? `OTP request failed (${response.status}).`;
    throw new OtpProviderError(message, response.status >= 500 ? 502 : 400);
  }

  return {
    message: body.message ?? 'Success',
    expiresIn: body.expiresIn ?? 300,
    requestId: body.requestId,
  };
}
