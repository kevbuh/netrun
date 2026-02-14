"""Utility functions - slugify, proxy rewriter."""

import os
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, quote as url_quote


# ── Slugification ──

def slugify(text):
    s = text.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s or 'experiment'


def unique_vault_slug(vault_path, base):
    """Generate a unique slug within a vault directory."""
    slug = base
    i = 2
    while os.path.exists(os.path.join(vault_path, slug)):
        slug = f'{base}-{i}'
        i += 1
    return slug


# ── HTML proxy rewriter ──

def rewrite_proxy_html(html_str, base_url):
    """Rewrite relative URLs in proxied HTML for non-Electron browser mode (CORS proxy).
    Returns processed HTML string."""

    output = []

    class ProxyRewriter(HTMLParser):
        def handle_starttag(self, tag, attrs):
            attrs_dict = dict(attrs)

            # Rewrite relative URLs to absolute
            for url_attr in ('src', 'href', 'action', 'poster'):
                if url_attr in attrs_dict and attrs_dict[url_attr]:
                    val = attrs_dict[url_attr]
                    if not val.startswith(('http://', 'https://', 'data:', 'javascript:', '#', 'mailto:')):
                        attrs_dict[url_attr] = urljoin(base_url, val)

            # Rewrite <img> src through image proxy so images are same-origin
            if tag == 'img' and 'src' in attrs_dict:
                img_src = attrs_dict['src']
                if img_src.startswith(('http://', 'https://')) and not img_src.startswith(('http://localhost', 'https://localhost')):
                    attrs_dict['src'] = '/api/image-proxy?url=' + url_quote(img_src, safe='')
            if tag in ('img', 'source') and 'srcset' in attrs_dict:
                import re as _re
                def _rewrite_srcset_entry(m):
                    url = m.group(1)
                    rest = m.group(2)
                    if url.startswith(('http://', 'https://')) and not url.startswith(('http://localhost', 'https://localhost')):
                        return '/api/image-proxy?url=' + url_quote(url, safe='') + rest
                    return m.group(0)
                attrs_dict['srcset'] = _re.sub(r'(\S+)(\s+[^,]*)', _rewrite_srcset_entry, attrs_dict['srcset'])

            # Rewrite same-origin <a> links to go through proxy
            if tag == 'a' and 'href' in attrs_dict:
                href = attrs_dict['href']
                try:
                    parsed_base = urlparse(base_url)
                    parsed_href = urlparse(href)
                    if parsed_href.hostname and parsed_href.hostname == parsed_base.hostname:
                        attrs_dict['href'] = '/api/browse-proxy?url=' + url_quote(href, safe='')
                except Exception:
                    pass

            attr_str = ''
            for k, v in attrs_dict.items():
                if v is None:
                    attr_str += f' {k}'
                else:
                    attr_str += f' {k}="{v}"'
            output.append(f'<{tag}{attr_str}>')

        def handle_endtag(self, tag):
            output.append(f'</{tag}>')

        def handle_data(self, data):
            output.append(data)

        def handle_comment(self, data):
            output.append(f'<!--{data}-->')

        def handle_decl(self, decl):
            output.append(f'<!{decl}>')

        def handle_pi(self, data):
            output.append(f'<?{data}>')

        def handle_startendtag(self, tag, attrs):
            attrs_dict = dict(attrs)
            for url_attr in ('src', 'href'):
                if url_attr in attrs_dict and attrs_dict[url_attr]:
                    val = attrs_dict[url_attr]
                    if not val.startswith(('http://', 'https://', 'data:', 'javascript:', '#', 'mailto:')):
                        attrs_dict[url_attr] = urljoin(base_url, val)
            attr_str = ''
            for k, v in attrs_dict.items():
                if v is None:
                    attr_str += f' {k}'
                else:
                    attr_str += f' {k}="{v}"'
            output.append(f'<{tag}{attr_str}/>')

    parser = ProxyRewriter(convert_charrefs=False)
    parser.feed(html_str)

    # Inject link context menu script for non-Electron mode
    link_popup_script = """<script>console.log('[aether] link menu script loaded');</script>
<style>
.aether-link-menu{position:fixed;z-index:999999;background:rgba(40,40,40,.98);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:4px 0;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;min-width:220px}
.alm-item{padding:6px 12px;color:rgba(255,255,255,.9);cursor:default;white-space:nowrap;border-radius:4px;margin:0 4px}
.alm-item:hover{background:rgba(255,255,255,.1)}
.alm-sep{height:1px;background:rgba(255,255,255,.1);margin:4px 8px}
</style>
<script>
(function(){
var m=null,u='',t='';
function hide(){if(m){m.remove();m=null}}
function show(e,href,txt){
  hide();u=href;t=txt||'';
  m=document.createElement('div');
  m.className='aether-link-menu';
  var s=t.length>25?t.slice(0,22)+'...':t;
  m.innerHTML='<div class="alm-item" data-a="newtab">Open Link in New Tab</div>'+
    '<div class="alm-item" data-a="here">Open Link Here</div>'+
    '<div class="alm-sep"></div>'+
    '<div class="alm-item" data-a="copy">Copy Link Address</div>'+
    (t?'<div class="alm-item" data-a="copytext">Copy Link Text</div><div class="alm-sep"></div><div class="alm-item" data-a="search">Search Google for "'+s.replace(/"/g,'&quot;')+'"</div>':'');
  m.style.left=e.clientX+'px';m.style.top=e.clientY+'px';
  document.body.appendChild(m);
  var r=m.getBoundingClientRect();
  if(r.right>window.innerWidth)m.style.left=(window.innerWidth-r.width-8)+'px';
  if(r.bottom>window.innerHeight)m.style.top=(window.innerHeight-r.height-8)+'px';
  m.onclick=function(ev){
    var i=ev.target.closest('.alm-item');if(!i)return;
    var a=i.dataset.a;
    if(a==='newtab')window.open(u,'_blank');
    else if(a==='here')location.href=u;
    else if(a==='copy')navigator.clipboard.writeText(u).catch(function(){});
    else if(a==='copytext')navigator.clipboard.writeText(t).catch(function(){});
    else if(a==='search')window.open('https://www.google.com/search?q='+encodeURIComponent(t),'_blank');
    hide();
  };
}
document.addEventListener('click',function(e){
  var a=e.target.closest('a[href]');
  if(a){
    var h=a.getAttribute('href');
    if(h&&h.indexOf('javascript:')!==0&&h.charAt(0)!=='#'){
      e.preventDefault();e.stopPropagation();
      show(e,h,a.textContent.trim());
      return false;
    }
  }
  hide();
},true);
document.addEventListener('keydown',function(e){if(e.key==='Escape')hide();});
})();
</script>"""

    return link_popup_script + ''.join(output)
