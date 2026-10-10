import React from 'react';

const START_EXIT_MS = 3200;
const REMOVE_MS = 3560;
const FAILSAFE_MS = 5000;

export const AppSplash: React.FC = () => {
  const [isVisible, setIsVisible] = React.useState(true);
  const [isLeaving, setIsLeaving] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const reducedMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (reducedMotion) {
      const reducedTimer = window.setTimeout(() => {
        setIsVisible(false);
      }, 900);

      return () => {
        window.clearTimeout(reducedTimer);
      };
    }

    const exitTimer = window.setTimeout(() => {
      setIsLeaving(true);
    }, START_EXIT_MS);

    const removeTimer = window.setTimeout(() => {
      setIsVisible(false);
    }, REMOVE_MS);

    const failsafeTimer = window.setTimeout(() => {
      setIsVisible(false);
    }, FAILSAFE_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
      window.clearTimeout(failsafeTimer);
    };
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`et-splash ${isLeaving ? 'et-splash--leaving' : ''}`}
      aria-hidden="true"
    >
      <div className="et-splash__simple-stage">
        <img
          className="et-splash__full-logo"
          src="/brand/easytraders-logo.png"
          alt=""
          draggable={false}
        />

        <div className="et-splash__progress-track">
          <div className="et-splash__progress-bar" />
        </div>
      </div>
    </div>
  );
};
