import { type ReactNode } from 'react';
import { useMagneticButton } from '../hooks/useMagneticButton';
import { useRippleEffect } from '../hooks/useRippleEffect';

interface MagneticButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  strength?: number;
  ripple?: boolean;
  ariaLabel?: string;
  title?: string;
}

export function MagneticButton({ children, className = '', onClick, strength = 0.25, ripple = true, ariaLabel, title }: MagneticButtonProps) {
  const [btnRef, magneticHandlers] = useMagneticButton(strength);
  const createRipple = useRippleEffect();
  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (ripple) createRipple(e);
    onClick?.();
  };
  return (
    <button type="button" ref={btnRef} className={`magnetic-btn ripple-btn ${className}`} onClick={handleClick} {...magneticHandlers} aria-label={ariaLabel} title={title}>
      {children}
    </button>
  );
}
