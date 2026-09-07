"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { useEffect, useState } from "react";
import type { WorkspaceMutation } from "./schema";
import type { WorkspaceData } from "./service";
import styles from "./workspace.module.css";

export default function CompanyPeople({
  company,
  data,
  busy,
  onSave,
}: {
  company: WorkspaceData["companies"][number];
  data: WorkspaceData;
  busy: boolean;
  onSave: (input: WorkspaceMutation) => Promise<void>;
}) {
  const { t } = useLocale();
  const isOwner = company.ownerId === data.user?.id;
  const [email, setEmail] = useState("");
  const [removeId, setRemoveId] = useState<number | null>(null);
  const [ids, setIds] = useState<number[]>([]);
  const [shared, setShared] = useState(true);
  useEffect(() => {
    const ownEvents = company.eventTypes.filter((event) => data.events.some((own) => own.id === event.id));
    setIds(ownEvents.map((event) => event.id));
    setShared(ownEvents.every((event) => !event.useEventLevelSelectedCalendars));
  }, [company.eventTypes, data.events]);

  return (
    <details className={styles.people}>
      <summary>
        {t("rythms_people_and_meetings")} · {company.members.length + 1}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            action: "setCompanyMeetings",
            companyId: company.id,
            eventTypeIds: ids,
            sharedConflictChecks: shared,
          });
        }}>
        <fieldset disabled={busy}>
          <legend>{t("rythms_your_company_meetings")}</legend>
          {!data.events.length && <p>{t("rythms_no_event_types")}</p>}
          {data.events.map((event) => (
            <label key={event.id} className={styles.eventOption}>
              <input
                type="checkbox"
                checked={ids.includes(event.id)}
                onChange={(e) =>
                  setIds(e.target.checked ? [...ids, event.id] : ids.filter((id) => id !== event.id))
                }
              />
              <span>{event.title}</span>
            </label>
          ))}
          <label className={styles.check}>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            {t("rythms_shared_conflicts")}
          </label>
          <button type="submit" className={styles.secondary}>
            {t("save")}
          </button>
        </fieldset>
      </form>
      <h4>{t("rythms_members")}</h4>
      <p>{t("rythms_members_privacy")}</p>
      <ul className={styles.memberList}>
        {company.members.map((member) => (
          <li key={member.userId}>
            <span>{member.user.name || member.user.username || t("rythms_member")}</span>
            {isOwner &&
              (removeId === member.userId ? (
                <span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onSave({ action: "removeMember", companyId: company.id, userId: member.userId })
                    }>
                    {t("rythms_confirm_remove")}
                  </button>
                  <button type="button" onClick={() => setRemoveId(null)}>
                    {t("cancel")}
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setRemoveId(member.userId)}>
                  {t("remove")}
                </button>
              ))}
          </li>
        ))}
      </ul>
      {isOwner && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSave({ action: "inviteMember", companyId: company.id, email });
            }}>
            <fieldset disabled={busy}>
              <label>
                {t("rythms_invite_email")}
                <input
                  required
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <p>{t("rythms_invite_help")}</p>
              <button className={styles.secondary} type="submit">
                {t("rythms_create_invite")}
              </button>
            </fieldset>
          </form>
          <ul className={styles.memberList}>
            {data.invitations
              .filter((invite) => invite.companyId === company.id)
              .map((invite) => (
                <li key={invite.id}>
                  <span>{invite.email}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onSave({ action: "revokeInvitation", companyId: company.id, id: invite.id })
                    }>
                    {t("rythms_revoke")}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </details>
  );
}
