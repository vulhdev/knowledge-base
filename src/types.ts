export type ContentType = "idea" | "spec" | "plan" | "digest" | "doc";

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

export type CreateContentResult = {
  id: number;
  workspace: string;
  feature: string;
  type: ContentType;
  title: string | null;
  created_at: string;
};
