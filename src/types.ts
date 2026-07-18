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

export type CreateContentResult = {
  id: number;
  workspace: string;
  feature: string;
  type: ContentType;
  title: string | null;
  created_at: string;
  conflicts: ConflictResult[];
};
