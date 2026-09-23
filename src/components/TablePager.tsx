import { ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function TablePager({ page, pageCount, total, onPageChange }: Props) {
  const atStart = page <= 1;
  const atEnd = page >= pageCount || total === 0;

  return (
    <div className="pager">
      <button
        type="button"
        className="pager-btn"
        disabled={atStart}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        aria-label="Previous page"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        className="pager-btn"
        disabled={atEnd}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
