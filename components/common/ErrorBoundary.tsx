import React from 'react';
import Button from './Button';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface text-gray-100 p-6">
          <div className="max-w-md w-full bg-surface-elevated border border-border-subtle rounded-card p-6 text-center">
            <h1 className="text-xl font-semibold text-white mb-2">문제가 발생했습니다</h1>
            <p className="text-gray-300 mb-6">페이지를 새로고침해주세요.</p>
            <Button variant="primary" size="lg" onClick={this.handleReload}>
              새로고침
            </Button>
            {this.state.error && (
              <details className="mt-4 text-left text-xs text-gray-400">
                <summary className="cursor-pointer">에러 상세</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
