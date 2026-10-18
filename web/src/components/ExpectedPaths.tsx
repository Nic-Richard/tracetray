import { useState, type FormEvent } from "react";
import type React from "react";
import { pageLabel, pathStepStats, percent, type PathFunnel } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { useLoad } from "../lib/useLoad";

function Funnel({ path, onRemoved }: { path: PathFunnel; onRemoved: () => void }) {
  const api = useApi();
  const { siteKey } = useSite();
  const [busy, setBusy] = useState(false);
  const first = path.steps[0]?.all || 0;

  async function remove() {
    setBusy(true);
    try { await api.removePath(siteKey, path.id); onRemoved(); } finally { setBusy(false); }
  }

  return (
    <div className="funnel">
      <div className="funnel-head">
        <b>{path.name}</b>
        <button type="button" className="link-button danger" onClick={remove} disabled={busy}>Remove</button>
      </div>
      {first === 0 ? <p className="muted">No journeys have reached the first step in the last {path.days} days.</p> : (
        <ol className="funnel-steps">
          {path.steps.map((step, i) => {
            const stats = pathStepStats(path.steps, i);
            return (
              <li key={step.page}>
                <span className="funnel-label"><b>{pageLabel(step.page)}</b>
                  <small>{i === 0 ? "start" : stats.fromPrevious !== null ? `${percent(stats.fromPrevious)} of the step before` : "–"} · desktop {step.desktop.toLocaleString()}, phones {step.mobile.toLocaleString()}</small>
                </span>
                <span className="meter"><i style={{ width: `${(stats.fromStart || 0) * 100}%` }} /></span>
                <b className="num">{step.all.toLocaleString()}</b>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Funnels for the paths a site owner expects visitors to take. Part of Ultra. */
export default function ExpectedPaths() {
  const api = useApi();
  const { siteKey, pages } = useSite();
  const list = useLoad(() => api.paths(siteKey, 30), [api, siteKey]);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<string[]>(["", ""]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (list.error && /part of Ultra/.test(list.error)) {
    return (
      <section className="panel">
        <div className="panel-head"><h2>Funnels</h2><div className="end"><span className="ask-note">Ultra</span></div></div>
        <div className="panel-body setup-copy"><p>Pick the pages you expect visitors to go through, like a product page, then the cart, then checkout, and see how many get through each step and where they drop off. <a href="/pricing">Included with Ultra</a>.</p></div>
      </section>
    );
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await api.addPath(siteKey, { name, steps: steps.filter(Boolean) });
      setName(""); setSteps(["", ""]);
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The funnel wasn't saved");
    } finally {
      setSaving(false);
    }
  }

  const paths = list.data?.paths || [];
  const full = list.data ? paths.length >= list.data.cap : false;
  return (
    <section className="panel" style={{ "--fill": "var(--d6)" } as React.CSSProperties}>
      <div className="panel-head"><h2>Funnels</h2><div className="end"><span className="ask-note">Journeys in the last 30 days</span></div></div>
      <div className="panel-body setup-copy">
        <p>Pick the pages you expect visitors to go through, in order. Each step shows how many journeys got that far; other pages visited along the way don't count against them.</p>
        {list.error && <p className="form-error">{list.error}</p>}
        {!list.data && !list.error && <p className="muted">Counting journeys…</p>}
        {paths.map(path => <Funnel key={path.id} path={path} onRemoved={list.reload} />)}
        {list.data && !full && (
          <form className="path-form" onSubmit={add}>
            <input value={name} onChange={event => setName(event.target.value)} placeholder="Funnel name, like Buying a tent" aria-label="Funnel name" maxLength={60} />
            <ol>
              {steps.map((step, i) => (
                <li key={i}>
                  <select value={step} onChange={event => setSteps(steps.map((s, j) => j === i ? event.target.value : s))} aria-label={`Step ${i + 1}`}>
                    <option value="">Choose step {i + 1}</option>
                    {(pages || []).map(p => <option key={p.page} value={p.page}>{pageLabel(p.page)}</option>)}
                  </select>
                  {steps.length > 2 && <button type="button" className="link-button danger" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>Remove</button>}
                </li>
              ))}
            </ol>
            <div className="site-actions">
              {steps.length < 6 && <button type="button" className="btn" onClick={() => setSteps([...steps, ""])}>Add a step</button>}
              <button type="submit" className="btn primary" disabled={saving || !name.trim() || steps.filter(Boolean).length < 2}>{saving ? "Saving…" : "Save funnel"}</button>
            </div>
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
      </div>
    </section>
  );
}
