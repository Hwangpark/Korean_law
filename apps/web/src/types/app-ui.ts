export type RuntimeTimelineItem = {
  agentId: string;
  label: string;
  description: string;
  status: 'pending' | 'active' | 'done';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
};

export type AnalysisRunSnapshot = {
  inputMode: 'text' | 'image';
  contextType: string;
  submittedAt: string;
  textLength: number;
  imageName?: string;
};

export type DetailReference = {
  kind?: string;
  title: string;
  summary: string;
  url?: string;
  href?: string;
  subtitle?: string;
};

export type DetailQueryRef = {
  text: string;
  bucket?: string;
  channel?: string;
  sources: string[];
  issueTypes: string[];
  legalElementSignals: string[];
};

export type DetailGrounding = {
  citationId?: string;
  lawReferenceId?: string;
  precedentReferenceIds: string[];
  referenceId?: string;
  referenceKey?: string;
  matchReason?: string;
  snippetField?: string;
  snippetText?: string;
  evidenceCount?: number;
  queryRefs: DetailQueryRef[];
};

export type DetailPanelData = {
  eyebrow: string;
  title: string;
  summary: string;
  metadata: Array<{ label: string; value: string }>;
  highlights: string[];
  references: DetailReference[];
  provenance?: DetailGrounding | null;
};
