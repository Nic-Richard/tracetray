export type Plan = "starter" | "pro" | "none";
export type Mode = "beta" | "production";
export type Device = "desktop" | "mobile";

export interface Config {
  clerk_publishable_key: string;
  site_key: string | null;
  mode: Mode;
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
}

export interface ClusterMeans {
  [feature: string]: number | undefined;
}

export interface Cluster {
  id: number;
  label: string;
  n: number;
  feature_means: ClusterMeans;
}

export interface KruskalWallis {
  feature: string;
  H_statistic: number;
  p_value: number;
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
  suggestions: string[];
  traits?: Trait[];
}

export interface Interpretation {
  source?: "rules";
  page_type?: string;
  site_summary?: string;
  cluster_stories?: Record<string, ClusterStory>;
  mobile_cluster_stories?: Record<string, ClusterStory>;
  top_suggestions?: string[];
  data_note?: string;
  first_impression_note?: string;
  device_comparison?: string;
}

export interface ClickCount {
  text: string;
  tag: string;
  count: number;
}

export interface DeviceAnalysis {
  session_count: number;
  k: number;
  silhouette_score?: number;
  clusters: Cluster[];
  kruskal_wallis?: KruskalWallis[];
  k_rationale?: Record<string, unknown>;
  failure?: AnalysisFailure | null;
}

export interface AnalysisResult extends DeviceAnalysis {
  site_key: string;
  page: string;
  ran_at: string;
  algorithm_agreement?: number;
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

export interface UxTrendPoint {
  ran_at: string;
  session_count: number;
  hesitation_ms: number | null;
  reading_pauses: number | null;
  scroll_depth: number | null;
  ctr: number | null;
  top_click_text: string | null;
}

export interface UxTrends {
  page: string;
  points: UxTrendPoint[];
  has_ctr_history: boolean;
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

export interface AttentionProfile {
  depth_profile: { band: number; depth: number; weight: number; count: number }[];
  total_moves: number;
  sessions: number;
  insight: string | null;
  zone_breakdown: ZoneBreakdown;
  first_impression: {
    window_ms: number;
    velocity_delta_pct: number | null;
    early_pause_count: number;
    rest_pause_count: number;
    early_zone_breakdown: ZoneBreakdown;
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
