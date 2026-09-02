import { Customer, FollowUpRecord } from '../types';

type ApiEnvelope<T> = {
  ok: boolean;
  code: number;
  message: string;
  data: T;
};

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const enabled = parseBoolean(import.meta.env.VITE_CUSTOMERS_API_ENABLED, false);
const readEnabled = parseBoolean(import.meta.env.VITE_CUSTOMERS_API_READ_ENABLED, false);
const verifyWritesEnabled = parseBoolean(import.meta.env.VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED, false);

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new Error(`客户服务响应异常（HTTP ${res.status}）`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message || `客户请求失败（HTTP ${res.status}）`));
  }
  return body as ApiEnvelope<T>;
};

export const customerService = {
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,
  shouldVerifyWrites: () => verifyWritesEnabled,

  listCustomers: async (): Promise<Customer[]> => {
    const res = await fetch('/api/customers', {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ customers: Customer[] }>(res);
    return Array.isArray(body.data.customers) ? body.data.customers : [];
  },

  getCustomer: async (customerId: string): Promise<Customer> => {
    const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ customer: Customer }>(res);
    return body.data.customer;
  },

  createCustomer: async (customer: Customer): Promise<Customer> => {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ customer })
    });
    const body = await parseJson<{ customer: Customer }>(res);
    return body.data.customer;
  },

  updateCustomer: async (customerId: string, updates: Partial<Customer>): Promise<Customer> => {
    const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ customer: updates })
    });
    const body = await parseJson<{ customer: Customer }>(res);
    return body.data.customer;
  },

  addFollowUp: async (customerId: string, record: FollowUpRecord): Promise<{ customer: Customer; record: FollowUpRecord }> => {
    const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ record })
    });
    const body = await parseJson<{ customer: Customer; record: FollowUpRecord }>(res);
    return body.data;
  }
};
