import { useEffect, useRef } from "react";
import type { AgentChatMessage } from "../agent/types";

const getSelectedPlainText = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return window.getSelection()?.toString() ?? "";
};

export const AgentMessageList = ({ messages }: { messages: AgentChatMessage[] }) => {
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
      {messages.map((message) => (
        <article key={message.id} className={`agent-message agent-message-${message.role}`}>
          <span className="agent-message-role">{message.role === "user" ? "You" : "Agent"}</span>
          <p>{message.content}</p>
        </article>
      ))}
    </div>
  );
};
