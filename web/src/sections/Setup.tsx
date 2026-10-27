import { useEffect, useState, type FormEvent } from "react";
import { EMAILS, PLAN_NAMES, usageMeter, pageLabel, type EmailList, type PageGroups, type Site } from "@tracetray/shared";
import type React from "react";
import { useLoad } from "../lib/useLoad";
import { useApi } from "../api";
import { useSite } from "../state/site";
import GoalsPanel from "../components/GoalsPanel";

// Lightly coloured copy of the snippet; the plain text is what gets copied.
function SnippetCode({ origin, siteKey }: { origin: string; siteKey: string }) {
  const tag = (name: string, close = false) => <><span className="punct">{close ? "</" : "<"}</span><span className="tag-name">{name}</span>{close && <span className="punct">&gt;</span>}</>;
  return (
    <pre className="code" id="snippet-code">
      {tag("script")}<span className="punct">&gt;</span>{"\n  window."}<span className="prop">TraceTray</span>{" = { "}<span className="prop">endpoint</span>{": "}<span className="str">"{origin}/collect"</span>{", "}<span className="prop">key</span>{": "}<span className="str">"{siteKey}"</span>{" };\n"}{tag("script", true)}{"\n"}
      {tag("script")}{" "}<span className="prop">src</span><span className="punct">=</span><span className="str">"{origin}/client/tracker.js"</span><span className="punct">&gt;</span>{tag("script", true)}
    </pre>
  );
}

function snippetFor(siteKey: string): string {
  const origin = window.location.origin;
  return `<script>\n  window.TraceTray = { endpoint: "${origin}/collect", key: "${siteKey}" };\n</script>\n<script src="${origin}/client/tracker.js"></script>`;
}

function Snippet() {
  const { site } = useSite();
  const [copied, setCopied] = useState(false);
  const code = snippetFor(site.key);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const range = document.createRange();
      const node = document.getElementById("snippet-code");
      if (node) { range.selectNodeContents(node); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); }
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Add TraceTray to {site.name}</h2>
        <div className="end"><button type="button" className="btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
      </div>
      <div className="panel-body setup-copy">
        <p>Paste these lines just before the closing <code>&lt;/body&gt;</code> tag on every page you want to track.</p>
        <SnippetCode origin={window.location.origin} siteKey={site.key} />
        <p>Use this key on this website only. Add another website below to get a separate key.</p>
        <p className="muted">TraceTray records cursor movement, clicks, taps, scrolling and pauses in scrolling. It never records keystrokes or form contents.</p>
      </div>
    </section>
  );
}

function SiteRow({ item, current, onChanged }: { item: Site; current: boolean; onChanged: (sites: Site[], removedKey?: string) => void }) {
  const api = useApi();
  const [mode, setMode] = useState<"view" | "rename" | "remove">("view");
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function rename(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await api.renameSite(item.key, name.trim());
      onChanged(result.sites);
      setMode("view");
    } catch (err) { setError(err instanceof Error ? err.message : "the name wasn't saved"); }
    setBusy(false);
  }

  async function remove() {
    setBusy(true); setError("");
    try {
      const result = await api.deleteSite(item.key);
      onChanged(result.sites, item.key);
    } catch (err) { setError(err instanceof Error ? err.message : "the website wasn't removed"); setBusy(false); }
  }

  return (
    <li className="site-row">
      {mode === "rename" ? (
        <form className="inline-form" onSubmit={rename}>
          <input value={name} onChange={event => setName(event.target.value)} maxLength={80} aria-label="Website name" autoFocus />
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>Save</button>
          <button type="button" className="btn" onClick={() => { setMode("view"); setName(item.name); }}>Cancel</button>
        </form>
      ) : (
        <div className="site-line">
          <div>
            <b>{item.name}{current && <span className="tag">Showing</span>}</b>
            <small>{item.domain || item.url || "Not tracking yet"}, key {item.key}</small>
          </div>
          {mode === "view" && (
            <div className="site-actions">
              <button type="button" className="link-button" onClick={() => setMode("rename")}>Rename</button>
              <button type="button" className="link-button danger" onClick={() => setMode("remove")}>Remove</button>
            </div>
          )}
        </div>
      )}
      {mode === "remove" && (
        <div className="confirm">
          <p>Removing {item.name} deletes all of its visits, analyses and reports. This can't be undone.</p>
          <div className="site-actions">
            <button type="button" className="btn danger" onClick={remove} disabled={busy}>{busy ? "Removing…" : "Remove and delete its data"}</button>
            <button type="button" className="btn" onClick={() => setMode("view")} disabled={busy}>Keep it</button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error.charAt(0).toUpperCase() + error.slice(1)}.</p>}
    </li>
  );
}

function Websites() {
  const api = useApi();
  const { sites, siteKey, setSites, setSite, account } = useSite();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const atLimit = sites.length >= account.site_limit;

  function changed(next: Site[], removedKey?: string) {
    setSites(next);
    if (removedKey === siteKey && next[0]) setSite(next[0].key);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await api.createSite(name.trim(), url.trim() || undefined);
      setSites(result.sites);
      setSite(result.site.key);
      setName(""); setUrl("");
    } catch (err) { setError(err instanceof Error ? err.message : "the website wasn't added"); }
    setBusy(false);
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Websites</h2><div className="end"><span className="ask-note">{sites.length > account.site_limit ? `${sites.length} websites, over your plan's ${account.site_limit}` : `${sites.length} of ${account.site_limit}`}</span></div></div>
      <ul className="site-list">
        {sites.map(item => <SiteRow key={item.key} item={item} current={item.key === siteKey} onChanged={changed} />)}
      </ul>
      {atLimit ? (
        <p className="panel-foot">Your plan allows {account.site_limit} website{account.site_limit === 1 ? "" : "s"}. Remove one to add another.</p>
      ) : (
        <form className="panel-foot inline-form" onSubmit={add}>
          <input value={name} onChange={event => setName(event.target.value)} placeholder="Website name" maxLength={80} aria-label="New website name" />
          <input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com (optional)" maxLength={500} aria-label="New website address" />
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add website"}</button>
          {error && <p className="form-error">{error.charAt(0).toUpperCase() + error.slice(1)}.</p>}
        </form>
      )}
    </section>
  );
}

function PageGroupRules() {
  const api = useApi();
  const { siteKey, site, reloadPages } = useSite();
  const [state, setState] = useState<PageGroups | null>(null);
  const [rules, setRules] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    api.pageGroups(siteKey)
      .then(result => { if (!cancelled) { setState(result); setRules(result.rules); } })
      .catch(err => { if (!cancelled) setMessage({ text: err.message, error: true }); });
    return () => { cancelled = true; };
  }, [api, siteKey]);

  // Regrouping runs on the server after saving; poll until it finishes so the page tree can refresh.
  useEffect(() => {
    if (!state?.regrouping) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.pageGroups(siteKey);
        if (!next.regrouping) {
          setState(next);
          setMessage({ text: "Pages are regrouped." });
          reloadPages();
        }
      } catch { /* try again on the next tick */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [api, siteKey, state?.regrouping, reloadPages]);

  function addRule(pattern: string) {
    const value = pattern.trim().replace(/\/+$/, "");
    if (!value) return;
    if (!value.startsWith("/") || !value.includes("/:")) {
      setMessage({ text: "Patterns start with / and use :name for the part that changes, like /products/:product.", error: true });
      return;
    }
    if (!rules.includes(value)) setRules([...rules, value]);
    setDraft("");
    setMessage(null);
  }

  async function save() {
    setSaving(true); setMessage(null);
    try {
      await api.savePageGroups(siteKey, rules);
      setState(current => current && { ...current, rules, regrouping: true, suggestions: current.suggestions.filter(s => !rules.includes(s.pattern)) });
      setMessage({ text: "Saved. Regrouping stored visits…" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "the patterns weren't saved", error: true });
    }
    setSaving(false);
  }

  const dirty = state && (rules.length !== state.rules.length || rules.some((r, i) => r !== state.rules[i]));
  const suggestions = (state?.suggestions || []).filter(s => !rules.includes(s.pattern));

  return (
    <section className="panel">
      <div className="panel-head"><h2>Page groups</h2></div>
      <div className="panel-body setup-copy">
        <p>Pages that share a pattern count as one page, like every product on a shop. Addresses with ids in them are grouped automatically; add patterns for the rest, using <code>:name</code> for the part that changes.</p>
        {!state && !message && <p className="muted">Loading…</p>}
        {state && (
          <>
            <ul className="rule-list">
              {rules.length === 0 && <li className="muted">No patterns yet for {site.name}.</li>}
              {rules.map(rule => (
                <li key={rule}>
                  <span><b>{pageLabel(rule)}</b><code>{rule}</code></span>
                  <button type="button" className="link-button danger" onClick={() => setRules(rules.filter(r => r !== rule))}>Remove</button>
                </li>
              ))}
            </ul>
            <form className="inline-form" onSubmit={event => { event.preventDefault(); addRule(draft); }}>
              <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="/products/:product" aria-label="New pattern" maxLength={300} />
              <button type="submit" className="btn" disabled={!draft.trim()}>Add pattern</button>
            </form>
            {suggestions.length > 0 && (
              <div className="suggestions">
                <p className="muted">Suggested from your traffic</p>
                <ul className="rule-list">
                  {suggestions.map(s => (
                    <li key={s.pattern}>
                      <span><b>{pageLabel(s.pattern)}</b><code>{s.pattern}</code><small>{s.pages.toLocaleString()} pages</small></span>
                      <button type="button" className="link-button" onClick={() => addRule(s.pattern)}>Add</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {message && <p className={message.error ? "form-error" : "muted"} role="status">{message.text}</p>}
      </div>
      {state && (
        <div className="panel-foot setup-save">
          <span>{state.regrouping ? "Regrouping stored visits. This can take a minute on busy sites." : dirty ? "Saving moves existing visits into the new groups." : "Patterns are saved."}</span>
          <button type="button" className="btn primary" onClick={save} disabled={!dirty || saving || state.regrouping}>{saving ? "Saving…" : "Save patterns"}</button>
        </div>
      )}
    </section>
  );
}

function UsageMeter({ label, used, limit, accent }: { label: string; used: number; limit: number | null; accent: string }) {
  const { share, over } = usageMeter(used, limit);
  return (
    <div className="usage-row" style={{ "--fill": over ? "var(--danger)" : accent } as React.CSSProperties}>
      <span>{label}</span>
      <div className="meter">{share !== null && <i style={{ width: `${Math.max(share * 100, used ? 1.5 : 0)}%` }} />}</div>
      <b className="num">{used.toLocaleString()}<small>{limit !== null ? ` of ${limit.toLocaleString()}` : " no limit"}</small></b>
    </div>
  );
}

function Plan() {
  const api = useApi();
  const { account } = useSite();
  const usage = useLoad(() => api.usage(), [api]);
  const name = PLAN_NAMES[usage.data?.plan ?? account.plan];
  const limits = usage.data?.limits;
  const used = usage.data?.usage;
  const month = used ? new Date(`${used.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", timeZone: "UTC" }) : "";
  return (
    <section className="panel">
      <div className="panel-head"><h2>Plan and usage</h2>{month && <div className="end"><span className="ask-note">{month} so far</span></div>}</div>
      <div className="panel-body setup-copy">
        <p>{(usage.data?.plan ?? account.plan) === "none" ? "No active plan. Choose one under Manage billing to keep collecting." : `You're on ${name}.`}</p>
        {usage.error && <p className="page-status error" style={{ padding: 0 }}>{usage.error}</p>}
        {used && (!limits ? (
          <div className="usage-figures">
            <div style={{ "--fill": "var(--d1)" } as React.CSSProperties}><b className="num">{used.visits.toLocaleString()}</b><span>visits</span></div>
            <div style={{ "--fill": "var(--d2)" } as React.CSSProperties}><b className="num">{used.pages.toLocaleString()}</b><span>pages tracked</span></div>
            <div style={{ "--fill": "var(--d3)" } as React.CSSProperties}><b className="num">{used.sites.toLocaleString()}</b><span>{used.sites === 1 ? "website" : "websites"}</span></div>
            <div style={{ "--fill": "var(--d5)" } as React.CSSProperties}><b className="num">{used.askQuestions.toLocaleString()}</b><span>Ask questions</span></div>
          </div>
        ) : (
          <div className="usage">
            <UsageMeter label="Visits" used={used.visits} limit={limits.visits} accent="var(--d1)" />
            <UsageMeter label="Pages tracked" used={used.pages} limit={limits.pages} accent="var(--d2)" />
            <UsageMeter label="Websites" used={used.sites} limit={limits.sites} accent="var(--d3)" />
            <UsageMeter label="Ask questions" used={used.askQuestions} limit={limits.askQuestions} accent="var(--d5)" />
          </div>
        ))}
        {used && limits && (
          (limits.pages && used.pages > limits.pages) || (limits.visits && used.visits > limits.visits)
        ) && (
          <p className="note">Over a limit, TraceTray keeps collecting: extra pages are locked and extra visits keep their summary only. Both reset on the 1st, or right away on a bigger plan.</p>
        )}
        <p><a className="link-button" href="/billing">Manage billing</a></p>
      </div>
    </section>
  );
}

function Export() {
  const api = useApi();
  const { siteKey } = useSite();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function download(kind: "daily" | "groups") {
    setBusy(kind);
    setError("");
    try {
      const { blob, filename } = await api.exportCsv(siteKey, kind, kind === "daily" ? days : undefined);
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: filename });
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export didn't download");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Export</h2><div className="end"><span className="ask-note">Pro and Ultra</span></div></div>
      <div className="panel-body setup-copy exports">
        <p>Download this website's data as CSV, for a spreadsheet or your own reports.</p>
        <div className="export-row">
          <div><b>Daily visits per page</b><small>Visits, desktop, phones and clicks for every address, day by day.</small></div>
          <div className="seg" role="group" aria-label="Days">
            {[30, 90, 365].map(value => <button key={value} type="button" className={days === value ? "on" : ""} onClick={() => setDays(value)}>{value === 365 ? "1 year" : `${value} days`}</button>)}
          </div>
          <button type="button" className="btn" onClick={() => download("daily")} disabled={busy !== null}>{busy === "daily" ? "Preparing…" : "Download"}</button>
        </div>
        <div className="export-row">
          <div><b>Visitor groups</b><small>Each page's groups from its latest analysis, on desktop and phones.</small></div>
          <span />
          <button type="button" className="btn" onClick={() => download("groups")} disabled={busy !== null}>{busy === "groups" ? "Preparing…" : "Download"}</button>
        </div>
        {error && <p className="page-status error" style={{ padding: 0 }}>{error}</p>}
      </div>
    </section>
  );
}

function Emails() {
  const api = useApi();
  const prefs = useLoad(() => api.emailPrefs(), [api]);
  const [saving, setSaving] = useState<EmailList | null>(null);
  const [error, setError] = useState("");

  async function toggle(list: EmailList) {
    if (!prefs.data) return;
    setSaving(list);
    setError("");
    try {
      await api.setEmailPrefs({ [list]: !prefs.data[list] });
      prefs.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Emails</h2></div>
      <div className="panel-body setup-copy emails">
        {EMAILS.map(email => {
          const available = prefs.data?.available[email.list] !== false;
          return (
            <label key={email.list} className="toggle-row">
              <input type="checkbox" checked={prefs.data?.[email.list] ?? false} onChange={() => toggle(email.list)} disabled={!prefs.data || saving !== null || !available} />
              <span><b>{email.name}</b><small>{email.about}{!available && " Included with Pro and Ultra."}</small></span>
            </label>
          );
        })}
        {error && <p className="page-status error" style={{ padding: 0 }}>{error}</p>}
      </div>
    </section>
  );
}

export default function Setup() {
  return (
    <div className="content setup">
      <div className="section-head">
        <h1 className="section-title">Setup</h1>
        <p className="tab-intro">Add TraceTray to your site, set goals, group similar pages, and manage your websites and plan.</p>
      </div>
      <Snippet />
      <GoalsPanel />
      <PageGroupRules />
      <Websites />
      <Plan />
      <Emails />
      <Export />
      <nav className="site-footer" aria-label="TraceTray">
        <a href="/">TraceTray home</a>
        <a href="/pricing">Pricing</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/app/delete-account">Delete account</a>
      </nav>
    </div>
  );
}
