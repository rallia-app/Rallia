'use client';

import { useEffect, useRef } from 'react';

interface EnzuzoEmbedProps {
  scriptUrl: string;
}

function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

/**
 * Strip Enzuzo's inline background styles from wrapper divs
 * and apply dark mode styles to form controls.
 *
 * Enzuzo injects content as a sibling to its <script> tag (via insertAfter),
 * so we must target the whole container, not just #__enzuzo-root.
 */
function applyThemeOverrides(container: HTMLElement) {
  const dark = isDarkMode();

  // Strip background from all divs (the band behind selectors)
  container.querySelectorAll('div').forEach(div => {
    div.style.setProperty('background-color', 'transparent', 'important');
    div.style.setProperty('background', 'transparent', 'important');
  });

  // Hide the locale selector (redundant — locale is controlled by the app)
  const selects = container.querySelectorAll<HTMLSelectElement>('select');
  selects.forEach((el, index) => {
    // The second select is the locale selector
    if (index === 1) {
      const wrapper = el.closest('div') || el.parentElement;
      if (wrapper) {
        wrapper.style.setProperty('display', 'none', 'important');
      } else {
        el.style.setProperty('display', 'none', 'important');
      }
    }
  });

  // Style remaining form controls for dark mode
  const controls = container.querySelectorAll<HTMLElement>('select, input, button');
  controls.forEach(el => {
    if (dark) {
      el.style.setProperty('background-color', '#262626', 'important');
      el.style.setProperty('color', '#e5e5e5', 'important');
      el.style.setProperty('border-color', '#404040', 'important');
    } else {
      el.style.removeProperty('background-color');
      el.style.removeProperty('color');
      el.style.removeProperty('border-color');
    }
  });
}

export function EnzuzoEmbed({ scriptUrl }: EnzuzoEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const root = document.createElement('div');
    root.id = '__enzuzo-root';
    container.appendChild(root);

    const script = document.createElement('script');
    script.id = '__enzuzo-root-script';
    script.src = scriptUrl;
    container.appendChild(script);

    // Enzuzo injects content as a sibling to the script tag (not inside
    // #__enzuzo-root), so we observe the whole container for changes.
    // Debounce to avoid running on every individual DOM mutation.
    let debounceTimer: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applyThemeOverrides(container), 50);
    });
    observer.observe(container, { childList: true, subtree: true });

    // Also react to theme changes (dark/light toggle)
    const themeObserver = new MutationObserver(() => {
      applyThemeOverrides(container);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      clearTimeout(debounceTimer);
      observer.disconnect();
      themeObserver.disconnect();
      container.innerHTML = '';
    };
  }, [scriptUrl]);

  return <div ref={containerRef} className="w-full min-h-[60vh]" />;
}
