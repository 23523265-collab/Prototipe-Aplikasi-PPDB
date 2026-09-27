require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "SUPABASE_URL dan/atau SUPABASE_SERVICE_KEY belum diisi.\n" +
    "Buka file .env, isi dua variabel itu dengan nilai dari dashboard Supabase (Settings > API)."
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
