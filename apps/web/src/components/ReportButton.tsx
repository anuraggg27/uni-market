import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { reportReasons } from "@campus-market/shared";
import { api, jsonBody } from "../api";
import { SubmitButton } from "./UI";

type TargetType =
  "LISTING" | "USER" | "REVIEW" | "CONVERSATION" | "SUPPORT_RESPONSE";

export function ReportButton({
  targetType,
  targetId,
  label = "Report",
}: {
  targetType: TargetType;
  targetId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: (data: { reason: string; details: string }) =>
      api("/api/reports", {
        method: "POST",
        ...jsonBody({ targetType, targetId, ...data }),
      }),
    onSuccess: () => setOpen(false),
  });

  return (
    <div className="stack">
      <button
        className="button small secondary"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open ? (
        <form
          className="panel form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            mutation.mutate({
              reason: String(data.get("reason")),
              details: String(data.get("details")),
            });
          }}
        >
          <label className="field">
            <span>Reason</span>
            <select name="reason">
              {reportReasons.map((reason) => (
                <option value={reason} key={reason}>
                  {reason.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Details (optional)</span>
            <textarea name="details" maxLength={1500} />
          </label>
          <div className="row">
            <SubmitButton pending={mutation.isPending}>
              Submit report
            </SubmitButton>
            <button
              className="button secondary"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
          {mutation.error ? (
            <p className="field-error">{mutation.error.message}</p>
          ) : null}
        </form>
      ) : null}
      {mutation.isSuccess ? (
        <p role="status">Report submitted for review.</p>
      ) : null}
    </div>
  );
}
