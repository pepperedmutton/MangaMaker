import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import type { ExecuteCommandOptions } from "../state/editorStore";

const COLOR_COMMIT_IDLE_MS = 320;

type DeferredColorInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "onInput"
> & {
  value: string;
  historyKey: string;
  onChange: (value: string, options: ExecuteCommandOptions) => void;
};

export const DeferredColorInput = ({
  value,
  historyKey,
  onChange,
  onBlur,
  disabled,
  ...inputProps
}: DeferredColorInputProps) => {
  const onChangeRef = useRef(onChange);
  const latestValueRef = useRef(value);
  const hasPendingCommitRef = useRef(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hasPendingCommitRef.current) {
      latestValueRef.current = value;
      setLocalValue(value);
    }
  }, [value]);

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const clearPreviewFrame = useCallback(() => {
    if (previewFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
  }, []);

  const commitPending = useCallback(() => {
    clearCommitTimer();
    clearPreviewFrame();
    if (!hasPendingCommitRef.current) {
      return;
    }

    hasPendingCommitRef.current = false;
    onChangeRef.current(latestValueRef.current, {
      historyKey,
      commitHistory: true,
    });
  }, [clearCommitTimer, clearPreviewFrame, historyKey]);

  const scheduleCommit = useCallback(() => {
    clearCommitTimer();
    commitTimerRef.current = setTimeout(commitPending, COLOR_COMMIT_IDLE_MS);
  }, [clearCommitTimer, commitPending]);

  const queuePreview = useCallback(
    (nextValue: string) => {
      latestValueRef.current = nextValue;
      hasPendingCommitRef.current = true;

      if (typeof window === "undefined" || !window.requestAnimationFrame) {
        onChangeRef.current(nextValue, {
          historyKey,
          transient: true,
          persistSession: false,
          suppressStatus: true,
        });
        scheduleCommit();
        return;
      }

      if (previewFrameRef.current === null) {
        previewFrameRef.current = window.requestAnimationFrame(() => {
          previewFrameRef.current = null;
          onChangeRef.current(latestValueRef.current, {
            historyKey,
            transient: true,
            persistSession: false,
            suppressStatus: true,
          });
        });
      }

      scheduleCommit();
    },
    [historyKey, scheduleCommit],
  );

  useEffect(() => {
    return () => {
      commitPending();
    };
  }, [commitPending]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setLocalValue(nextValue);
    queuePreview(nextValue);
  };

  return (
    <input
      {...inputProps}
      disabled={disabled}
      type="color"
      value={localValue}
      onChange={handleChange}
      onBlur={(event) => {
        onBlur?.(event);
        commitPending();
      }}
    />
  );
};
