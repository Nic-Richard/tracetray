import type {
  Account, AnalysisPermit, AnalysisRun, AskAnswer, AskTurn, AttentionProfile, BugCategory, Config,
  GroupMembers, Journey, MemberSort, PageGroups, PageSummary, RecentSession, Site, SiteDeleted,
  SitesResponse, Stats, Timeseries, UxTrends
} from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface ApiOptions {
  /** Empty for the same origin as the dashboard; the app passes https://tracetray.com. */
  baseUrl?: string;
  getToken: () => Promise<string | null>;
}

type Query = Record<string, string | number | null | undefined>;

export function createApi({ baseUrl = "", getToken }: ApiOptions) {
  async function request<T>(method: string, path: string, { query, body, siteKey }: { query?: Query; body?: unknown; siteKey?: string | null } = {}): Promise<T> {
    const params = new URLSearchParams();
    if (siteKey) params.set("site_key", siteKey);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
    }
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}${params.size ? `?${params}` : ""}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new ApiError("couldn't reach TraceTray, check your connection", 0);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(String(data.error || `request failed (${response.status})`), response.status, data);
    return data as T;
  }

  return {
    config: () => request<Config>("GET", "/api/config"),
    account: () => request<Account>("POST", "/api/account"),

    sites: () => request<SitesResponse>("GET", "/api/sites"),
    createSite: (name: string, url?: string) => request<SitesResponse & { site: Site }>("POST", "/api/sites", { body: { name, url } }),
    renameSite: (key: string, name: string) => request<SitesResponse & { site: Site }>("PATCH", `/api/sites/${encodeURIComponent(key)}`, { body: { name } }),
    deleteSite: (key: string) => request<SiteDeleted>("DELETE", `/api/sites/${encodeURIComponent(key)}`),

    pages: (siteKey: string) => request<PageSummary[]>("GET", "/api/pages", { siteKey }),
    resetPage: (siteKey: string, page: string) => request<{ deleted_sessions: number }>("POST", "/api/pages/reset", { siteKey, body: { page } }),
    stats: (siteKey: string, page: string) => request<Stats>("GET", "/api/stats", { siteKey, query: { page } }),
    timeseries: (siteKey: string, page?: string | null, days = 14) => request<Timeseries>("GET", "/api/sessions/timeseries", { siteKey, query: { page, days } }),
    uxTrends: (siteKey: string, page: string, runs = 10) => request<UxTrends>("GET", "/api/ux-trends", { siteKey, query: { page, runs } }),
    recentSessions: (siteKey: string, limit = 50) => request<RecentSession[]>("GET", "/api/sessions/recent", { siteKey, query: { limit } }),
    journey: (siteKey: string) => request<Journey>("GET", "/api/journey", { siteKey }),
    attention: (siteKey: string, page?: string | null) => request<AttentionProfile>("GET", "/api/attention-profile", { siteKey, query: { page } }),

    pageGroups: (siteKey: string) => request<PageGroups>("GET", "/api/page-groups", { siteKey }),
    savePageGroups: (siteKey: string, rules: string[]) => request<{ rules: string[]; regrouping: boolean }>("PUT", "/api/page-groups", { siteKey, body: { rules } }),
    groupMembers: (siteKey: string, page: string, options: { q?: string; sort?: MemberSort; offset?: number; limit?: number; days?: 7 | 30 | 90 | null } = {}) =>
      request<GroupMembers>("GET", "/api/pages/members", { siteKey, query: { page, ...options } }),

    analysisPermit: (siteKey: string, scope: "page" | "all", pageCount = 1) =>
      request<AnalysisPermit>("POST", "/api/analysis-permit", { siteKey, body: { scope, page_count: pageCount } }),
    runAnalysis: (siteKey: string, permitToken: string, page: string | null) =>
      request<AnalysisRun>("POST", "/api/run-analysis", { body: { site_key: siteKey, permit_token: permitToken, page } }),

    ask: (siteKey: string, question: string, history: AskTurn[]) => request<AskAnswer>("POST", "/api/ask", { siteKey, body: { question, history } }),

    reportBug: (siteKey: string, report: { category: BugCategory; description: string; dashboard_section?: string; page_url?: string }) =>
      request<{ id: string; created_at: string }>("POST", "/api/bug-reports", { siteKey, body: report }),
    checkout: (plan: "starter" | "pro") => request<{ url: string }>("POST", "/api/create-checkout-session", { body: { plan } }),
    billingPortal: () => request<{ url: string }>("POST", "/api/billing-portal")
  };
}

export type Api = ReturnType<typeof createApi>;
