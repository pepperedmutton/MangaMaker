import type { AgentToolLogEntry } from "../agent/types";

export const AgentToolLog = ({ logs }: { logs: AgentToolLogEntry[] }) => (
  <section className="agent-tool-log" aria-label="Agent tool log">
    <h3>Tool Log</h3>
    {logs.length === 0 ? (
      <p>No tool calls yet.</p>
    ) : (
      <ul>
        {logs.map((log) => (
          <li key={log.id} className={`agent-tool-log-${log.status}`}>
            <span>{log.label}</span>
            <strong>{log.status}</strong>
            {log.detail ? <small>{log.detail}</small> : null}
          </li>
        ))}
      </ul>
    )}
  </section>
);
