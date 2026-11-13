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
