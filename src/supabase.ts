import { createClient } from '@supabase/supabase-js'

// A publishable key is intended to be bundled in a web/desktop client.
// Data and game assets remain on the MJ's local server.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://tgpgqkjjlfuofonejmse.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_B1VJJ0QUceDgNJVZ9Xa2ww_ChtgvPJt'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

