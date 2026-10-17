import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { ASK_STARTERS as STARTERS, ASK_LOOKUPS as LOOKUPS, answerBlocks, answerSpans, askHistory, type AskEntry as Entry } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";

function bold(text: string): ReactNode[] {
  return answerSpans(text).map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : <Fragment key={i}>{part.text}</Fragment>));
}

// Answers use short paragraphs, "- " bullets and **bold**; anything else shows as plain text.
function Answer({ text }: { text: string }) {
  const blocks = answerBlocks(text);
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
    const history = askHistory(entries);
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
      <p className="ask-intro">Ask about visitors to {site.name} in plain English. TraceTray looks up the numbers (pages, traffic, clicks, journeys and past analyses) and explains what they show. It knows the goals you've set, but not revenue or who your visitors are.</p>
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
