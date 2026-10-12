// Public config. The anon key is public by design: it only identifies the project, and every
// ops-api action checks the signed-in staff member's own session. Never put a service key,
// a shared x-api-key or any other secret in this repo; the site is served publicly.
window.QB_CONFIG = {
  supabaseUrl: 'https://kevgrhcjxspbxgovpmfl.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtldmdyaGNqeHNwYnhnb3ZwbWZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTQxMDUsImV4cCI6MjA4NzkzMDEwNX0.lPUEvx8u98WL86PcMNv8yfLnd6OQKzTUOCsRewfQiZc',
  company: {
    name: 'SecureWorks Group',
    legalName: 'SecureWorks Group Pty Ltd',
    abn: '64 689 223 416',
    phone: '0489 267 774'
  }
};
