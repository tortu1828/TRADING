import React from 'react';

const SPLASH_SESSION_KEY = 'easytraders:splash-seen:v1';
const START_EXIT_MS = 1780;
const REMOVE_MS = 2240;
const FAILSAFE_MS = 4000;

const readForceReplay = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    return new URLSearchParams(window.location.search).get('splash') === '1';
  } catch {
    return false;
  }
};

const shouldShowSplash = (): boolean => {
  if (typeof window === 'undefined') return true;

  if (readForceReplay()) {
    return true;
  }

  try {
    return window.sessionStorage.getItem(SPLASH_SESSION_KEY) !== '1';
  } catch {
    return true;
  }
};

const rememberSplash = () => {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
  } catch {
    // El splash nunca debe bloquear la aplicación si storage no está disponible.
  }
};

export const AppSplash: React.FC = () => {
  const [isVisible, setIsVisible] = React.useState<boolean>(shouldShowSplash);
  const [isLeaving, setIsLeaving] = React.useState(false);

  React.useEffect(() => {
    if (!isVisible || typeof window === 'undefined') {
      return;
    }

    const reducedMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (reducedMotion) {
      const reducedTimer = window.setTimeout(() => {
        rememberSplash();
        setIsVisible(false);
      }, 350);

      return () => {
        window.clearTimeout(reducedTimer);
      };
    }

    const exitTimer = window.setTimeout(() => {
      setIsLeaving(true);
    }, START_EXIT_MS);

    const removeTimer = window.setTimeout(() => {
      rememberSplash();
      setIsVisible(false);
    }, REMOVE_MS);

    // Protección adicional: la animación jamás puede dejar la app bloqueada.
    const failsafeTimer = window.setTimeout(() => {
      rememberSplash();
      setIsVisible(false);
    }, FAILSAFE_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
      window.clearTimeout(failsafeTimer);
    };
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`et-splash ${isLeaving ? 'et-splash--leaving' : ''}`}
      aria-hidden="true"
    >
      <div className="et-splash__ambient et-splash__ambient--one" />
      <div className="et-splash__ambient et-splash__ambient--two" />

      <div className="et-splash__stage">
        <div className="et-splash__logo-wrap">
          <div className="et-splash__halo" />

          <img
            className="et-splash__mark"
            src="/brand/easytraders-mark.png"
            alt=""
            draggable={false}
          />

          <div className="et-splash__wordmark-mask">
            <img
              className="et-splash__wordmark"
              src="/brand/easytraders-wordmark.png"
              alt=""
              draggable={false}
            />
          </div>

          <img
            className="et-splash__tagline"
            src="/brand/easytraders-tagline.png"
            alt=""
            draggable={false}
          />

          <div className="et-splash__shine" />
        </div>

        <div className="et-splash__floor-light" />
      </div>
    </div>
  );
};
