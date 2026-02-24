import { icon } from '/js/core/icons.js';
import { _settingCard } from '/js/settings/settings-helpers.js';
import { _browseDownloads, _formatBytes, clearBrowseDownloads, openDownloadFile, showDownloadInFolder, removeBrowseDownload } from '/js/browse/browse-download-mgr.js';

export function _renderDownloadsSettings() {
  const completedSvg = icon('fileCheckmark', { size: 16 });
  const fileSvg = icon('filePlain', { size: 16 });
  const folderSvg = icon('folder', { size: 14 });
  const closeSvg = icon('close', { size: 14 });

  if (_browseDownloads.length === 0) {
    return VStack([
      _settingCard(null, [
        EmptyState('No downloads yet', 'Files you download in the browser will appear here.')
      ])
    ]);
  }

  const clearBtn = Button('Clear all').className('nr-btn nr-btn-ghost nr-btn-sm')
    .onTap(function() { clearBrowseDownloads(); _refreshDownloadsSettings(); });

  const header = HStack([Spacer(), clearBtn]).cssText('margin-bottom:8px;');

  const rows = _browseDownloads.map(function(dl) {
    const iconEl = RawHTML(dl.state === 'completed' ? completedSvg : fileSvg)
      .cssText('flex-shrink:0;color:var(--nr-text-tertiary);');

    const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
    const size = dl.totalBytes > 0 ? _formatBytes(dl.totalBytes) : '';
    const status = dl.state === 'completed' ? 'Completed' + (size ? ' \u00b7 ' + size : '')
      : dl.state === 'cancelled' ? 'Cancelled'
      : pct + '% \u00b7 ' + _formatBytes(dl.receivedBytes) + (dl.totalBytes > 0 ? ' / ' + size : '');

    const date = dl.startTime ? new Date(dl.startTime).toLocaleString() : '';

    const infoChildren = [
      Text(dl.filename || 'Download').className('nr-settings-row-label').cssText('word-break:break-all;'),
      Text(status + (date ? ' \u00b7 ' + date : '')).className('nr-settings-row-desc')
    ];
    if (dl.state === 'progressing') {
      const bar = new View('div').cssText('height:3px;border-radius:2px;background:var(--nr-accent);width:' + pct + '%;transition:width 0.3s;');
      const track = new View('div').cssText('height:3px;border-radius:2px;background:var(--nr-bg-tertiary);margin-top:4px;').add(bar);
      infoChildren.push(track);
    }
    const info = VStack(infoChildren).cssText('flex:1;min-width:0;');

    const actionChildren = [];
    if (dl.state === 'completed') {
      actionChildren.push(
        new View('button').className('nr-btn nr-btn-ghost nr-btn-sm').attr('title', 'Open file')
          .onTap(function(e) { e.stopPropagation(); openDownloadFile(dl.id); })
          .add(RawHTML(icon('download', { size: 14 })))
      );
      actionChildren.push(
        new View('button').className('nr-btn nr-btn-ghost nr-btn-sm').attr('title', 'Show in folder')
          .onTap(function(e) { e.stopPropagation(); showDownloadInFolder(dl.id); })
          .add(RawHTML(folderSvg))
      );
    }
    actionChildren.push(
      new View('button').className('nr-btn nr-btn-ghost nr-btn-sm').attr('title', 'Remove')
        .onTap(function(e) { e.stopPropagation(); removeBrowseDownload(dl.id); _refreshDownloadsSettings(); })
        .add(RawHTML(closeSvg))
    );
    const actions = HStack(actionChildren).spacing(2).cssText('flex-shrink:0;');

    return HStack([iconEl, info, actions]).spacing(12).alignment('center')
      .className('nr-settings-group-row')
      .cssText('cursor:pointer;')
      .onTap(function() { openDownloadFile(dl.id); });
  });

  return VStack([
    header,
    _settingCard(null, rows)
  ]);
}

function _refreshDownloadsSettings() {
  // Force Switch re-render by toggling the section signal
  if (window._setSettingsSection) {
    window._setSettingsSection('_force');
    requestAnimationFrame(function() { window._setSettingsSection('downloads'); });
  }
}

