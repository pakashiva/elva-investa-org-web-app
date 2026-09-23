import { createClient } from '@supabase/supabase-js';
import { getSupabasePublishableKey, getSupabaseUrl } from './env';

export const supabase = createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
