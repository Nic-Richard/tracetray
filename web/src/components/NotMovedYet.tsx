import { useLocation } from "react-router";

export default function NotMovedYet({ title, body = "This view is still being moved into the new dashboard." }: { title: string; body?: string }) {
  const { search } = useLocation();
  return (
    <div className="placeholder-section">
      <h1>{title}</h1>
      <p>{body}</p>
      <p><a className="link-button" href={`/dashboard.html${search}`}>Open it in the current dashboard</a></p>
    </div>
  );
}
