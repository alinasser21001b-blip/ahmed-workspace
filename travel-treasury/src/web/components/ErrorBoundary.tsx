import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n.ts';

/**
 * A rendering failure must never blank the screen.
 *
 * This app is read at an ATM, sometimes with the machine still holding the
 * card. A crashed component should cost the traveller one panel, not the whole
 * session — and it must say so in Arabic rather than showing nothing.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No financial values are logged — only the failure itself.
    console.error('[ui]', error.message, info.componentStack?.split('\n')[1]?.trim());
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card">
        <div className="callout danger">
          <span aria-hidden="true" style={{ fontWeight: 700, marginInlineEnd: 6 }}>⚠</span>
          {t('error')}
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="secondary"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}
        >
          {t('retry')}
        </button>
      </div>
    );
  }
}
