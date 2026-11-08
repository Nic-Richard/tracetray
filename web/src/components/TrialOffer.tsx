import { useEffect, useRef, useState } from "react";
import { useApi } from "../api";

const PLANS = [
  { id: "starter", name: "Starter", price: "$12", visits: "10,000 visits a month, one website" },
  { id: "pro", name: "Pro", price: "$24", visits: "100,000 visits a month, five websites, weekly analysis" },
  { id: "ultra", name: "Ultra", price: "$49", visits: "1,000,000 visits a month, ten websites" }
] as const;

export default function TrialOffer({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function start(plan: (typeof PLANS)[number]["id"]) {
    setBusy(plan); setError("");
    try {
      window.location.href = (await api.checkout(plan)).url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout didn't open");
      setBusy("");
    }
  }

  async function skip() {
    setBusy("skip");
    await api.skipTrialOffer().catch(() => {});
    dialog.current?.close();
  }

  return (
    <dialog ref={dialog} className="panel dialog trial-offer" onClose={onClose} aria-labelledby="trial-title">
      <div className="panel-head"><h2 id="trial-title" tabIndex={-1} autoFocus style={{ outline: "none" }}>Try any plan free for 30 days</h2></div>
      <div className="panel-body dialog-body">
        <p className="muted">You're on Free: 2,000 visits a month and the last 30 days. A trial gives you the full plan, and you won't be charged if you cancel before it ends.</p>
        <div className="trial-plans">
          {PLANS.map(plan => (
            <button key={plan.id} type="button" className={`trial-plan${plan.id === "pro" ? " featured" : ""}`} disabled={!!busy} onClick={() => start(plan.id)}>
              <b>{plan.name} <span>{plan.price} a month</span></b>
              <small>{busy === plan.id ? "Opening checkout…" : plan.visits}</small>
            </button>
          ))}
        </div>
        {error && <p className="page-status error" style={{ padding: 0 }}>{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="muted-button" disabled={!!busy} onClick={skip}>Skip, stay on Free</button>
        </div>
      </div>
    </dialog>
  );
}
