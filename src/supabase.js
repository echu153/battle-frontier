import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://jxbcuqwqtstxgmpiruuu.supabase.co'
const supabaseKey = 'sb_publishable_vlexKdF2oJrIIwMFEA81OA_1XyShoIt'

export const supabase = createClient(supabaseUrl, supabaseKey)