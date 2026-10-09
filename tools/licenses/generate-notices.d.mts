export interface NoticeBuild {
  markdown: string;
  json: string;
}

export function buildNotices(root: string): NoticeBuild;
