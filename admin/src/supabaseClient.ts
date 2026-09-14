import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;

export type SupabaseConnectionResult = {
  apiConnected: boolean;
  schemaReady: boolean;
  message: string;
};

export async function checkSupabaseConnection(): Promise<SupabaseConnectionResult> {
  if (!supabase || !url || !publishableKey) {
    return {
      apiConnected: false,
      schemaReady: false,
      message: "Supabase public configuration is not available in this build.",
    };
  }

  try {
    const health = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: publishableKey },
      cache: "no-store",
    });
    if (!health.ok) throw new Error("Supabase health check failed.");

    const { error } = await supabase.from("communities").select("id").limit(1);
    if (error) {
      const missingSchema =
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        /could not find the table|does not exist/i.test(error.message);
      const protectedSchema =
        error.code === "42501" || /permission denied/i.test(error.message);
      return {
        apiConnected: true,
        schemaReady: protectedSchema,
        message: protectedSchema
          ? "Kavach Supabase is connected. The Phase 2 schema is installed and requires sign-in."
          : missingSchema
            ? "Kavach Supabase is connected. Phase 2 database tables have not been installed."
            : "Kavach Supabase is reachable, but the application schema is not available to this client.",
      };
    }

    return {
      apiConnected: true,
      schemaReady: true,
      message: "Kavach Supabase and the application schema are connected.",
    };
  } catch {
    return {
      apiConnected: false,
      schemaReady: false,
      message:
        "Kavach Supabase could not be reached. Check the network and public configuration.",
    };
  }
}
