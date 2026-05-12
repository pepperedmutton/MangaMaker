import { useEffect, useMemo, useState } from "react";
import {
  deleteSysmlProjectFile,
  getSysmlConfig,
  listSysmlProjectFiles,
  readSysmlProjectFile,
  validateSysmlProject,
  writeSysmlProjectFile,
} from "../sysml/client";
import type { SysmlConfig, SysmlFile, SysmlRepositoryManifest, SysmlValidationResult } from "../sysml/types";

type SysmlWorkspaceProps = {
  projectId: string;
};

const createOperationId = (path: string) =>
  `sysml-ui-${path.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${Date.now()}`;

export const SysmlWorkspace = ({ projectId }: SysmlWorkspaceProps) => {
  const [config, setConfig] = useState<SysmlConfig | null>(null);
  const [manifest, setManifest] = useState<SysmlRepositoryManifest | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<SysmlFile | null>(null);
  const [draft, setDraft] = useState("");
  const [validation, setValidation] = useState<SysmlValidationResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(() => Boolean(file && draft !== file.content), [draft, file]);

  const refresh = async () => {
    setError(null);
    const [nextConfig, nextManifest] = await Promise.all([
      getSysmlConfig(),
      listSysmlProjectFiles(projectId),
    ]);
    setConfig(nextConfig);
    setManifest(nextManifest);
    if (!selectedPath && nextManifest.files[0]) {
      setSelectedPath(nextManifest.files[0].path);
    }
  };

  useEffect(() => {
    setSelectedPath(null);
    setFile(null);
    setDraft("");
    setValidation(null);
    void refresh().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
  }, [projectId]);

  useEffect(() => {
    if (!selectedPath) {
      setFile(null);
      setDraft("");
      return;
    }
    void readSysmlProjectFile(projectId, selectedPath)
      .then((nextFile) => {
        setFile(nextFile);
        setDraft(nextFile.content);
        setError(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, [projectId, selectedPath]);

  const handleSave = async () => {
    if (!selectedPath) {
      return;
    }
    setStatus("Saving SysML file...");
    setError(null);
    try {
      const result = await writeSysmlProjectFile(projectId, {
        path: selectedPath,
        content: draft,
        operationId: createOperationId(selectedPath),
      });
      setFile(result.file);
      setDraft(result.file.content);
      setStatus(result.changed ? "Saved SysML file." : "No SysML file changes.");
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const handleValidate = async () => {
    setStatus("Validating with SysML v2 Pilot...");
    setError(null);
    try {
      const files = manifest?.files.length
        ? await Promise.all(
            manifest.files.map(async (entry) => {
              if (entry.path === selectedPath) {
                return { path: entry.path, content: draft };
              }
              const sibling = await readSysmlProjectFile(projectId, entry.path);
              return { path: sibling.path, content: sibling.content };
            }),
          )
        : undefined;
      const result = await validateSysmlProject(projectId, files);
      setValidation(result);
      setStatus(result.ok ? "SysML validation passed." : "SysML validation reported issues.");
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : String(validateError));
    }
  };

  const handleNewFile = async () => {
    const fileName = window.prompt("New SysML file path", "model.sysml")?.trim();
    if (!fileName) {
      return;
    }
    setStatus("Creating SysML file...");
    try {
      const result = await writeSysmlProjectFile(projectId, {
        path: fileName,
        content: "package NewMangaModel {\n\tprivate import Parts::*;\n}\n",
        operationId: createOperationId(fileName),
      });
      await refresh();
      setSelectedPath(result.file.path);
      setStatus("Created SysML file.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  };

  const handleDeleteFile = async () => {
    if (!selectedPath) {
      return;
    }
    const confirmed = window.confirm(`Delete ${selectedPath}?`);
    if (!confirmed) {
      return;
    }
    try {
      await deleteSysmlProjectFile(projectId, selectedPath);
      setSelectedPath(null);
      setFile(null);
      setDraft("");
      await refresh();
      setStatus("Deleted SysML file.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  return (
    <section className="sysml-workspace" aria-label="SysML workspace">
      <div className="sysml-sidebar">
        <div className="sysml-toolbar">
          <div>
            <h2>SysML</h2>
            <p className="document-meta">
              {config?.enabled
                ? `Official Pilot ${config.version ?? ""}`
                : config?.reason ?? "Checking validator..."}
            </p>
          </div>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        </div>
        <div className="sysml-file-list">
          {(manifest?.files ?? []).map((entry) => (
            <button
              type="button"
              key={entry.path}
              className={`sysml-file-row${entry.path === selectedPath ? " active" : ""}`}
              onClick={() => setSelectedPath(entry.path)}
            >
              <span className="document-file-name">{entry.path}</span>
              <span className="document-file-meta">{entry.size} bytes</span>
            </button>
          ))}
        </div>
        <div className="sysml-actions">
          <button type="button" onClick={handleNewFile}>New</button>
          <button type="button" disabled={!selectedPath} onClick={handleDeleteFile}>Delete</button>
        </div>
      </div>

      <div className="sysml-editor-pane">
        <div className="document-toolbar">
          <div>
            <h2>{selectedPath ?? "No SysML file selected"}</h2>
            <p className="document-meta">
              {dirty ? "Unsaved changes" : file ? `Hash ${file.hash.slice(0, 12)}` : "Select a file to edit."}
            </p>
          </div>
          <div className="document-toolbar-actions">
            <button type="button" disabled={!selectedPath || !dirty} onClick={handleSave}>Save</button>
            <button type="button" disabled={!selectedPath && !(manifest?.files.length)} onClick={handleValidate}>
              Validate
            </button>
          </div>
        </div>
        {error ? <p className="document-error">{error}</p> : null}
        {status ? <p className="document-meta">{status}</p> : null}
        <textarea
          className="sysml-editor"
          spellCheck={false}
          value={draft}
          disabled={!selectedPath}
          onChange={(event) => setDraft(event.target.value)}
        />
        {validation ? (
          <div className={`sysml-validation${validation.ok ? " ok" : " error"}`}>
            <strong>{validation.ok ? "Validation passed" : "Validation issues"}</strong>
            <span>{validation.provider}; {validation.durationMs} ms; files: {validation.validatedFiles.join(", ")}</span>
            {validation.reason ? <p>{validation.reason}</p> : null}
            {validation.exception ? <p>{validation.exception}</p> : null}
            {validation.issues.length > 0 ? (
              <ul>
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.line ?? "x"}-${issue.column ?? "x"}-${index}`}>
                    {issue.severity} line {issue.line ?? "?"}, col {issue.column ?? "?"}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
};
