import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { compactNumber, isPageGroup, pageLabel, pagePath, type GroupMember, type PageSummary } from "@tracetray/shared";
import { useApi } from "../api";
import { useSite } from "../state/site";
import { heatColor } from "../lib/heat";
import Icon from "./Icon";

const PREVIEW = 3;

function SiteMenu({ onClose }: { onClose: () => void }) {
  const { sites, siteKey, setSite } = useSite();
  const navigate = useNavigate();
  const { search } = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [onClose]);

  return (
    <div className="menu" ref={ref} role="menu">
      {sites.map(site => (
        <button key={site.key} type="button" role="menuitem" onClick={() => { setSite(site.key); onClose(); }}>
          <span>{site.name}</span>{site.key === siteKey && <span aria-label="current">✓</span>}
        </button>
      ))}
      <hr />
      <button type="button" role="menuitem" onClick={() => { navigate({ pathname: "/setup", search }); onClose(); }}>Add or manage websites</button>
    </div>
  );
}

function Row({ item, max, active, pinned, onPick, onPin }: {
  item: PageSummary; max: number; active: boolean; pinned: boolean; onPick: () => void; onPin: () => void;
}) {
  const group = isPageGroup(item.page);
  const detail = group ? `${pagePath(item.page)}, ${item.pages_in_group?.toLocaleString() ?? "many"} pages` : pagePath(item.page);
  return (
    <div className="tree-line">
      <button type="button" className={`tree-row${active ? " active" : ""}${item.locked ? " locked" : ""}`} onClick={onPick} aria-current={active ? "page" : undefined}
        title={item.locked ? "Past your plan's page limit this month" : undefined}>
        <span className="heat" style={{ background: heatColor(item.sessions, max) }} />
        <span><b>{pageLabel(item.page)}</b>{detail !== pageLabel(item.page) && <small>{detail}</small>}</span>
        <span className="count num">{item.locked ? <Icon name="lock" size={13} /> : compactNumber(item.sessions)}</span>
      </button>
      <button type="button" className={`tree-pin${pinned ? " on" : ""}`} onClick={onPin} aria-label={pinned ? `Unpin ${pageLabel(item.page)}` : `Pin ${pageLabel(item.page)}`} title={pinned ? "Unpin" : "Pin to the top"}>
        {pinned ? "●" : "○"}
      </button>
    </div>
  );
}

export default function PageTree({ onPicked }: { onPicked?: () => void }) {
  const api = useApi();
  const { site, siteKey, pages, pagesError, page, setPage, pins, togglePin } = useSite();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [members, setMembers] = useState<Record<string, GroupMember[]>>({});

  useEffect(() => { setMembers({}); setQuery(""); }, [siteKey]);

  useEffect(() => {
    if (!page || !isPageGroup(page) || members[page]) return;
    let cancelled = false;
    api.groupMembers(siteKey, page, { limit: PREVIEW })
      .then(result => { if (!cancelled) setMembers(m => ({ ...m, [page]: result.rows.slice(0, PREVIEW) })); })
      .catch(() => { if (!cancelled) setMembers(m => ({ ...m, [page]: [] })); });
    return () => { cancelled = true; };
  }, [api, siteKey, page, members]);

  const max = useMemo(() => Math.max(1, ...(pages || []).map(p => p.sessions)), [pages]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (pages || []).filter(p => !q || pageLabel(p.page).toLowerCase().includes(q) || pagePath(p.page).toLowerCase().includes(q));
  }, [pages, query]);

  const pinned = filtered.filter(p => pins.includes(p.page));
  const groups = filtered.filter(p => !pins.includes(p.page) && isPageGroup(p.page));
  const singles = filtered.filter(p => !pins.includes(p.page) && !isPageGroup(p.page));

  function pick(value: string) {
    setPage(value);
    if (!pathname.startsWith("/pages")) navigate({ pathname: "/pages", search: `?site=${encodeURIComponent(siteKey)}&page=${encodeURIComponent(value)}` });
    onPicked?.();
  }

  function renderRows(list: PageSummary[]) {
    return list.map(item => (
      <div key={item.page}>
        <Row item={item} max={max} active={item.page === page} pinned={pins.includes(item.page)} onPick={() => pick(item.page)} onPin={() => togglePin(item.page)} />
        {item.page === page && isPageGroup(item.page) && (members[item.page] || []).map(member => (
          <div key={member.path} className="tree-row tree-child">
            <span className="heat" style={{ background: heatColor(member.sessions, max) }} />
            <span><b>{member.path}</b></span>
            <span className="count num">{compactNumber(member.sessions)}</span>
          </div>
        ))}
        {item.page === page && isPageGroup(item.page) && (item.pages_in_group || 0) > PREVIEW && (
          <button type="button" className="link-button tree-more" onClick={() => { navigate({ pathname: "/pages", search }); onPicked?.(); }}>
            All {item.pages_in_group?.toLocaleString()} {pageLabel(item.page).toLowerCase()}
          </button>
        )}
      </div>
    ));
  }

  return (
    <aside className="tree" aria-label="Pages">
      <div className="tree-site">
        <b title={site.name}>{site.name}</b>
        <button type="button" className="muted-button" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen}>Switch</button>
        {menuOpen && <SiteMenu onClose={() => setMenuOpen(false)} />}
      </div>
      <label className="tree-find">
        <Icon name="search" size={15} />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a page" aria-label="Find a page" />
      </label>
      <div className="tree-legend" aria-hidden="true">Fewer visits <i /> More</div>
      <div className="tree-items">
        {pages === null && <p className="tree-empty">Loading pages…</p>}
        {pagesError && <p className="tree-empty">{pagesError}</p>}
        {pages?.length === 0 && !pagesError && <p className="tree-empty">No pages yet. Add the tracking snippet from Setup and visits will show up here.</p>}
        {pages && pages.length > 0 && filtered.length === 0 && <p className="tree-empty">No page matches “{query}”.</p>}
        {pinned.length > 0 && <><div className="tree-heading">Pinned</div>{renderRows(pinned)}</>}
        {groups.length > 0 && <><div className="tree-heading">Groups</div>{renderRows(groups)}</>}
        {singles.length > 0 && <><div className="tree-heading">Pages</div>{renderRows(singles)}</>}
      </div>
    </aside>
  );
}
