import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Replace these with your real Supabase project values.
// Use the project URL and the public anon key from Supabase Dashboard > Project Settings > API.
const supabaseUrl = 'https://tqrskuyxqzinfjzntclb.supabase.co';
const supabaseAnonKey = 'sb_publishable_YOH86gar47kwYYgux6T4xQ_-mFljq_E';

const hasPlaceholderValue = (value) => {
  if (!value) return true;
  return /replace[_-]?with|your[_-]supabase|YOUR_PROJECT_REF|YOUR_PUBLIC_ANON_KEY|example|anon[_-]?key|service[_-]?role/i.test(value);
};

const isSecretKey = (value) => /sb_secret_/i.test(value || '');

const hasInvalidCredentials = hasPlaceholderValue(supabaseUrl) || hasPlaceholderValue(supabaseAnonKey) || isSecretKey(supabaseAnonKey);

if (hasInvalidCredentials) {
  console.warn('Supabase credentials are not configured for browser use yet. Falling back to demo mode.');
}

export const supabase = hasInvalidCredentials ? null : createClient(supabaseUrl, supabaseAnonKey);