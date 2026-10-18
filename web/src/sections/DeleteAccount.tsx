import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/clerk-react";
import { DELETION_DETAILS, deletionMessage, type AccountDeletionStatus } from "@tracetray/shared";
import { useApi } from "../api";

export default function DeleteAccount() {
  const api = useApi();
  const { signOut } = useClerk();
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    api.accountDeletion().then(value => { if (active) setStatus(value); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [api]);
  async function refresh() {
    setError("");
    try { setStatus(await api.accountDeletion()); } catch (err) { setError(err instanceof Error ? err.message : "Couldn't check status."); }
  }
  async function remove() {
    if (pending.current || confirmation !== "DELETE") return;
    pending.current = true; setBusy(true); setError("");
    try { setStatus(await api.deleteAccount(confirmation)); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't save your request."); }
    finally { pending.current = false; setBusy(false); }
  }
  const closing = status && status.state !== "none";
  return <main className="content setup account-deletion">
    <h1>{closing ? "Account deletion" : "Delete your TraceTray account"}</h1>
    {closing ? <p role="status">{deletionMessage(status.state)}</p> : DELETION_DETAILS.map(text => <p key={text}>{text}</p>)}
    {error && <p role="alert" className="error">{error}</p>}
    {!closing && <form onSubmit={event => { event.preventDefault(); void remove(); }}>
      <label>Type DELETE to confirm permanent deletion.<input aria-label="Deletion confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" /></label>
      <button className="btn deletion-submit" disabled={!status || confirmation !== "DELETE" || busy}>{busy ? "Saving request…" : "Permanently delete account"}</button>
    </form>}
    <p><button className="btn" onClick={refresh}>Check status</button> <button className="btn" onClick={() => { signOut().catch(() => setError("Couldn't sign out. Try again.")); }}>Sign out</button></p>
    {!closing && <a href="/app/setup">Back to setup</a>}
    <p><a href="mailto:support@tracetray.com">Contact support</a> · <a href="/privacy">Privacy policy</a></p>
  </main>;
}
