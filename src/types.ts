export type ContentType = string;

export type Content = {
  id: number;
  workspace: string;
  feature: string;
  type: ContentType;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
};

export type SearchResult = Content & { score: number };

export type ConflictType = "semantic_contradiction" | "risk_shadow";

export type ConflictResult = {
  content_id: number;
  feature: string;
  type: ConflictType;
  reason: string;
};

export type LinkedContent = {
  id: number;
  workspace: string;
  feature: string;
  type: ContentType;
  title: string | null;
};

export type LineageResult = {
  root: LinkedContent;
  ancestors: LinkedContent[];
  descendants: LinkedContent[];
};

export type SuggestedParent = {
  id: number;
  type: ContentType;
  title: string | null;
  score: number;
};

export type LinkResult = {
  parent_id: number;
  child_id: number;
  created_at: string;
  direction_warning?: string;
};

export type CreateContentResult = {
  id: number;
  workspace: string;
  feature: string;
  type: ContentType;
  title: string | null;
  created_at: string;
  conflicts: ConflictResult[];
  suggested_parents: SuggestedParent[];
};

export type CodeRefFile = {
  path: string;
  start?: number;
  end?: number;
};

export type AttachCodeRefResult = {
  id: number;
  content_id: number;
  task_ref: string | null;
  commit_hash: string;
  file_paths: CodeRefFile[];
  created_at: string;
};

export type GetCodeRefsResult = {
  content_id: number;
  refs: AttachCodeRefResult[];
};
