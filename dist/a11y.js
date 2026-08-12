/* Accessibility bridge (WCAG 2.2).
 *
 * The UI is compiled from minified bundles with no source in this checkout, so
 * these enhancements are applied at runtime on top of the built markup:
 *   1. Name form controls whose visible <label>/text is not programmatically
 *      associated (WCAG 3.3.2 / axe `label`, `select-name`).
 *   2. Give icon-only <button title="…"> elements an accessible name from
 *      their title (WCAG 1.1.1 / axe `button-name`).
 *   3. Treat the chat conversation as a polite live log region (WCAG 4.1.3).
 *   4. Add a keyboard skip link to the main control (WCAG 2.4.1), including
 *      the styles it needs (some pages ship no stylesheet of their own).
 *   5. Ensure a visible keyboard focus indicator (WCAG 2.4.7 / 1.4.11).
 *
 * The script is idempotent and re-applies whenever the DOM changes (React
 * re-renders), guarded so it never fights the app or loops.
 */
(function () {
  'use strict';

  // 5. Injectable styles for pages that ship no stylesheet (e.g. options.html).
  if (!document.getElementById('a11y-styles')) {
    var style = document.createElement('style');
    style.id = 'a11y-styles';
    style.textContent =
      '.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
      '.a11y-skip:focus{position:static;width:auto;height:auto;margin:0;clip:auto;white-space:normal;padding:8px 12px;background:#c96442;color:#fff;border-radius:0 0 8px 0;z-index:999}' +
      ':focus-visible{outline:2px solid #c96442;outline-offset:2px}' +
      ':focus{scroll-margin-block:16px}';
    document.head.appendChild(style);
  }

  function nameFromLabel(el) {
    // Walk up the ancestor chain; at each level only consider <label> elements
    // that are DIRECT children of that ancestor, so unrelated labels elsewhere
    // on the page (e.g. another settings section) never get picked.
    var node = el;
    for (var depth = 0; depth < 4 && node; depth++) {
      var parent = node.parentElement;
      if (!parent) break;
      var kids = parent.children;
      for (var i = 0; i < kids.length; i++) {
        var lbl = kids[i];
        if (lbl.tagName === 'LABEL' && lbl !== el && !lbl.contains(el) && lbl.textContent && lbl.textContent.trim()) {
          return lbl;
        }
      }
      node = parent;
    }
    return null;
  }

  function patch() {
    // 1. Name unlabeled form controls.
    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'hidden') return;
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
      if (el.closest('label')) return; // wrapped label already provides a name
      if (el.classList && el.classList.contains('input-textarea')) {
        el.setAttribute('aria-label', 'Message');
        return;
      }
      var lbl = nameFromLabel(el);
      if (lbl) {
        var text = lbl.textContent.trim().replace(/:.*$/, '').trim();
        if (text) el.setAttribute('aria-label', text);
        return;
      }
      // Fallback: a non-interactive text sibling preceding the control.
      var container = el.parentElement;
      if (container) {
        var kids = Array.prototype.slice.call(container.children);
        for (var j = 0; j < kids.length; j++) {
          var kid = kids[j];
          if (kid === el) break;
          if (kid.tagName === 'INPUT' || kid.tagName === 'SELECT' || kid.tagName === 'TEXTAREA' || kid.tagName === 'BUTTON') continue;
          var t = (kid.textContent || '').trim();
          if (t && t.length < 80) { el.setAttribute('aria-label', t.replace(/:.*$/, '').trim()); break; }
        }
      }
    });

    // 2. Icon-only buttons: accessible name from title.
    document.querySelectorAll('button[title]').forEach(function (b) {
      if (!b.getAttribute('aria-label') && !b.textContent.trim()) {
        b.setAttribute('aria-label', b.title);
      }
    });

    // 3. Chat conversation is a polite live region.
    var chat = document.querySelector('.chat');
    if (chat && !chat.hasAttribute('role')) {
      chat.setAttribute('role', 'log');
      chat.setAttribute('aria-live', 'polite');
    }

    // 4. Skip link for keyboard users (only once the app has rendered, so the
    //    page type and target can be determined correctly).
    var isPanel = !!document.querySelector('textarea.input-textarea');
    var appRendered = isPanel || !!document.querySelector('h2');
    if (!document.getElementById('a11y-skip') && appRendered) {
      var targetId = isPanel ? 'a11y-composer' : 'a11y-first-control';
      var skip = document.createElement('a');
      skip.id = 'a11y-skip';
      skip.href = '#' + targetId;
      skip.className = 'visually-hidden a11y-skip';
      skip.textContent = isPanel ? 'Skip to message input' : 'Skip to settings';
      document.body.insertBefore(skip, document.body.firstChild);
      if (isPanel) {
        var ta = document.querySelector('textarea.input-textarea');
        if (ta && !ta.id) ta.id = targetId;
      } else {
        var first = document.querySelector('input, select, textarea, button[type=submit]');
        if (first && !first.id) first.id = targetId;
      }
    }
  }

  patch();
  if (window.MutationObserver) {
    var mo = new MutationObserver(patch);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'role', 'class', 'id']
    });
  }
})();
