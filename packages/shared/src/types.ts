export type Plan = "starter" | "pro" | "ultra" | "enterprise" | "none";

/** null = no limit. Visits and Ask questions are per calendar month. */
export interface PlanLimits {
  name: string;
  visits: number | null;
  pages: number | null;
  sites: number | null;
  historyDays: number | null;
  askQuestions: number | null;
}

export interface Usage {
  month: string;
  visits: number;
  pages: number;
  sites: number;
  askQuestions: number;
}

export type GoalType = "click" | "form" | "page";

/** A click goal matches id, else href, else text (and tag when given); a form goal id, else name, else action; a page goal page. */
export interface GoalMatch {
  id?: string | null;
  href?: string | null;
  text?: string | null;
  tag?: string | null;
  name?: string | null;
  action?: string | null;
  page?: string;
}

export interface Goal {
  id: string;
  name: string;
  type: GoalType;
  match: GoalMatch;
  /** Pages or groups the goal counts on; empty means every page. */
  pages: string[];
  /** Share of visits the site owner is aiming for, 0–1. */
  target?: number | null;
  /** Applying the goal to past visits. */
  backfill: "queued" | "running" | "done" | "failed";
  reached_last_7_days?: number;
  reached_all_time?: number;
  /** The next round number (100, 1,000, 10,000…) the all-time count will pass. */
  next_milestone?: number | null;
  /** A milestone passed in the last 7 days. */
  milestone_this_week?: number | null;
}

export interface GoalList {
  /** Whether the plan includes form goals (Ultra). */
  form_goals?: boolean;
  goals: Goal[];
  main_goals: { page: string; goal: string }[];
  cap: number;
}

/** A form sent on the site recently, for picking a form goal. */
export interface FormSeen {
  id: string | null;
  name: string | null;
  action: string | null;
  sent: number;
  page: string;
}

export interface PathStep {
  page: string;
  /** Journeys that reached this step after every earlier one. */
  all: number;
  desktop: number;
  mobile: number;
}

export interface PathFunnel {
  id: string;
  name: string;
  days: number;
  steps: PathStep[];
}

export interface GoalInput {
  name: string;
  target?: number | null;
  type?: GoalType;
  match?: GoalMatch;
  pages?: string[];
}

export interface GoalRate extends Goal {
  main: boolean;
  visits: number;
  reached: number;
  rate: number | null;
}

export interface GoalRates {
  page: string;
  days: number;
  /** The page's main goal first. */
  goals: GoalRate[];
}

export interface PageChange {
  id: string;
  /** YYYY-MM-DD, counted from the start of the day (UTC). */
  day: string;
  note: string;
}

export interface ChangeMeasures {
  visits: number;
  visitsPerDay: number;
  engaged: number | null;
  timeOnPage: number | null;
  actionsPerVisit: number | null;
  scrollDepth: number | null;
  phoneShare: number | null;
}

export interface ComparisonGroupScope {
  ran_at: string;
  visits: number;
  from: string | null;
  to: string | null;
}

export interface ChangeComparison {
  /** False until a full day has passed since the change. */
  ready: boolean;
  days: number;
  before?: ChangeMeasures;
  after?: ChangeMeasures;
  groups?: { before: { group: string; share: number }[] | null; after: { group: string; share: number }[] | null; before_scope?: ComparisonGroupScope | null; after_scope?: ComparisonGroupScope | null };
  /** The page's main goal; "unclear" until 30 visits have reached it across both sides. */
  goal?: { id: string; name: string; before: number | null; after: number | null; reached: number; verdict: "better" | "worse" | "same" | "unclear" } | null;
}

export interface GoalWeek {
  /** Monday the week starts on, YYYY-MM-DD (UTC). */
  week: string;
  visits: number;
  reached: number;
  rate: number | null;
}

export interface GoalTrend {
  goal: Goal | null;
  weeks: GoalWeek[];
  /** The best full week with at least 30 visits. */
  best: GoalWeek | null;
}

/** A marked change after which the page's goal rate clearly rose. */
export interface Win {
  id: string;
  page: string;
  day: string;
  note: string;
  goal: string;
  before: number | null;
  after: number | null;
  days?: number;
  before_visits?: number;
  after_visits?: number;
}

export type EmailList = "weekly_summary" | "shift_alerts";

export interface EmailPrefs {
  weekly_summary: boolean;
  shift_alerts: boolean;
  /** False for an email the plan doesn't include. */
  available: Record<EmailList, boolean>;
}

export interface UsageResponse {
  plan: Plan;
  limits: PlanLimits | null;
  usage: Usage;
  subscription?: { status: string; interval: string | null; trial_end: string | null; current_period_end: string | null; cancel_at_period_end: boolean } | null;
  plans?: { id: Exclude<Plan, "none">; limits: PlanLimits }[];
}
export type Device = "desktop" | "mobile";

export interface Config {
  clerk_publishable_key: string;
  site_key: string | null;
}

export interface Site {
  key: string;
  name: string;
  url: string | null;
  domain: string | null;
  page_groups?: string[];
  created_at?: string;
}

export interface Account {
  site_key: string;
  sites: Site[];
  site_limit: number;
  plan: Plan;
  dashboard: string;
  snippet: string;
}

export interface SitesResponse {
  sites: Site[];
  limit: number;
}

export interface SiteDeleted extends SitesResponse {
  deleted: true;
  reset: boolean;
  deleted_sessions: number;
  deleted_analyses: number;
  deleted_reports: number;
}

export interface PageSummary {
  page: string;
  sessions: number;
  analysable: number;
  last_seen: number | null;
  pages_in_group?: number;
  /** Past the plan's page limit this month: still collected, not shown until an upgrade or next month. */
  locked?: boolean;
}

export interface ClusterMeans {
  [feature: string]: number | undefined;
}

export interface Cluster {
  id: number;
  label: string;
  n: number;
  feature_means: ClusterMeans;
  /** Visits in the group that reached each goal, by goal ID. */
  goal_hits?: Record<string, number>;
  /** The same group across analyses of the page; `new` when the last analysis didn't have it. */
  track?: { id: string; since: string; new?: boolean };
}

/** One analysis on fixed axes: x is how far down the page (0-1), y is time on the page in log10 seconds. */
export interface GroupSnapshot {
  /** Sampled visits as [x, y, group id]. */
  points: [number, number, number][];
  groups: { id: number; track: string | null; key: string | null; headline: string; share: number; centre: [number, number] | null }[];
}

export interface GroupHistoryFrame {
  ran_at: string;
  desktop: GroupSnapshot | null;
  mobile: GroupSnapshot | null;
}

export interface KruskalWallis {
  feature: string;
  /** Empty when every value of the feature was the same, so the test couldn't run. */
  H_statistic: number | null;
  p_value: number | null;
  /** Epsilon squared: how much the feature differs between groups, from 0 to 1. */
  effect_size?: number | null;
  significant: "yes" | "no";
}

export interface AnalysisFailure {
  message?: string;
  have?: number;
  needed?: number;
}

export interface Trait {
  feature: string;
  value: number;
  page_average: number;
  description: string;
}

export interface ClusterStory {
  key?: string;
  headline: string;
  body: string;
  /** What the group means, without the trait list or the goal (shown beside it). */
  summary?: string;
  suggestions: string[];
  traits?: Trait[];
  /** Against the page's goal; "above" and "below" only when the gap is unlikely to be chance. */
  goal?: { name: string; rate: number; average: number; reached: number; standing: "above" | "below" | "about" };
}

export interface Interpretation {
  source?: "rules";
  page_type?: string;
  site_summary?: string;
  cluster_stories?: Record<string, ClusterStory>;
  mobile_cluster_stories?: Record<string, ClusterStory>;
  top_suggestions?: string[];
  /** Suggestions with the numbers behind them; only for groups that clearly fall short of the goal. */
  advice?: { action: string; evidence: string; device: "desktop" | "mobile"; devices?: Device[]; group: string }[];
  /** Set for a device whose visitors didn't split into reliable groups: a description of them as one. */
  alike?: { desktop: string | null; mobile: string | null };
  data_note?: string;
  first_impression_note?: string | null;
  device_comparison?: string;
}

export interface ClickCount {
  text: string;
  tag: string;
  count: number;
  /** Where a link goes: its path on the site, another site's domain, or a scheme like mailto:. */
  href?: string | null;
  id?: string | null;
}

export interface GoalDriver {
  feature: string;
  direction: "higher" | "lower";
  /** The measure's median: visits above it reached the goal at rate_above, the rest at rate_below. */
  split: number;
  rate_above: number;
  rate_below: number;
}

export interface GoalModel {
  status: "ok" | "weak" | "too_few" | "no_variation";
  /** Cross-validated area under the ROC curve. */
  auc?: number;
  reached: number;
  missed: number;
  /** Seconds from the start of each visit that were compared; null when whole visits were. */
  window_s: number | null;
  too_quick?: number;
  drivers?: GoalDriver[];
}

export interface DeviceAnalysis {
  scope?: { from: string; to: string; window_days: number; limit: number; at_limit: boolean; excluded_detail: number; excluded_events: number } | null;
  session_count: number;
  k: number;
  silhouette_score?: number;
  /** Whether the groups are real: well separated and stable, real but overlapping, or not there at all. */
  structure?: "clear" | "some" | "none" | null;
  stability?: number;
  algorithm_agreement?: number | null;
  /** Visits on the device over the same stretch of time, including those that never interacted. */
  visit_count?: number | null;
  inactive_count?: number | null;
  inactive_goal_hits?: Record<string, number>;
  /** What separates visits that reached the main goal from those that didn't; only "ok" results are shown. */
  goal_model?: GoalModel | null;
  clusters: Cluster[];
  kruskal_wallis?: KruskalWallis[];
  k_rationale?: Record<string, unknown>;
  failure?: AnalysisFailure | null;
}

export interface AnalysisResult extends DeviceAnalysis {
  site_key: string;
  page: string;
  ran_at: string;
  /** The page's main goal when the analysis ran; groups are judged by it. */
  goal?: { id: string; name: string; position?: { desktop: number | null; mobile: number | null } | null };
  mobile?: DeviceAnalysis | null;
  click_summary?: ClickCount[];
  interpretation?: Interpretation;
  /** Runs saved before the archetype engine. */
  ai_interpretation?: Interpretation;
}

export interface Stats {
  total_sessions: number;
  analysable_sessions: number;
  site_analysable_sessions: number;
  desktop_sessions: number;
  mobile_sessions: number;
  last_analysis: AnalysisResult | null;
  plan: Plan;
  site_key: string;
  click_summary: ClickCount[];
}

export interface DayCount {
  date: string;
  desktop: number;
  mobile: number;
  engaged: number;
}

export interface Timeseries {
  series: DayCount[];
  total_sessions: number;
  engaged_sessions: number;
  engagement_rate: number;
}

/** One week of visits to a page. Measures are null for a week without visits. */
export interface UxTrendPoint {
  week_start: string;
  visits: number;
  engaged: number | null;
  time_on_page_ms: number | null;
  actions_per_visit: number | null;
  scroll_depth: number | null;
  phone_share: number | null;
}

export interface UxTrends {
  page: string;
  points: UxTrendPoint[];
}

export interface Journey {
  total_visitors: number;
  multi_page_visitors: number;
  single_page_visitors: number;
  top_entries: { page: string; count: number }[];
  top_exits: { page: string; count: number }[];
  top_transitions: { path: string; count: number }[];
  top_paths: { path: string; count: number }[];
}

export interface ZoneBreakdown {
  top: number;
  middle: number;
  bottom: number;
}

/** Depths from 0 (top) to 1 (bottom). */
export interface Reach {
  visits: number;
  p75: number;
  p50: number;
  p25: number;
  fold: number | null;
}

export interface PageShotInfo {
  width: number;
  page_height: number;
  shown_height: number;
  taken_at: string;
}

export interface AttentionProfile {
  samples?: Record<Device, { visits: number; from: string | null; to: string | null; limit: number }>;
  depth_profile: { band: number; depth: number; weight: number; share: number }[];
  total_moves: number;
  sessions: number;
  insight: string | null;
  zone_breakdown: ZoneBreakdown;
  reach?: Record<"desktop" | "mobile", Reach | null>;
  phone_reading?: { visits: number; bands: number[] } | null;
  shots?: Partial<Record<"desktop" | "mobile", PageShotInfo>>;
  first_impression: {
    speed_visits?: number;
    window_ms: number;
    velocity_delta_pct: number | null;
    early_pauses_per_min: number | null;
    rest_pauses_per_min: number | null;
    early_zone_breakdown: ZoneBreakdown | null;
  } | null;
}

export interface RecentSession {
  session_id: string;
  start_time: number;
  end_time: number | string;
  page: string;
  device_type: Device;
  summary?: {
    duration_ms?: number;
    total_events?: number;
    mouse_moves?: number;
    clicks?: number;
    scrolls?: number;
    taps?: number;
  };
}

export interface PageGroups {
  rules: string[];
  suggestions: { pattern: string; pages: number }[];
  regrouping: boolean;
}

export type MemberSort = "sessions" | "clicks" | "recent";

export interface GroupMember {
  path: string;
  sessions: number;
  desktop: number;
  mobile: number;
  clicks: number;
  last_day: string;
}

export interface GroupMembers {
  total: number;
  rows: GroupMember[];
  /** True when the plan only shows the busiest pages. */
  limited: boolean;
}

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AskAnswer {
  answer: string;
  lookups: string[];
}

export interface AnalysisPermit {
  permit_token: string;
  scope: "page" | "all";
  remaining_free_today: number;
}

export interface AnalysisRun {
  ok: true;
  result: AnalysisResult;
}

export type BugCategory = "bug" | "account" | "billing" | "suggestion" | "other";
export interface AccountDeletionStatus {
  state: "none" | "pending" | "retrying" | "complete";
  requested_at?: string;
  completed_at?: string | null;
}
