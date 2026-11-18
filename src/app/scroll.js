/** Scroll the document while respecting the user's motion preference. */
export function scrollPageToTop(smooth = false) {
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  globalThis.scrollTo?.({
    top: 0,
    left: 0,
    behavior: smooth && !reducedMotion ? 'smooth' : 'instant',
  });
}

/** Content refreshes and dialogs keep their place until the view or page changes. */
export function createNavigationScrollHandler(scrollToTop = scrollPageToTop) {
  let previousView = null;
  let previousPage = null;

  return ({ view, page }) => {
    if (previousView !== null && (view !== previousView || page !== previousPage)) {
      scrollToTop();
    }
    previousView = view;
    previousPage = page;
  };
}

/** Keep the floating control out of the footer and the mobile navigation. */
export function createBackToTopController({ root, viewport = globalThis, threshold = 240 }) {
  let frame = null;
  const resizeObserver = viewport.ResizeObserver ? new viewport.ResizeObserver(schedule) : null;

  function update() {
    const button = root.querySelector('#back-to-top');
    if (!button) return;
    const height = viewport.innerHeight;
    const footer = root.querySelector('.footer')?.getBoundingClientRect();
    const navigation = root.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    const navigationBottom = navigation?.height > 0 ? height - navigation.top + 12 : 20;
    const footerBottom = footer?.height > 0 ? height - footer.top + 12 : 0;
    const bottom = Math.max(navigationBottom, footerBottom);
    const scrollTop = viewport.scrollY ?? root.ownerDocument?.scrollingElement?.scrollTop ?? 0;
    button.style.setProperty('--back-to-top-offset', `${Math.ceil(bottom)}px`);
    // If a very short viewport has no free space above the footer, hide the control.
    button.hidden = scrollTop <= threshold || bottom + 60 > height;
  }
  function schedule() {
    if (frame !== null) return;
    frame = viewport.requestAnimationFrame(() => {
      frame = null;
      update();
    });
  }
  function refresh() {
    resizeObserver?.disconnect();
    for (const selector of ['.footer', '.mobile-bottom-nav']) {
      const element = root.querySelector(selector);
      if (element) resizeObserver?.observe(element);
    }
    update();
  }
  viewport.addEventListener('scroll', schedule, { passive: true });
  viewport.addEventListener('resize', schedule);
  return {
    refresh,
    destroy() {
      viewport.removeEventListener('scroll', schedule);
      viewport.removeEventListener('resize', schedule);
      resizeObserver?.disconnect();
      if (frame !== null) viewport.cancelAnimationFrame(frame);
    },
  };
}
