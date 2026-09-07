"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { DestinationCalendarSettingsWebWrapper } from "@components/apps/DestinationCalendarSettingsWebWrapper";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { SelectedCalendarsSettingsWebWrapper } from "~/calendars/components/SelectedCalendarsSettingsWebWrapper";
import CompanyPeople from "./CompanyPeople";
import type { CompanyInput, WorkspaceMutation } from "./schema";
import type { WorkspaceData } from "./service";
import styles from "./workspace.module.css";

type Tab = "companies" | "calendars" | "links";

function CalendarPanel() {
  const { t } = useLocale();
  const calendars = trpc.viewer.calendars.connectedCalendars.useQuery();
  const utils = trpc.useUtils();
  if (calendars.isError)
    return (
      <p role="alert">
        {t("rythms_calendar_error")}{" "}
        <button type="button" onClick={() => calendars.refetch()}>
          {t("retry")}
        </button>
      </p>
    );
  if (calendars.isPending) return <p role="status">{t("loading")}</p>;
  return (
    <section className={styles.panel}>
      <div className={styles.row}>
        <div>
          <h2>{t("rythms_calendar_title")}</h2>
          <p>{t("rythms_calendar_description")}</p>
        </div>
        <Link className={styles.primary} href="/apps/categories/calendar">
          {t("rythms_connect_account")}
        </Link>
      </div>
      {!calendars.data?.connectedCalendars.length && (
        <p className={styles.empty}>{t("rythms_no_calendars")}</p>
      )}
      <DestinationCalendarSettingsWebWrapper connectedCalendars={calendars.data} />
      <Suspense fallback={<p>{t("loading")}</p>}>
        <SelectedCalendarsSettingsWebWrapper
          connectedCalendars={calendars.data}
          onChanged={() => utils.viewer.calendars.connectedCalendars.invalidate()}
        />
      </Suspense>
      <p className={styles.help}>{t("rythms_destination_help")}</p>
    </section>
  );
}

export default function Workspace() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("companies");
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [draft, setDraft] = useState<CompanyInput | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [slug, setSlug] = useState("");
  const [target, setTarget] = useState("portfolio");
  const [origin, setOrigin] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [invitationPath, setInvitationPath] = useState("");

  async function refresh() {
    const response = await fetch("/api/rythms/workspace", { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 ? "rythms_sign_in" : "rythms_load_failed");
    setData(await response.json());
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    refresh().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "rythms_load_failed")
    );
  }, []);

  async function save(input: WorkspaceMutation) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/rythms/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result: { error?: string; invitationPath?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || "rythms_save_failed");
      // The mutation succeeded even if the subsequent refresh fails; do not encourage a duplicate submission.
      setDraft(null);
      setConfirmDelete(null);
      setSlug("");
      setMessage("rythms_saved");
      setInvitationPath(result.invitationPath || "");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "rythms_save_failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function newCompany() {
    setDraft({
      action: "saveCompany",
      name: "",
      description: "",
      contactEmail: data?.user?.email || "",
      brandColor: "#2563eb",
      published: false,
      eventTypeIds: [],
      sharedConflictChecks: true,
    });
  }

  function editCompany(company: WorkspaceData["companies"][number]) {
    setDraft({
      action: "saveCompany",
      id: company.id,
      name: company.name,
      description: company.description,
      contactEmail: company.contactEmail || "",
      brandColor: company.brandColor,
      published: company.published,
      eventTypeIds: company.eventTypes
        .filter((event) => data?.events.some((own) => own.id === event.id))
        .map((event) => event.id),
      sharedConflictChecks: company.eventTypes.every((event) => !event.useEventLevelSelectedCalendars),
    });
  }

  async function copyLink(path: string) {
    try {
      await navigator.clipboard.writeText(`${origin}${path}`);
      setMessage("rythms_copied");
    } catch {
      setError("rythms_copy_failed");
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Rythms Cal</div>
          <h1>{t("rythms_workspace_title")}</h1>
          <p>{t("rythms_workspace_description")}</p>
        </div>
        <Link className={styles.secondary} href="/bookings/upcoming">
          {t("rythms_view_bookings")}
        </Link>
      </header>
      <nav className={styles.tabs} aria-label={t("rythms_workspace_title")}>
        {(["companies", "calendars", "links"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-current={tab === item ? "page" : undefined}
            onClick={() => {
              setTab(item);
              setDraft(null);
            }}>
            {t(`rythms_tab_${item}`)}
            {item === "companies" && data && <span>{data.companies.length}</span>}
          </button>
        ))}
      </nav>
      {error && (
        <div className={styles.error} role="alert">
          {t(error)}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              refresh().catch(() => setError("rythms_load_failed"));
            }}>
            {t("retry")}
          </button>
        </div>
      )}
      {invitationPath && (
        <section className={styles.panel}>
          <label>
            {t("rythms_invite_created")}
            <input
              readOnly
              value={`${origin}${invitationPath}`}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p>{t("rythms_invite_copy_help")}</p>
          <button type="button" className={styles.secondary} onClick={() => copyLink(invitationPath)}>
            {t("rythms_copy_link")}
          </button>
          <button type="button" className={styles.secondary} onClick={() => setInvitationPath("")}>
            {t("close")}
          </button>
        </section>
      )}
      {message && (
        <p className={styles.notice} role="status">
          {t(message)}
        </p>
      )}
      {!data && !error && <p role="status">{t("loading")}</p>}
      {data && tab === "companies" && (
        <>
          <div className={styles.row}>
            <h2>{t("rythms_companies_heading")}</h2>
            <button type="button" className={styles.primary} onClick={newCompany}>
              {t("rythms_add_company")}
            </button>
          </div>
          {!data.companies.length && !draft && (
            <div className={styles.empty}>
              <h3>{t("rythms_first_company")}</h3>
              <p>{t("rythms_first_company_description")}</p>
              <button type="button" className={styles.primary} onClick={newCompany}>
                {t("rythms_add_company")}
              </button>
            </div>
          )}
          {draft && (
            <form
              className={styles.panel}
              onSubmit={(event) => {
                event.preventDefault();
                save(draft);
              }}>
              <fieldset disabled={busy} className={styles.form}>
                <legend>{t(draft.id ? "rythms_edit_company" : "rythms_add_company")}</legend>
                <label>
                  {t("rythms_company_name")}
                  <input
                    autoFocus
                    required
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label>
                  {t("rythms_company_email")}
                  <input
                    type="email"
                    maxLength={254}
                    value={draft.contactEmail}
                    onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}
                  />
                  <small>{t("rythms_email_help")}</small>
                </label>
                <label className={styles.full}>
                  {t("rythms_description")}
                  <textarea
                    maxLength={600}
                    rows={3}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </label>
                <label>
                  {t("rythms_brand_color")}
                  <input
                    type="color"
                    value={draft.brandColor}
                    onChange={(e) => setDraft({ ...draft, brandColor: e.target.value })}
                  />
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
                  />
                  {t("rythms_publish_company")}
                </label>
                <div className={styles.full}>
                  <h3>{t("rythms_meeting_types")}</h3>
                  <p>{t("rythms_meeting_types_help")}</p>
                  <Link href="/event-types" className={styles.textLink}>
                    {t("rythms_manage_event_types")}
                  </Link>
                  {data.events.length === 0 && <p>{t("rythms_no_event_types")}</p>}
                  {data.events.map((event) => (
                    <label key={event.id} className={styles.eventOption}>
                      <input
                        type="checkbox"
                        checked={draft.eventTypeIds.includes(event.id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            eventTypeIds: e.target.checked
                              ? [...draft.eventTypeIds, event.id]
                              : draft.eventTypeIds.filter((id) => id !== event.id),
                          })
                        }
                      />
                      <span>
                        {event.title}
                        <small>
                          {event.length} {t("minutes")}
                          {event.hidden ? ` · ${t("rythms_hidden")}` : ""}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                <label className={`${styles.check} ${styles.full}`}>
                  <input
                    type="checkbox"
                    checked={draft.sharedConflictChecks}
                    onChange={(e) => setDraft({ ...draft, sharedConflictChecks: e.target.checked })}
                  />
                  <span>
                    {t("rythms_shared_conflicts")}
                    <small>{t("rythms_shared_conflicts_help")}</small>
                  </span>
                </label>
                <div className={`${styles.actions} ${styles.full}`}>
                  <button type="submit" className={styles.primary}>
                    {t(busy ? "saving" : "save")}
                  </button>
                  <button type="button" className={styles.secondary} onClick={() => setDraft(null)}>
                    {t("cancel")}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          <div className={styles.grid}>
            {data.companies.map((company) => (
              <article className={styles.card} key={company.id}>
                <div className={styles.row}>
                  <span className={styles.monogram} style={{ borderColor: company.brandColor }}>
                    {company.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className={styles.badge}>
                    {t(company.published ? "rythms_published" : "rythms_draft")}
                  </span>
                </div>
                <h3>{company.name}</h3>
                <p>{company.description || t("rythms_no_description")}</p>
                <p className={styles.email}>{company.contactEmail}</p>
                <div className={styles.eventList}>
                  {company.eventTypes
                    .filter((event) => data.events.some((own) => own.id === event.id))
                    .map((event) => (
                      <Link key={event.id} href={`/event-types/${event.id}`}>
                        <span>{event.title}</span>
                        <small>
                          {event.length} {t("minutes")}
                        </small>
                      </Link>
                    ))}
                </div>
                <div className={styles.actions}>
                  {company.ownerId === data.user?.id && (
                    <button className={styles.secondary} type="button" onClick={() => editCompany(company)}>
                      {t("edit")}
                    </button>
                  )}
                  <button
                    className={styles.secondary}
                    type="button"
                    onClick={() => {
                      setTarget(`company:${company.id}`);
                      setTab("links");
                    }}>
                    {t("rythms_create_link")}
                  </button>
                </div>
                <CompanyPeople company={company} data={data} busy={busy} onSave={save} />
                {company.ownerId === data.user?.id &&
                  (confirmDelete === company.id ? (
                    <div className={styles.deleteConfirm}>
                      <p>{t("rythms_delete_company_help")}</p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => save({ action: "deleteCompany", id: company.id })}>
                        {t("delete")}
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)}>
                        {t("cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.delete}
                      onClick={() => setConfirmDelete(company.id)}>
                      {t("rythms_remove_company")}
                    </button>
                  ))}
              </article>
            ))}
          </div>
        </>
      )}
      {data && tab === "links" && (
        <section className={styles.panel}>
          <h2>{t("rythms_links_title")}</h2>
          <p>{t("rythms_links_description")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const [kind, id] = target.split(":");
              save({
                action: "createLink",
                slug,
                target:
                  kind === "company"
                    ? { kind, companyId: id }
                    : kind === "event"
                      ? { kind, eventTypeId: Number(id) }
                      : { kind: "portfolio" },
              });
            }}>
            <fieldset disabled={busy} className={styles.linkForm}>
              <label>
                {t("rythms_short_name")}
                <input
                  required
                  minLength={3}
                  maxLength={48}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="meet-steve"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                />
                <small>
                  {origin}/b/{slug || "meet-steve"}
                </small>
              </label>
              <label>
                {t("rythms_link_destination")}
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="portfolio">{t("rythms_all_companies")}</option>
                  {data.companies.map((company) => (
                    <option key={company.id} value={`company:${company.id}`}>
                      {company.name}
                      {company.published ? "" : ` (${t("rythms_draft")})`}
                    </option>
                  ))}
                  {data.events
                    .filter((event) => !event.hidden)
                    .map((event) => (
                      <option key={event.id} value={`event:${event.id}`}>
                        {event.title}
                      </option>
                    ))}
                </select>
              </label>
              <button type="submit" className={styles.primary}>
                {t("rythms_create_link")}
              </button>
            </fieldset>
          </form>
          {!data.user?.username && (
            <p className={styles.error}>
              {t("rythms_username_required")} <Link href="/settings/my-account/profile">{t("settings")}</Link>
            </p>
          )}
          {!data.links.length && <p className={styles.empty}>{t("rythms_no_links")}</p>}
          <ul className={styles.linkList}>
            {data.links.map((link) => (
              <li key={link.id}>
                <div>
                  <a href={`/b/${link.slug}`} target="_blank" rel="noreferrer">
                    /b/{link.slug}
                  </a>
                  <small>
                    {link.companyId
                      ? data.companies.find((company) => company.id === link.companyId)?.name
                      : link.eventTypeId
                        ? data.events.find((event) => event.id === link.eventTypeId)?.title
                        : t("rythms_all_companies")}
                  </small>
                </div>
                <div className={styles.actions}>
                  <button type="button" disabled={busy} onClick={() => copyLink(`/b/${link.slug}`)}>
                    {t("rythms_copy_link")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => save({ action: "toggleLink", id: link.id, enabled: !link.enabled })}>
                    {t(link.enabled ? "rythms_disable" : "rythms_enable")}
                  </button>
                </div>
                {!link.enabled && <span className={styles.badge}>{t("rythms_disabled")}</span>}
              </li>
            ))}
          </ul>
          <p className={styles.help}>{t("rythms_domain_help")}</p>
        </section>
      )}
      {tab === "calendars" && <CalendarPanel />}
    </main>
  );
}
