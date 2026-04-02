import { useCallback, useEffect, useMemo, useState } from "react";

const SESSION_RE =
  /\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const CADASTRO_MSG_TYPE = "cadastro-bezura-context-url";

function extractSessionId(url: string): string | null {
  if (!url) return null;
  try {
    const m = url.match(SESSION_RE);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function readContextUrlFromQuery(): string {
  const params = new URLSearchParams(window.location.search);
  const encoded =
    params.get("contextUrl") ||
    params.get("parentUrl") ||
    params.get("ref") ||
    params.get("url");
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return "";
}

export default function App() {
  const [copied, setCopied] = useState(false);
  const [contextUrl, setContextUrl] = useState("");

  useEffect(() => {
    const fromQuery = readContextUrlFromQuery();
    if (fromQuery) {
      setContextUrl(fromQuery);
      return;
    }
    if (document.referrer) {
      setContextUrl(document.referrer);
    }
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== CADASTRO_MSG_TYPE) return;
      if (typeof data.url !== "string" || !data.url.trim()) return;
      setContextUrl(data.url.trim());
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const sessionId = useMemo(() => extractSessionId(contextUrl), [contextUrl]);

  const registrationUrl = useMemo(() => {
    if (!sessionId) return "";
    const origin = window.location.origin;
    return `${origin}/?${sessionId}`;
  }, [sessionId]);

  const copyLink = useCallback(async () => {
    if (!registrationUrl) return;
    try {
      await navigator.clipboard.writeText(registrationUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = registrationUrl;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  }, [registrationUrl]);

  return (
    <div className="app">
      <header className="app-header">
        <img src="/logan-technology-logomarca-.png" alt="Logan Technology" />
      </header>
      <main className="app-main">
        <button
          type="button"
          className="bubble"
          onClick={copyLink}
          disabled={!registrationUrl}
        >
          <span className="bubble-title">Formulário de Cadastro</span>
          {registrationUrl ? (
            <span className="bubble-url">{registrationUrl}</span>
          ) : null}
          <span className="bubble-hint">
            {registrationUrl
              ? "Clique para copiar o link com o ID da sessão."
              : "Carregue esta página pelo script na aba do chat (envia a URL atual) ou abra com ?contextUrl=... na URL. O ID é lido do trecho /sessions/{uuid}."}
          </span>
        </button>
        {copied ? <p className="toast">Link copiado.</p> : null}
      </main>
    </div>
  );
}
