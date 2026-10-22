export type ContentType = string;

export type Content = {
  id: string;
  workspace: string;
  features: string[];
  type: ContentType;
  title: string | null;
  body: string;
  root_id: string | null;
  version_number: number;
  created_at: string;
  updated_at: string;
  has_code_refs: boolean;
};

export type MatchedSection = {
  chunk_key: string; // "<content_id>#3.3.2.1~2" (doc) | "<source_path>#3.3.2.1~2" (SOT)
  heading_path: string; // "H1 › H2 › …"
  start_line: number; // 1-based, inclusive
  end_line: number;
  source_path?: string; // SOT only
  source_commit?: string; // SOT only — read with `git show <commit>:<path>`
};

export type SearchResult = Content & { score: number; matched_sections?: MatchedSection[] };

/** Where an imported row came from: `doc:<ws>:<relPath>[#fork-residue]` or `sot:<sot-ws>:<repoPath>`. */
export type Provenance = { source_key: string; source_sha: string };

export type SearchPage = {
  results: SearchResult[];
  has_more: boolean;
  total_in_pool: number;
  offset: number;
  limit: number;
};

export type ListPage = {
  results: Content[];
  has_more: boolean;
  total: number;
  offset: number;
  limit: number;
};

export type ConflictType = "semantic_contradiction" | "risk_shadow";

export type ConflictResult = {
  content_id: string;
  features: string[];
  type: ConflictType;
  reason: string;
};

export type LinkedContent = {
  id: string;
  workspace: string;
  features: string[];
  type: ContentType;
  title: string | null;
};

export type LineageResult = {
  root: LinkedContent;
  ancestors: LinkedContent[];
  descendants: LinkedContent[];
};

export type SuggestedParent = {
  id: string;
  type: ContentType;
  title: string | null;
  score: number;
};

export type LinkResult = {
  parent_id: string;
  child_id: string;
  created_at: string;
  direction_warning?: string;
};

export type CreateContentResult = {
  id: string;
  workspace: string;
  features: string[];
  type: ContentType;
  title: string | null;
  created_at: string;
  conflicts: ConflictResult[];
  suggested_parents: SuggestedParent[];
};

export type UpdateContentResult = Content & {
  conflicts: ConflictResult[];
};

export type CodeRefFile = {
  path: string;
  start?: number;
  end?: number;
};

export type AttachCodeRefResult = {
  id: number;
  content_id: string;
  task_ref: string | null;
  commit_hash: string;
  file_paths: CodeRefFile[];
  created_at: string;
};

export type GetCodeRefsResult = {
  content_id: string;
  refs: AttachCodeRefResult[];
};

export type VersionSummary = {
  id: string;
  version_number: number;
  is_latest: boolean;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ListVersionsResult = {
  root_id: string;
  versions: VersionSummary[];
};

export type CreateVersionResult = {
  content: Content;
  previous_version_id: string;
};
