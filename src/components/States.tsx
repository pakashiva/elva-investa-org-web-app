import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

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
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [message]);
  if (dismissed) return null;
  return (
    <div className="error-box" role="alert">
      <span className="flash-message-text">{message}</span>
      {onRetry ? (
        <button type="button" className="retry-btn" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      <button type="button" className="flash-dismiss" aria-label="Dismiss message" title="Dismiss" onClick={() => setDismissed(true)}>×</button>
    </div>
  );
}

export function FlashMessage({
  children,
  tone,
  style,
}: {
  children: ReactNode;
  tone?: 'success';
  style?: CSSProperties;
}) {
  const message = String(children ?? '');
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [message]);
  if (dismissed) return null;
  return <div className={`notice-box${tone ? ` ${tone}` : ''}`} style={style} role="status">
    <span className="flash-message-text">{children}</span>
    <button type="button" className="flash-dismiss" aria-label="Dismiss message" title="Dismiss" onClick={() => setDismissed(true)}>×</button>
  </div>;
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="card state-box">
      <p>{label}</p>
    </div>
  );
}
