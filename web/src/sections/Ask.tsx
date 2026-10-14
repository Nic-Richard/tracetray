import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { AskTurn } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";

const STARTERS = [
  "Which pages got the most visits in the last 30 days?",
  "Where are my visitors coming from?",
  "Where do people leave the site?",
  "How do mobile visitors behave differently from desktop?",
  "Has anything changed across my recent analyses?"
];

const LOOKUPS: Record<string, string> = {
  list_pages: "Pages", get_pages_in_group: "Pages in a group", get_overview: "Overview", get_traffic_trend: "Daily traffic",
  get_top_clicks: "Clicks", get_traffic_sources: "Traffic sources", get_visitor_journeys: "Journeys",
  get_ux_trends: "Analysis history", get_attention: "Attention"
};

interface Entry {
  question: string;
  answer?: string;
  lookups?: string[];
  error?: string;
}

function bold(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

// Answers use short paragraphs, "- " bullets and **bold**; anything else shows as plain text.
function Answer({ text }: { text: string }) {
  const blocks: (string | string[])[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•] /.test(line);
    const last = blocks[blocks.length - 1];
    if (bullet) Array.isArray(last) ? last.push(line.slice(2)) : blocks.push([line.slice(2)]);
    else if (line) blocks.push(line.replace(/^#+\s*/, ""));
  }
  return <>{blocks.map((block, i) => (Array.isArray(block)
    ? <ul key={i}>{block.map((item, j) => <li key={j}>{bold(item)}</li>)}</ul>
    : <p key={i}>{bold(block)}</p>))}</>;
}

export default function Ask() {
  const api = useApi();
  const { siteKey, site } = useSite();
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const shownSite = useRef(siteKey);
  useEffect(() => {
    if (shownSite.current === siteKey) return;
    shownSite.current = siteKey;
    setEntries([]);
  }, [siteKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [entries]);

  async function ask(question: string) {
    question = question.trim();
    if (!question || busy) return;
    const history: AskTurn[] = entries
      .filter(e => e.answer)
      .slice(-3)
      .flatMap(e => [{ role: "user" as const, text: e.question }, { role: "assistant" as const, text: e.answer! }]);
    setBusy(true);
    setInput("");
    setEntries(current => [...current, { question }]);
    try {
      const result = await api.ask(siteKey, question, history);
      setEntries(current => current.map((e, i) => (i === current.length - 1 ? { ...e, answer: result.answer, lookups: result.lookups } : e)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "couldn't answer that just now";
      setEntries(current => current.map((e, i) => (i === current.length - 1 ? { ...e, error: message.charAt(0).toUpperCase() + message.slice(1) } : e)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const queued = params.get("q");
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!queued || handled.current === queued) return;
    handled.current = queued;
    setParams(prev => { const next = new URLSearchParams(prev); next.delete("q"); return next; }, { replace: true });
    ask(queued);
  }, [queued]);

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(input);
  }

  return (
    <div className="content ask">
      <div className="section-head"><h1 className="section-title">Ask</h1></div>
      <p className="ask-intro">Ask about visitors to {site.name} in plain English. TraceTray looks up the numbers (pages, traffic, clicks, journeys and past analyses) and explains what they show. It can't see sales, sign-ups or who your visitors are.</p>
      {entries.length === 0 && (
        <div className="ask-starters">
          {STARTERS.map(starter => <button key={starter} type="button" className="chip" onClick={() => ask(starter)}>{starter}</button>)}
        </div>
      )}
      <div aria-live="polite" style={{ display: "grid", gap: 14 }}>
        {entries.map((entry, i) => (
          <Fragment key={i}>
            <div className="bubble-q">{entry.question}</div>
            {entry.error ? <div className="bubble-a error"><p>{entry.error}.</p></div>
              : entry.answer ? (
                <div className="bubble-a">
                  <Answer text={entry.answer} />
                  {(entry.lookups?.length || 0) > 0 && (
                    <div className="lookups">Looked at {[...new Set(entry.lookups)].map(name => <span key={name}>{LOOKUPS[name] || name}</span>)}</div>
                  )}
                </div>
              ) : <div className="bubble-a pending"><p>Looking at your data…</p></div>}
          </Fragment>
        ))}
        <div ref={endRef} />
      </div>
      <form className="ask-form" onSubmit={submit}>
        <textarea ref={inputRef} rows={1} maxLength={500} value={input} placeholder="Ask a question about this website" aria-label="Your question"
          onChange={event => { setInput(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${event.target.scrollHeight}px`; }}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(input); } }} />
        <button type="submit" className="btn primary" disabled={busy || !input.trim()}>Ask</button>
      </form>
      <p className="ask-note">Answers come from an AI model reading your data. Check anything important against the other views.</p>
    </div>
  );
}
