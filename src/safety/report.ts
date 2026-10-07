import { supabase } from "@/integrations/supabase/client";

/**
 * Reports (M7.1; spec 13.3): one door, `file_report()`, for a set, piece, comment, profile,
 * conversation or group. Back comes a reference number; the state is readable under
 * Settings > Your reports. A conversation report carries the last ten lines for the moderator.
 */
export type ReportTarget = "set" | "item" | "comment" | "profile" | "conversation" | "group";
export const REASONS = [
  "nudity",
  "harassment",
  "hate",
  "self_harm",
  "spam",
  "impersonation",
  "underage",
  "counterfeit",
  "copyright",
  "this_is_me",
  "intimate_image",
  "other",
] as const;
export type Reason = (typeof REASONS)[number];
export type MyReport = {
  request_ref: string;
  target_type: ReportTarget;
  reason: Reason;
  state: "open" | "reviewing" | "actioned" | "dismissed";
  created_at: string;
  resolved_at: string | null;
};

export async function fileReport(
  type: ReportTarget,
  id: string,
  reason: Reason,
  note: string,
): Promise<{ ref: string } | { error: "own" | "not_found" | "too_many" | "failed" }> {
  const { data, error } = await supabase.rpc("file_report", {
    p_type: type,
    p_id: id,
    p_reason: reason,
    p_note: note,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    return {
      error:
        code === "P0001"
          ? "own"
          : code === "P0002"
            ? "not_found"
            : code === "P0003"
              ? "too_many"
              : "failed",
    };
  }
  return { ref: String(data) };
}

export async function myReports(): Promise<MyReport[]> {
  const { data } = await supabase.rpc("my_reports");
  return (data ?? []) as MyReport[];
}
