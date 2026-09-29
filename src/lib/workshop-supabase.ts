import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

export const workshopSupabase = createClient(supabaseUrl, supabaseAnonKey);

/*
 * Workshop REGISTRATIONS moved to Neon/Prisma (see src/features/workshop/).
 *
 * `workshop_config` and its reader have now followed. The row held the zoom
 * link, the WhatsApp link, and a webinar date, time and countdown target —
 * hand-edited, outside the audit log, and a second source of truth for "when
 * is the workshop" that drifted from the actual schedule. It showed the wrong
 * date in the hero and told the chatbot about a webinar that was not happening.
 *
 * Replaced by (plan 163 phase 3c):
 *   zoom_link         -> PlatformConfig `workshop.zoom_link`
 *   whatsapp_link     -> PlatformConfig `workshop.whatsapp_link`
 *   webinar_date      -> WorkshopEvent.date
 *   webinar_time      -> WorkshopEvent.timeLabel
 *   webinar_target_utc-> derived, `eventStartMs(event)`
 *
 * The Supabase ROW still exists and is deliberately left in place until
 * production confirms the replacements work. Nothing reads it.
 *
 * Everything below — the client and the cohort-application readers — is a
 * separate concern and stays.
 */

export type CohortRegion = "us" | "india";

export interface CohortApplicationRow {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  linkedin_url: string;
  education_level: string;
  total_experience: string;
  ai_ml_experience: string;
  current_title_company: string;
  industry: string;
  primary_languages_tools: string;
  why_interested: string;
  what_to_achieve: string;
  target_role: string;
  commit_hours: boolean;
  attend_sessions: boolean;
  understand_pre_call: boolean;
  ready_for_challenge: boolean;
  preferred_start_window: string;
  status: string;
  // region-specific
  visa_category?: string | null; // US table
  based_in_usa?: boolean | null; // US table
  originated_in_india?: boolean | null; // India table
}

/**
 * All AI Cohort applications for a region (admin view).
 * US → `cohort_applications`, India → `cohort_applications_india`.
 * Returns [] on any error.
 */
export async function getCohortApplications(
  region: CohortRegion,
): Promise<CohortApplicationRow[]> {
  const table =
    region === "india" ? "cohort_applications_india" : "cohort_applications";
  const { data, error } = await workshopSupabase
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error || !data) return [];
  return data as CohortApplicationRow[];
}
