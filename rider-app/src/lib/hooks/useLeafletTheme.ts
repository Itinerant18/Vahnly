/**
 * useLeafletTheme — returns the correct CartoDB tile URL
 * based on the current [data-theme] on <html>.
 *
 * Usage:
 *   const { tileUrl, tileAttribution } = useLeafletTheme();
 *   <TileLayer url={tileUrl} attribution={tileAttribution} />
 */
'use client';
import { useState, useEffect } from 'react';

const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function isDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function useLeafletTheme() {
  const [dark, setDark] = useState(isDark);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(isDark());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return {
    tileUrl: dark ? TILE_DARK : TILE_LIGHT,
    tileAttribution: ATTRIBUTION,
    isDark: dark,
  };
}
