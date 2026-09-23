type StateBoxProps = {
  title: string;
  message: string;
};

export function EmptyState({ title, message }: StateBoxProps) {
  return (
    <div className="card state-box">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      {message}
      {onRetry ? (
        <button type="button" className="retry-btn" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="card state-box">
      <p>{label}</p>
    </div>
  );
}
