import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router";
import { ApiError, type Account, type Mode } from "@tracetray/shared";
import DeleteAccount from "./sections/DeleteAccount";
import { useApi } from "./api";
import { SiteProvider } from "./state/site";
import Rail from "./components/Rail";
import PageTree from "./components/PageTree";
import BugReport from "./components/BugReport";
import Icon from "./components/Icon";
import PageView from "./sections/PageView";
import Ask from "./sections/Ask";
import Setup from "./sections/Setup";
import Journeys from "./sections/Journeys";
import Sessions from "./sections/Sessions";

function Shell() {
  const { pathname } = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState("");
  const onPages = pathname.startsWith("/pages");

  useEffect(() => {
    if (params.get("checkout") !== "success") return;
    setNotice("Subscription activated. Welcome to TraceTray.");
    setParams(prev => { const next = new URLSearchParams(prev); next.delete("checkout"); return next; }, { replace: true });
  }, [params, setParams]);

  useEffect(() => { setSheetOpen(false); }, [pathname]);

  return (
    <div className={`shell${onPages ? "" : " no-tree"}`}>
      <Rail onReportBug={() => setReporting(true)} />
      {onPages && <PageTree />}
      <main className="main">
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button type="button" className="muted-button" onClick={() => setNotice("")} aria-label="Dismiss">Dismiss</button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to={{ pathname: "/pages", search: window.location.search }} replace />} />
          <Route path="/pages/:tab?" element={<PageView onPickPage={() => setSheetOpen(true)} />} />
          <Route path="/ask" element={<Ask />} />
          <Route path="/journeys" element={<Journeys />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/pages" replace />} />
        </Routes>
      </main>
      {sheetOpen && (
        <div className="sheet" role="dialog" aria-label="Choose a page">
          <div className="sheet-top"><button type="button" className="btn" onClick={() => setSheetOpen(false)} aria-label="Close"><Icon name="close" size={16} /></button></div>
          <PageTree onPicked={() => setSheetOpen(false)} />
        </div>
      )}
      {reporting && <BugReport onClose={() => setReporting(false)} />}
    </div>
  );
}

export default function App({ mode }: { mode: Mode }) {
  const api = useApi();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === "/delete-account") return;
    api.account().then(setAccount).catch(err => {
      if (err instanceof ApiError && err.body.account_deleting) setClosing(true);
      else setError(err.message);
    });
  }, [api]);

  if (pathname === "/delete-account" || closing) return <DeleteAccount />;
  if (error) return <p className="loading">TraceTray couldn't load your account: {error}. Refresh the page to try again.</p>;
  if (!account) return <p className="loading">Loading…</p>;
  return (
    <SiteProvider account={account} mode={mode}>
      <Shell />
    </SiteProvider>
  );
}
