import { useEffect, useState } from "react";
import { compactNumber, pageLabel, type GroupMember, type MemberSort } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { heatColor } from "../lib/heat";
import Icon from "./Icon";

const PAGE_SIZE = 25;
type Days = 7 | 30 | null;

export default function GroupPages({ page, groupSize }: { page: string; groupSize: number }) {
  const api = useApi();
  const { siteKey } = useSite();
  const [days, setDays] = useState<Days>(30);
  const [sort, setSort] = useState<MemberSort>("sessions");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<GroupMember[]>([]);
  const [total, setTotal] = useState(0);
  const [limited, setLimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.groupMembers(siteKey, page, { days, sort, q: search, limit: PAGE_SIZE })
      .then(result => { if (!cancelled) { setRows(result.rows); setTotal(result.total); setLimited(result.limited); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, siteKey, page, days, sort, search]);

  function loadMore() {
    api.groupMembers(siteKey, page, { days, sort, q: search, limit: PAGE_SIZE, offset: rows.length })
      .then(result => setRows(current => [...current, ...result.rows]))
      .catch(err => setError(err.message));
  }

  const max = Math.max(1, ...rows.map(r => r.sessions));
  const sortButton = (key: MemberSort, label: string) => (
    <button type="button" className={sort === key ? "on" : ""} onClick={() => setSort(key)} aria-pressed={sort === key}>{label}</button>
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pages in this group</h2>
        <div className="end">
          {!limited && (
            <label className="search">
              <Icon name="search" size={14} />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${groupSize.toLocaleString()} pages`} aria-label="Search pages in this group" />
            </label>
          )}
          <div className="seg" role="group" aria-label="Time range">
            {([7, 30, null] as Days[]).map(value => (
              <button key={String(value)} type="button" className={days === value ? "on" : ""} onClick={() => setDays(value)}>
                {value ? `${value} days` : "All"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error ? <p className="empty">{error}</p> : (
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th className="right">{sortButton("sessions", "Visits")}</th>
              <th className="right hide-sm">{sortButton("clicks", "Clicks")}</th>
              <th className="right hide-sm">Desktop</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.path}>
                <td className="page-cell"><span className="cell-page"><i style={{ background: heatColor(row.sessions, max) }} /><span title={row.path}>{row.path}</span></span></td>
                <td className="right num"><span className="cell-bar"><i style={{ width: `${Math.max(4, (row.sessions / max) * 90)}px` }} />{row.sessions.toLocaleString()}</span></td>
                <td className="right num hide-sm">{row.clicks.toLocaleString()}</td>
                <td className="right num hide-sm">{row.sessions ? `${Math.round((row.desktop / row.sessions) * 100)}%` : "–"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4} className="empty">{search ? `No page in this group matches “${search}”.` : "No visits in this time range."}</td></tr>
            )}
          </tbody>
        </table>
      )}
      {limited ? (
        <div className="panel-foot">
          Showing the {Math.min(rows.length, total)} busiest of {compactNumber(groupSize)} {pageLabel(page).toLowerCase()}.{" "}
          <a className="link-button" href="/billing.html">Search all of them with Pro</a>
        </div>
      ) : rows.length < total && (
        <div className="panel-foot"><button type="button" className="link-button" onClick={loadMore}>Show {Math.min(PAGE_SIZE, total - rows.length)} more of {total.toLocaleString()}</button></div>
      )}
    </section>
  );
}
