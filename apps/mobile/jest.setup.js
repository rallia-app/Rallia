process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.EXPO_PUBLIC_BACKBLAZE_KEY_ID = '';
process.env.EXPO_PUBLIC_BACKBLAZE_APPLICATION_KEY = '';
process.env.EXPO_PUBLIC_BACKBLAZE_BUCKET_ID = '';

global.fetch = jest.fn();
