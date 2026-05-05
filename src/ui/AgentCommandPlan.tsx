import type { AgentCommandPlan as AgentCommandPlanType } from "../agent/types";

export const AgentCommandPlan = ({
  plan,
  busy,
  onConfirm,
  onCancel,
}: {
  plan: AgentCommandPlanType | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  if (!plan) {
    return null;
  }

  return (
    <section className="agent-plan" aria-label="Pending command plan">
      <div className="agent-plan-header">
        <h3>Command Plan</h3>
        <span>{plan.requiresConfirmation ? "Needs confirmation" : "Auto executable"}</span>
      </div>
      <p>{plan.summary}</p>
      <ol>
        {plan.commands.map((command, index) => (
          <li key={`${command.commandId}-${index}`}>
            <strong>{command.commandId}</strong>
            <span>{command.reason ?? command.dangerLevel ?? "normal"}</span>
          </li>
        ))}
      </ol>
      {plan.requiresConfirmation ? (
        <div className="agent-plan-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );
};
