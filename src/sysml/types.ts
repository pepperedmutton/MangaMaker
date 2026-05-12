export type SysmlValidatorProvider = "official-pilot" | "unavailable";

export type SysmlConfig = {
  enabled: boolean;
  provider: SysmlValidatorProvider;
  version: string | null;
  reason?: string;
  javaConfigured: boolean;
  pilotJarConfigured: boolean;
  libraryConfigured: boolean;
  helperConfigured: boolean;
};

export type SysmlFileMeta = {
  path: string;
  size: number;
  updatedAt: string;
  hash: string;
};

export type SysmlFile = SysmlFileMeta & {
  content: string;
};

export type SysmlRepositoryManifest = {
  projectId: string;
  root: string;
  initialized: boolean;
  files: SysmlFileMeta[];
};

export type SysmlDiagnosticSeverity = "ERROR" | "WARNING" | "INFO" | "IGNORE" | string;

export type SysmlDiagnostic = {
  severity: SysmlDiagnosticSeverity;
  message: string;
  line: number | null;
  column: number | null;
  syntax: boolean;
};

export type SysmlValidationFileInput = {
  path: string;
  content: string;
};

export type SysmlValidationResult = {
  ok: boolean;
  provider: SysmlValidatorProvider;
  durationMs: number;
  issueCount: number;
  issues: SysmlDiagnostic[];
  exception: string | null;
  validatedFiles: string[];
  sourceHash: string;
  reason?: string;
};

export type SysmlWriteResult = {
  saved: boolean;
  changed: boolean;
  alreadyApplied: boolean;
  operationId: string;
  file: SysmlFile;
};
