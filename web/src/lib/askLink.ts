import { useLocation, useNavigate } from "react-router";

export function useAskAbout() {
  const navigate = useNavigate();
  const { search } = useLocation();
  return (question: string) => {
    const params = new URLSearchParams(search);
    params.set("q", question);
    navigate({ pathname: "/ask", search: `?${params}` });
  };
}
