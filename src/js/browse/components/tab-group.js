// browse/components/tab-group.js — Tab group chip component
// Renders a collapsible group of tabs with name, color, and count

(function() {
  'use strict';
  if (!window.AetherUI) return;
  AetherUI.globals();

  /**
   * BrowseTabGroup(group, tabs, onToggleCollapse, onContextMenu)
   * @param {Object} group - Group object: { id, name, color, collapsed }
   * @param {Array} tabs - Tab objects in this group
   * @param {Function} onToggleCollapse - Called to toggle collapse state
   * @param {Function} onContextMenu - Called for context menu (rename, delete, etc.)
   * @returns {View} - AetherUI HStack component (pill-like)
   */
  function BrowseTabGroup(group, tabs, onToggleCollapse, onContextMenu) {
    if (!group || !tabs) return null;

    const isCollapsed = group.collapsed;
    const count = tabs.length;
    const colorVar = _BROWSE_GROUP_COLOR_MAP[group.color] || '#808080';

    // Group chip: [color dot] [name] [count] [chevron]
    const chip = HStack(
      // Color indicator dot
      new View('div')
        .set('style', `width:8px;height:8px;border-radius:50%;background:${colorVar};`)
        .className('browse-group-color-dot'),

      // Group name
      Text(group.name || 'Group')
        .className('font-medium text-sm')
        .frame({ maxWidth: 120 }),

      // Count badge
      Text(count.toString())
        .className('text-quaternary text-xs')
        .padding(0, 2)
        .background('surface')
        .cornerRadius('sm'),

      Spacer(),

      // Chevron (collapse indicator)
      Text(isCollapsed ? '▶' : '▼')
        .className('text-tertiary text-xs')
    )
      .spacing(2)
      .padding(2, 3)
      .alignment('center')
      .background('surface')
      .cornerRadius('md')
      .className('browse-tab-group-chip')
      .className(isCollapsed ? 'browse-tab-group-collapsed' : '');

    // Single tap to toggle collapse
    chip.onTap(() => {
      if (onToggleCollapse) onToggleCollapse();
    });

    // Right-click for context menu (rename, delete, etc.)
    if (onContextMenu) {
      chip.el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      });
    }

    return chip;
  }

  window.BrowseTabGroup = BrowseTabGroup;
})();
