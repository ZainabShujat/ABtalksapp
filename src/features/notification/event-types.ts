export type NotificationPriority = "important" | "low";

export type EventTypeConfig = {
  key: string;
  label: string;
  priority: NotificationPriority;
  suppressionExempt: boolean;
  emailExempt: boolean;
  defaultEmailEnabled: boolean;
};

export const EVENT_TYPE_REGISTRY: Record<string, EventTypeConfig> = {
  "application.received": {
    key: "application.received",
    label: "New application received",
    priority: "important",
    suppressionExempt: true,
    emailExempt: false,
    defaultEmailEnabled: true,
  },
  "application.status_changed": {
    key: "application.status_changed",
    label: "Application status updated",
    priority: "important",
    suppressionExempt: true,
    emailExempt: false,
    defaultEmailEnabled: true,
  },
  "job.closed": {
    key: "job.closed",
    label: "Job listing closed",
    priority: "low",
    suppressionExempt: false,
    emailExempt: false,
    defaultEmailEnabled: false,
  },
  "job.reopened": {
    key: "job.reopened",
    label: "Job listing reopened",
    priority: "low",
    suppressionExempt: false,
    emailExempt: false,
    defaultEmailEnabled: false,
  },
  // T-251: profile.viewed is now the "a real recruiter opened your profile"
  // signal. priority: "important" opens the email path; defaultEmailEnabled
  // stays false so email is opt-in — the "selectively by email" from the
  // T-251 spec. In-app is always delivered (T-248 rule).
  "profile.viewed": {
    key: "profile.viewed",
    label: "Profile viewed by a recruiter",
    priority: "important",
    suppressionExempt: false,
    emailExempt: false,
    defaultEmailEnabled: false,
  },
  "assessment.assigned": {
    key: "assessment.assigned",
    label: "Assessment assigned",
    priority: "important",
    suppressionExempt: true,
    emailExempt: false,
    defaultEmailEnabled: true,
  },
  "outreach.reply_received": {
    key: "outreach.reply_received",
    label: "Outreach reply received",
    priority: "important",
    suppressionExempt: true,
    emailExempt: false,
    defaultEmailEnabled: true,
  },
  // T-232: in-app only. "low" is what makes dispatch() skip email — the
  // outreach email itself is sent by the outreach feature, so a second one
  // here would reach the candidate twice.
  "outreach.message_received": {
    key: "outreach.message_received",
    label: "Message from a recruiter",
    priority: "low",
    suppressionExempt: true,
    emailExempt: false,
    defaultEmailEnabled: false,
  },
  "auth.password_reset": {
    key: "auth.password_reset",
    label: "Password reset",
    priority: "important",
    suppressionExempt: true,
    emailExempt: true,
    defaultEmailEnabled: true,
  },
  // T-250: candidate job alerts. The master alert toggle (JobAlert.enabled)
  // gates the fanout before dispatch runs; the T-248 preference row can
  // still turn email off separately, so suppressionExempt stays false.
  "job.alert.match": {
    key: "job.alert.match",
    label: "New job matches your alert",
    priority: "important",
    suppressionExempt: false,
    emailExempt: false,
    defaultEmailEnabled: true,
  },
  // T-249: the recruiter's own assessment finished. Priority "important"
  // opens the email path; the T-248 preference row still gates opt-in
  // per-recruiter. Suppression-exempt so a busy day of completions is
  // never quietly rolled up — every finish is one attention signal.
  "assessment.completed": {
    key: "assessment.completed",
    label: "Assessment completed",
    priority: "important",
    suppressionExempt: true,
    emailExempt: false,
    defaultEmailEnabled: true,
  },
  // T-249: admin-broadcast system notice targeted at one recruiter. The
  // emit site (broadcastRecruiterSystemNoticeAction) is gated by
  // requireAdmin(), so the notification path itself does not enforce
  // authorization — only surface. emailExempt is false because a system
  // issue that matters enough to broadcast is worth the email.
  "system.notice": {
    key: "system.notice",
    label: "System notice",
    priority: "important",
    suppressionExempt: true,
    emailExempt: false,
    defaultEmailEnabled: true,
  },
  // A recruiter moved this candidate to Shortlisted, Offer or Hired on
  // /hire/pipeline — sent to every candidate on the board, not only
  // applicants. Sent from pipeline-convergence/sync-application-status.ts.
  // Candidates can turn the email off in settings; in-app always lands.
  "pipeline.stage_reached": {
    key: "pipeline.stage_reached",
    label: "A recruiter moved you forward",
    priority: "important",
    suppressionExempt: true,
    emailExempt: false,
    defaultEmailEnabled: true,
  },
  // An admin changed something on this person's account from the
  // "Perform admin action" menu (reset, ready-for-interview, synergy grant,
  // restore, sign-out-everywhere, …). A service message about their own
  // account, so it always emails, like auth.password_reset.
  // Sent from features/notification/admin-action-notify.ts.
  "account.admin_update": {
    key: "account.admin_update",
    label: "Account update from ABTalks",
    priority: "important",
    suppressionExempt: true,
    emailExempt: true,
    defaultEmailEnabled: true,
  },
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_REGISTRY);

export function isValidEventType(
  type: string,
): type is keyof typeof EVENT_TYPE_REGISTRY {
  return type in EVENT_TYPE_REGISTRY;
}
