"use client";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { useEffect, useState } from "react";
import styles from "./workspace.module.css";

export default function MicrosoftMailPanel() {
  const { t } = useLocale();
  const [status, setStatus] = useState<{ email: string; connected: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true;
    fetch("/api/rythms/mail", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (current) setStatus(data);
      })
      .catch(() => undefined);
    if (new URLSearchParams(window.location.search).get("mail") === "failed")
      setMessage("rythms_mail_failed");
    return () => {
      current = false;
    };
  }, []);
  async function act(action: "connect" | "test") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/rythms/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (action === "connect") {
        const url = new URL(data.url);
        if (url.origin !== "https://login.microsoftonline.com") throw new Error();
        window.location.assign(url.href);
      } else setMessage("rythms_mail_test_accepted");
    } catch {
      setMessage("rythms_mail_failed");
    } finally {
      setBusy(false);
    }
  }
  if (!status) return null;
  return (
    <section className={styles.panel} aria-label={t("rythms_mail_title")}>
      <h2>{t("rythms_mail_title")}</h2>
      <p>{t("rythms_mail_description", { email: status.email })}</p>
      <p role="status">{t(status.connected ? "rythms_mail_connected" : "rythms_mail_not_connected")}</p>
      <div className={styles.row}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => act("connect")}>
          {t(status.connected ? "rythms_mail_reconnect" : "rythms_mail_connect")}
        </button>
        {status.connected && (
          <button type="button" disabled={busy} onClick={() => act("test")}>
            {t("rythms_mail_test")}
          </button>
        )}
      </div>
      {message && <p role="status">{t(message)}</p>}
    </section>
  );
}
