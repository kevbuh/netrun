/* AetherUI Docs — JS */
(function () {
  // Version tracking
  var DOCS_VERSION = '1.1';
  var DOCS_COMMIT = 'a3d7e19';
  var DOCS_DATE = 'Mar 20, 2026';

  var versionEl = document.querySelector('.docs-version');
  if (versionEl) {
    versionEl.textContent = 'v' + DOCS_VERSION + ' \u00B7 ' + DOCS_COMMIT + ' \u00B7 ' + DOCS_DATE;
  }

  // Sidebar active state
  var path = location.pathname;
  var links = document.querySelectorAll('.sidebar a');
  links.forEach(function (a) {
    if (path.endsWith(a.getAttribute('href'))) a.classList.add('active');
  });

  // Mobile sidebar toggle
  var sidebar = document.querySelector('.sidebar');
  var overlay = document.querySelector('.sidebar-overlay');
  var toggle = document.querySelector('.mobile-bar button');

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('open');
  }
  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  }

  if (toggle) toggle.addEventListener('click', openSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  // Copy buttons on code blocks
  document.querySelectorAll('.code-block').forEach(function (block) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function () {
      var code = block.querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.textContent).then(function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      });
    });
    block.appendChild(btn);
  });
})();
