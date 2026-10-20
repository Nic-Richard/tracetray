import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { REPORT_CATEGORIES as CATEGORIES, reportError, type BugCategory } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";

export default function BugReport({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { siteKey } = useSite();
  const { pathname } = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState<BugCategory>("bug");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<{ sending?: boolean; sent?: boolean; error?: string }>({});

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const error = reportError(description);
    if (error) { setState({ error }); return; }
    setState({ sending: true });
    try {
      await api.reportBug(siteKey, { category, description: description.trim(), dashboard_section: pathname, page_url: window.location.href });
      setState({ sent: true });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : "The report wasn't sent." });
    }
  }

  return (
    <dialog ref={dialog} className="panel dialog" onClose={onClose} aria-labelledby="bug-title">
      <form method="dialog" onSubmit={state.sent ? undefined : submit}>
        <div className="panel-head"><h2 id="bug-title">Report a problem</h2></div>
        <div className="panel-body dialog-body">
          {state.sent ? <p>Thanks, the report was sent.</p> : (
            <>
              <label>What kind of problem?
                <select value={category} onChange={event => setCategory(event.target.value as BugCategory)}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label>What happened?
                <textarea rows={5} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What you were doing and what went wrong" />
              </label>
              <p className="muted">Your report and account context are saved by TraceTray and sent to its private staff channel on Discord. Avoid including passwords or other sensitive information.</p>
              {state.error && <p className="page-status error" style={{ padding: 0 }}>{state.error}</p>}
            </>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>{state.sent ? "Close" : "Cancel"}</button>
            {!state.sent && <button type="submit" className="btn primary" disabled={state.sending}>{state.sending ? "Sending…" : "Send report"}</button>}
          </div>
        </div>
      </form>
    </dialog>
  );
}
