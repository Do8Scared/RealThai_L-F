import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Replace these with your real Supabase project values.
// Use the project URL and the public anon key from Supabase Dashboard > Project Settings > API.
const supabaseUrl = 'SUPABASE_URL';
const supabaseAnonKey = 'SUPABASE_ANON_KEY';

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