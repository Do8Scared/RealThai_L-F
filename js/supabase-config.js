import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Browser-safe values only. Never put the service-role key or SMTP credentials here.
const supabaseUrl = 'https://tqrskuyxqzinfjzntclb.supabase.co';
const supabaseAnonKey = 'sb_publishable_YOH86gar47kwYYgux6T4xQ_-mFljq_E';

const hasPlaceholderValue = (value) => {
  if (!value) return true;
  return /replace[_-]?with|your[_-]supabase|YOUR_PROJECT_REF|YOUR_PUBLIC_ANON_KEY|example|anon[_-]?key|service[_-]?role/i.test(value);
};

const isSecretKey = (value) => /sb_secret_/i.test(value || '');

const hasInvalidCredentials = hasPlaceholderValue(supabaseUrl) || hasPlaceholderValue(supabaseAnonKey) || isSecretKey(supabaseAnonKey);

if (hasInvalidCredentials) {
  console.error('Supabase credentials are not configured or invalid. Configure js/supabase-config.js with your project credentials.');
}

export const supabase = hasInvalidCredentials ? null : createClient(supabaseUrl, supabaseAnonKey);