import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = {
  color: string;
  size?: number;
};

function wrap(size: number, children: ReactNode) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </Svg>
  );
}

const stroke = (color: string) => ({
  stroke: color,
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/** Lucide-style settings cog. */
export function IconSettings({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        {...stroke(color)}
      />
      <Circle cx="12" cy="12" r="3" {...stroke(color)} />
    </>,
  );
}

export function IconShield({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <Path
      d="M12 22s8-4 8-14V5l-8-3-8 3v7c0 10 8 14 8 14z"
      {...stroke(color)}
    />,
  );
}

export function IconExport({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path d="M12 3v12" {...stroke(color)} />
      <Path d="M8 7l4-4 4 4" {...stroke(color)} />
      <Path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" {...stroke(color)} />
    </>,
  );
}

export function IconUnlink({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" {...stroke(color)} />
      <Path d="M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" {...stroke(color)} />
      <Path d="M8 2l1.5 5" {...stroke(color)} />
      <Path d="M14.5 17l1.5 5" {...stroke(color)} />
      <Path d="M2 8l5 1.5" {...stroke(color)} />
      <Path d="M17 14.5l5 1.5" {...stroke(color)} />
    </>,
  );
}

export function IconTrash({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path d="M4 7h16" {...stroke(color)} />
      <Path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" {...stroke(color)} />
      <Path d="M7 7l1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13" {...stroke(color)} />
    </>,
  );
}

export function IconChevronRight({ color, size = 18 }: IconProps) {
  return wrap(size, <Path d="M9 6l6 6-6 6" {...stroke(color)} />);
}

export function IconPin({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path
        d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"
        {...stroke(color)}
      />
      <Circle cx="12" cy="10" r="3" {...stroke(color)} />
    </>,
  );
}

export function IconRefresh({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path d="M21 12a9 9 0 1 1-2.6-6.4" {...stroke(color)} />
      <Path d="M21 3v6h-6" {...stroke(color)} />
    </>,
  );
}

export function IconMonitor({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Circle cx="12" cy="12" r="2" {...stroke(color)} />
      <Path d="M4.9 19.1a10 10 0 0 1 0-14.2" {...stroke(color)} />
      <Path d="M19.1 4.9a10 10 0 0 1 0 14.2" {...stroke(color)} />
    </>,
  );
}

/** Bound notebook — a log, not another circular arrow. */
export function IconLog({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path d="M2 6h4" {...stroke(color)} />
      <Path d="M2 10h4" {...stroke(color)} />
      <Path d="M2 14h4" {...stroke(color)} />
      <Path d="M2 18h4" {...stroke(color)} />
      <Rect x="4" y="2" width="16" height="20" rx="2" {...stroke(color)} />
      <Path d="M9.5 8h5" {...stroke(color)} />
      <Path d="M9.5 12H16" {...stroke(color)} />
      <Path d="M9.5 16H14" {...stroke(color)} />
    </>,
  );
}

export function IconInfo({ color, size = 18 }: IconProps) {
  return wrap(
    size,
    <>
      <Circle cx="12" cy="12" r="9" {...stroke(color)} />
      <Path d="M12 16v-4" {...stroke(color)} />
      <Path d="M12 8h.01" {...stroke(color)} />
    </>,
  );
}

export function IconShare({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" {...stroke(color)} />
      <Path d="M16 6l-4-4-4 4" {...stroke(color)} />
      <Path d="M12 2v13" {...stroke(color)} />
    </>,
  );
}

export function IconDownload({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path d="M12 3v12" {...stroke(color)} />
      <Path d="M8 11l4 4 4-4" {...stroke(color)} />
      <Path d="M5 21h14" {...stroke(color)} />
    </>,
  );
}

export function IconPerson({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Circle cx="12" cy="8" r="3.2" {...stroke(color)} />
      <Path d="M5 19.2c.8-3.2 3.2-5 7-5s6.2 1.8 7 5" {...stroke(color)} />
    </>,
  );
}

export function IconQr({ color, size = 22 }: IconProps) {
  return wrap(
    size,
    <>
      <Path d="M4 4h6v6H4z" {...stroke(color)} />
      <Path d="M14 4h6v6h-6z" {...stroke(color)} />
      <Path d="M4 14h6v6H4z" {...stroke(color)} />
      <Path d="M14 14h2v2h-2z" {...stroke(color)} />
      <Path d="M18 14h2v2h-2z" {...stroke(color)} />
      <Path d="M14 18h2v2h-2z" {...stroke(color)} />
      <Path d="M18 18h2v2h-2z" {...stroke(color)} />
    </>,
  );
}

export function IconGoogleMark({ color, size = 18 }: IconProps) {
  return wrap(
    size,
    <Path
      d="M12 11.2v2.4h5.5c-.2 1.4-1.6 4-5.5 4A6.2 6.2 0 1 1 12 5.8c1.6 0 2.7.7 3.3 1.3l2.2-2.1C16.2 3.7 14.3 2.8 12 2.8 6.9 2.8 2.8 6.9 2.8 12S6.9 21.2 12 21.2c5.3 0 8.8-3.7 8.8-8.9 0-.6 0-1-.1-1.5H12z"
      fill={color}
      stroke="none"
    />,
  );
}
