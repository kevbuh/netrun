// browse/components/tab-pill.js — Individual tab pill component
// Renders a single tab with favicon, title, audio indicator, and close button

(function() {
  'use strict';
  if (!window.AetherUI) return; // Fail gracefully if AetherUI not loaded
  AetherUI.globals();

  /**
   * BrowseTabPill(tab, isActive, onSelect, onClose)
   * @param {Object} tab - Tab object: { id, title, favicon, ... }
   * @param {boolean} isActive - Whether this tab is currently selected
   * @param {Function} onSelect - Called when tab is clicked
   * @param {Function} onClose - Called when close button clicked
   * @returns {View} - AetherUI View component
   */
  function BrowseTabPill(tab, isActive, onSelect, onClose) {
    if (!tab) return null;

    // Check if tab has audio (defensive check)
    const hasAudio = typeof _browseAudioTabs !== 'undefined' && _browseAudioTabs && _browseAudioTabs.has(tab.id);

    // Build content: favicon, title, spacer, close button
    const content = HStack(
      // Favicon or default icon
      tab.favicon
        ? new View('img')
            .set('src', tab.favicon)
            .set('alt', 'favicon')
            .frame({ width: 16, height: 16 })
            .className('browse-tab-favicon')
        : Text('🌐')
            .className('text-quaternary text-sm'),

      // Audio indicator (if tab has audio)
      hasAudio
        ? Button()
            .className('browse-audio-indicator')
            .size('xs')
            .ghost()
            .onTap((e) => {
              e.stopPropagation();
              if (typeof _browseToggleMuteTab === 'function') {
                _browseToggleMuteTab(tab.id);
              }
            })
        : null,

      // Title (ellipsis)
      Text(tab.title || 'Untitled')
        .className(isActive ? 'font-medium' : 'text-secondary')
        .frame({ maxWidth: 200, height: 'auto' }),

      Spacer(),

      // Close button (X)
      Button('×')
        .size('xs')
        .ghost()
        .className('browse-tab-close')
        .onTap((e) => {
          e.stopPropagation();
          if (onClose) onClose();
        })
    )
      .spacing(2)
      .padding(2, 3)
      .alignment('center')
      .fill('horizontal');

    // Wrap in pressable container
    const pill = content
      .background(isActive ? 'raised' : 'transparent')
      .cornerRadius('md')
      .className('browse-tab-pill')
      .className(isActive ? 'browse-tab-pill-active' : '');

    // Attach click handler
    pill.onTap(() => {
      if (onSelect) onSelect();
    });

    return pill;
  }

  window.BrowseTabPill = BrowseTabPill;
})();
