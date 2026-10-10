import type { ImportDraft, ParseResult } from '@canglin/shared';

export interface ReviewPage {
  page: number;
  reasons: string[];
  reviewed: boolean;
}

/** The API view and transactional confirmation use the same page-completion rule. */
export function reviewPages(
  result: ParseResult | undefined,
  _aiStatus: string,
  aiPages: { page: number }[],
  draft: ImportDraft | null | undefined,
): ReviewPage[] {
  const count = result?.pageCount ?? Math.max(1, ...aiPages.map((p) => p.page));
  return Array.from({ length: count }, (_, i) => {
    const page = i + 1;
    const reasons: string[] = [];
    if (
      result?.pages?.find((p) => p.page === page)?.status !== 'DONE' &&
      !aiPages.some((p) => p.page === page)
    )
      reasons.push(result?.pageCount ? '识别未完成' : '未能取得页数，请核对原件全部页面');
    return { page, reasons, reviewed: !!draft?.reviewedPages.some((p) => p.page === page) };
  }).filter((p) => p.reasons.length > 0);
}
