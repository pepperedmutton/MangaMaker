import { useEffect, useRef } from "react";
import type { AgentConversationEntry } from "../agent/types";

const getSelectedPlainText = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return window.getSelection()?.toString() ?? "";
};

export const AgentMessageList = ({ entries }: { entries: AgentConversationEntry[] }) => {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      const list = listRef.current;
      const selection = window.getSelection();
      if (!list || !selection || selection.isCollapsed) {
        return;
      }
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (
        (anchorNode && !list.contains(anchorNode)) ||
        (focusNode && !list.contains(focusNode))
      ) {
        return;
      }
      const selectedText = getSelectedPlainText();
      if (!selectedText) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.clipboardData?.setData("text/plain", selectedText);
    };

    document.addEventListener("copy", handleCopy, true);
    return () => document.removeEventListener("copy", handleCopy, true);
  }, []);

  return (
    <div ref={listRef} className="agent-message-list" aria-label="Agent messages">
      {entries.map((entry) =>
        entry.kind === "message" ? (
          <article
            key={entry.id}
            className={`agent-message agent-message-${entry.message.role}`}
          >
            <span className="agent-message-role">
              {entry.message.role === "user" ? "You" : "Agent"}
            </span>
            <p>{entry.message.content}</p>
          </article>
        ) : (
          <article
            key={entry.id}
            className={`agent-message agent-message-tool agent-tool-log-${entry.log.status}`}
          >
            <span className="agent-message-role">Tool</span>
            <p>
              <strong>{entry.log.label}</strong>
              <span className="agent-tool-status">{entry.log.status}</span>
            </p>
            {entry.log.detail ? <small className="agent-tool-detail">{entry.log.detail}</small> : null}
          </article>
        ),
      )}
    </div>
  );
};
