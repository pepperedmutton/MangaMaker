import type { AgentChatMessage } from "../agent/types";

export const AgentMessageList = ({ messages }: { messages: AgentChatMessage[] }) => (
  <div className="agent-message-list" aria-label="Agent messages">
    {messages.map((message) => (
      <article key={message.id} className={`agent-message agent-message-${message.role}`}>
        <span className="agent-message-role">{message.role === "user" ? "You" : "Agent"}</span>
        <p>{message.content}</p>
      </article>
    ))}
  </div>
);
