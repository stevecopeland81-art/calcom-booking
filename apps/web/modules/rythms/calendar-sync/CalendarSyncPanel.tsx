"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "../workspace.module.css";
import { type CalendarOption, type CalendarRef, calendarKey, type SyncInput, type SyncStatus } from "./types";

export default function CalendarSyncPanel() {
  const { t } = useLocale();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [options, setOptions] = useState<CalendarOption[]>([]);
  const [selected, setSelected] = useState<CalendarRef[]>([]);
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const inFlight = useRef(false);

  async function refresh(withOptions = false) {
    const response = await fetch(`/api/rythms/calendar-sync${withOptions ? "?options=1" : ""}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "rythms_sync_request_failed");
    setStatus(data.status);
    if (withOptions) {
      setOptions(data.options || []);
      setSelected(data.status.calendars);
      setOptionsError(data.optionsError || "");
    }
  }
  useEffect(() => {
    const report = (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "rythms_sync_request_failed");
    void refresh(true).catch(report);
    const timer = setInterval(() => {
      void refresh().catch(report);
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  async function save(input: SyncInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/rythms/calendar-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "rythms_sync_request_failed");
      setStatus(data.status);
      setConfirmStop(false);
      setNotice("rythms_sync_queued");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "rythms_sync_request_failed");
      void refresh().catch(() => {});
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const disabled = saving || !status || status.running || !status.workerAvailable;
  return (
    <section className={styles.people} aria-labelledby="busy-sync-title">
      <h2 id="busy-sync-title">{t("rythms_sync_title")}</h2>
      <p>{t("rythms_sync_description")}</p>
      <p className={styles.help}>{t("rythms_sync_window")}</p>
      {error && (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      )}
      {optionsError && (
        <p className={styles.error} role="alert">
          {t(optionsError)}
        </p>
      )}
      {!status ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          <p role="status">
            {t(
              status.running
                ? "rythms_sync_running"
                : status.cleanup
                  ? "rythms_sync_cleanup"
                  : status.enabled
                    ? "rythms_sync_enabled"
                    : "rythms_sync_off"
            )}
          </p>
          {status.lastError && (
            <p className={styles.error} role="alert">
              {t(status.lastError)}
            </p>
          )}
          {status.lastSuccessAt && (
            <p>
              {t("rythms_sync_last_success", {
                date: new Date(status.lastSuccessAt).toLocaleString(),
                count: status.mirrorCount,
              })}
            </p>
          )}
          {!status.workerAvailable && <p role="alert">{t("rythms_sync_worker_unavailable")}</p>}
          {options.length < 2 && (
            <p className={styles.empty}>
              {t("rythms_sync_connect_hint")}{" "}
              <Link href="/apps/categories/calendar">{t("rythms_connect_account")}</Link>
            </p>
          )}
          <fieldset disabled={disabled}>
            <legend>{t("rythms_sync_choose")}</legend>
            {options.map((option) => (
              <label className={styles.check} key={option.key}>
                <input
                  type="checkbox"
                  checked={selected.some((ref) => calendarKey(ref) === calendarKey(option))}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [
                            ...current,
                            {
                              credentialId: option.credentialId,
                              calendarId: option.calendarId,
                            },
                          ]
                        : current.filter((ref) => calendarKey(ref) !== calendarKey(option))
                    )
                  }
                />
                <span>
                  {option.account} — {option.name}
                </span>
              </label>
            ))}
          </fieldset>
          <div className={styles.row}>
            <button
              className={styles.primary}
              type="button"
              disabled={disabled || selected.length < 2 || Boolean(optionsError)}
              onClick={() => save({ action: "save", revision: status.revision, calendars: selected })}>
              {t(status.enabled ? "rythms_sync_save" : "rythms_sync_enable")}
            </button>
            <button
              className={styles.secondary}
              type="button"
              disabled={saving}
              onClick={() => {
                setError("");
                void refresh(true).catch(() => setError("rythms_sync_request_failed"));
              }}>
              {t("rythms_sync_refresh")}
            </button>
            {(status.enabled || status.cleanup) && (
              <button
                className={styles.secondary}
                type="button"
                disabled={disabled}
                onClick={() => save({ action: "run", revision: status.revision })}>
                {t("rythms_sync_now")}
              </button>
            )}
          </div>
          {(status.enabled || status.mirrorCount > 0) && (
            <div className={styles.deleteConfirm}>
              {!confirmStop ? (
                <button
                  className={styles.delete}
                  type="button"
                  disabled={disabled}
                  onClick={() => setConfirmStop(true)}>
                  {t("rythms_sync_stop")}
                </button>
              ) : (
                <>
                  <p>{t("rythms_sync_stop_confirm")}</p>
                  <button
                    type="button"
                    className={styles.delete}
                    disabled={disabled}
                    onClick={() => save({ action: "stop", revision: status.revision })}>
                    {t("rythms_sync_stop")}
                  </button>{" "}
                  <button type="button" onClick={() => setConfirmStop(false)}>
                    {t("cancel")}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {t(notice)}
        </p>
      )}
    </section>
  );
}
