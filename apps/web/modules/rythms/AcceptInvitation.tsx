"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import Link from "next/link";
import { useState } from "react";
import styles from "./workspace.module.css";

export default function AcceptInvitation({ token }: { token: string }) {
  const { t } = useLocale();
  const [state, setState] = useState<"idle" | "busy" | "accepted">("idle");
  const [error, setError] = useState("");
  async function accept() {
    setState("busy");
    setError("");
    try {
      const response = await fetch("/api/rythms/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acceptInvitation", token }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || "rythms_save_failed");
      setState("accepted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "rythms_save_failed");
      setState("idle");
    }
  }
  return (
    <main className={styles.workspace}>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>Rythms Cal</div>
        <h1>{t("rythms_join_company")}</h1>
        <p>{t("rythms_accept_invite_help")}</p>
        {error && (
          <p role="alert" className={styles.error}>
            {t(error)}
          </p>
        )}
        {state === "accepted" ? (
          <>
            <p role="status">{t("rythms_invite_accepted")}</p>
            <Link className={styles.primary} href="/companies">
              {t("rythms_open_workspace")}
            </Link>
          </>
        ) : (
          <button type="button" className={styles.primary} disabled={state === "busy"} onClick={accept}>
            {t("rythms_accept_invite")}
          </button>
        )}
      </section>
    </main>
  );
}
