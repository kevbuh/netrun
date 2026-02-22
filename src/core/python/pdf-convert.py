#!/usr/bin/env python3
"""PDF conversion engine — single-command script called via spawn.

Usage: python3 pdf-convert.py '<json_arg>'

Commands:
  parse      — Extract all text from PDF
  extract    — Extract text + embedded images
  split      — Extract page subset into new PDF
  merge      — Combine multiple PDFs into one
  compress   — Rewrite PDF with maximum compression
  to-png     — Render pages as PNG images
  to-jpeg    — Render pages as JPEG images
  from-png   — Combine PNG images into a PDF
  from-jpeg  — Combine JPEG images into a PDF
  md-to-pdf  — Convert markdown text to PDF
  to-md      — Extract text with structure as markdown
"""

import sys
import json
import os

import fitz  # PyMuPDF


def cmd_parse(args):
    """Extract all text, return as string."""
    doc = fitz.open(args["input"])
    pages = [doc[i].get_text() for i in range(len(doc))]
    doc.close()
    return {"ok": True, "text": "\n\n---\n\n".join(pages), "pageCount": len(pages)}


def cmd_extract(args):
    """Extract text + embedded images, save images to output dir."""
    doc = fitz.open(args["input"])
    out_dir = args["output"]
    os.makedirs(out_dir, exist_ok=True)

    pages = [doc[i].get_text() for i in range(len(doc))]
    images = []
    for i in range(len(doc)):
        for img_idx, img in enumerate(doc[i].get_images(full=True)):
            xref = img[0]
            base_image = doc.extract_image(xref)
            if not base_image:
                continue
            ext = base_image.get("ext", "png")
            img_path = os.path.join(out_dir, f"page{i+1}_img{img_idx+1}.{ext}")
            with open(img_path, "wb") as f:
                f.write(base_image["image"])
            images.append(img_path)

    doc.close()
    return {"ok": True, "text": "\n\n---\n\n".join(pages), "images": images, "pageCount": len(pages)}


def cmd_split(args):
    """Select specific pages into a new PDF."""
    doc = fitz.open(args["input"])
    page_nums = args["pages"]  # list of 0-based page numbers
    doc.select(page_nums)
    doc.save(args["output"])
    count = len(page_nums)
    doc.close()
    return {"ok": True, "output": args["output"], "pageCount": count}


def cmd_merge(args):
    """Merge multiple PDFs into one."""
    inputs = args["inputs"]  # list of file paths
    output = args["output"]
    result = fitz.open()
    total = 0
    for path in inputs:
        src = fitz.open(path)
        result.insert_pdf(src)
        total += len(src)
        src.close()
    result.save(output)
    result.close()
    return {"ok": True, "output": output, "pageCount": total}


def cmd_compress(args):
    """Compress a PDF with maximum settings."""
    doc = fitz.open(args["input"])
    original_size = os.path.getsize(args["input"])
    doc.save(args["output"], garbage=4, deflate=True, clean=True)
    new_size = os.path.getsize(args["output"])
    page_count = len(doc)
    doc.close()
    return {"ok": True, "output": args["output"], "originalSize": original_size, "newSize": new_size, "pageCount": page_count}


def cmd_to_png(args):
    """Render each page as a PNG image."""
    doc = fitz.open(args["input"])
    out_dir = args["output"]
    os.makedirs(out_dir, exist_ok=True)
    dpi = args.get("dpi", 150)
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    files = []
    for i in range(len(doc)):
        pix = doc[i].get_pixmap(matrix=mat)
        path = os.path.join(out_dir, f"page_{i+1}.png")
        pix.save(path)
        files.append(path)
    doc.close()
    return {"ok": True, "files": files, "pageCount": len(files)}


def cmd_to_jpeg(args):
    """Render each page as a JPEG image."""
    from PIL import Image
    import io

    doc = fitz.open(args["input"])
    out_dir = args["output"]
    os.makedirs(out_dir, exist_ok=True)
    dpi = args.get("dpi", 150)
    quality = args.get("quality", 85)
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    files = []
    for i in range(len(doc)):
        pix = doc[i].get_pixmap(matrix=mat)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        img = img.convert("RGB")
        path = os.path.join(out_dir, f"page_{i+1}.jpg")
        img.save(path, "JPEG", quality=quality)
        files.append(path)
    doc.close()
    return {"ok": True, "files": files, "pageCount": len(files)}


def cmd_from_images(args):
    """Combine images into a single PDF."""
    from PIL import Image

    inputs = args["inputs"]  # list of image file paths
    output = args["output"]
    doc = fitz.open()
    for img_path in inputs:
        img = Image.open(img_path)
        img = img.convert("RGB")
        # Save as temp PNG for fitz
        img_bytes = io.BytesIO()
        img.save(img_bytes, format="PNG")
        img_bytes.seek(0)
        img_doc = fitz.open(stream=img_bytes.read(), filetype="png")
        # Create page with image dimensions
        rect = img_doc[0].rect
        page = doc.new_page(width=rect.width, height=rect.height)
        page.insert_image(rect, stream=img_doc.tobytes())
        img_doc.close()
    doc.save(output)
    page_count = len(doc)
    doc.close()
    return {"ok": True, "output": output, "pageCount": page_count}


def cmd_md_to_pdf(args):
    """Convert markdown text to PDF using fitz Story API."""
    md_text = args.get("text", "")
    if not md_text and args.get("input"):
        with open(args["input"], encoding="utf-8") as f:
            md_text = f.read()

    output = args["output"]

    # Convert markdown to simple HTML for fitz Story
    html = _md_to_html(md_text)

    # Use fitz Story API to render HTML to PDF
    story = fitz.Story(html=html)
    writer = fitz.DocumentWriter(output)
    mediabox = fitz.paper_rect("letter")
    content_rect = mediabox + (36, 36, -36, -36)  # 0.5 inch margins

    while True:
        device = writer.begin_page(mediabox)
        more, _ = story.place(content_rect)
        story.draw(device)
        writer.end_page()
        if not more:
            break

    writer.close()
    return {"ok": True, "output": output}


def cmd_to_md(args):
    """Extract text with structure as markdown."""
    doc = fitz.open(args["input"])
    md_parts = []

    for i in range(len(doc)):
        page = doc[i]
        blocks = page.get_text("dict")["blocks"]
        page_md = []

        for block in blocks:
            if block["type"] == 0:  # text block
                for line in block.get("lines", []):
                    line_text = ""
                    max_size = 0
                    is_bold = False
                    for span in line.get("spans", []):
                        line_text += span["text"]
                        if span["size"] > max_size:
                            max_size = span["size"]
                        if "bold" in span.get("font", "").lower():
                            is_bold = True

                    line_text = line_text.strip()
                    if not line_text:
                        continue

                    # Heuristic heading detection based on font size
                    if max_size >= 20:
                        page_md.append(f"# {line_text}")
                    elif max_size >= 16:
                        page_md.append(f"## {line_text}")
                    elif max_size >= 13 and is_bold:
                        page_md.append(f"### {line_text}")
                    else:
                        page_md.append(line_text)

            elif block["type"] == 1:  # image block
                page_md.append(f"[Image on page {i+1}]")

        md_parts.append("\n\n".join(page_md))

    doc.close()
    md_output = "\n\n---\n\n".join(md_parts)

    if args.get("output"):
        with open(args["output"], "w", encoding="utf-8") as f:
            f.write(md_output)
        return {"ok": True, "output": args["output"], "pageCount": len(md_parts)}

    return {"ok": True, "text": md_output, "pageCount": len(md_parts)}


# ── Helpers ──

import io

def _md_to_html(md):
    """Simple markdown to HTML for fitz Story rendering."""
    lines = md.split("\n")
    html_parts = ['<html><body style="font-family: Helvetica, sans-serif; font-size: 11pt; line-height: 1.5;">']
    in_code = False
    in_list = False

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                html_parts.append("</pre>")
                in_code = False
            else:
                html_parts.append('<pre style="background: #f5f5f5; padding: 8px; font-family: Courier, monospace; font-size: 10pt;">')
                in_code = True
            continue

        if in_code:
            html_parts.append(_esc(line))
            html_parts.append("<br/>")
            continue

        if not stripped:
            if in_list:
                html_parts.append("</ul>")
                in_list = False
            html_parts.append("<br/>")
            continue

        # Headings
        if stripped.startswith("### "):
            html_parts.append(f'<h3>{_esc(stripped[4:])}</h3>')
        elif stripped.startswith("## "):
            html_parts.append(f'<h2>{_esc(stripped[3:])}</h2>')
        elif stripped.startswith("# "):
            html_parts.append(f'<h1>{_esc(stripped[2:])}</h1>')
        elif stripped.startswith("- ") or stripped.startswith("* "):
            if not in_list:
                html_parts.append("<ul>")
                in_list = True
            html_parts.append(f"<li>{_esc(stripped[2:])}</li>")
        elif stripped.startswith("---"):
            html_parts.append("<hr/>")
        else:
            # Inline formatting
            text = _esc(stripped)
            html_parts.append(f"<p>{text}</p>")

    if in_code:
        html_parts.append("</pre>")
    if in_list:
        html_parts.append("</ul>")

    html_parts.append("</body></html>")
    return "\n".join(html_parts)


def _esc(s):
    """Escape HTML entities."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


COMMANDS = {
    "parse": cmd_parse,
    "extract": cmd_extract,
    "split": cmd_split,
    "merge": cmd_merge,
    "compress": cmd_compress,
    "to-png": cmd_to_png,
    "to-jpeg": cmd_to_jpeg,
    "from-png": cmd_from_images,
    "from-jpeg": cmd_from_images,
    "md-to-pdf": cmd_md_to_pdf,
    "to-md": cmd_to_md,
}

if __name__ == "__main__":
    try:
        arg = json.loads(sys.argv[1])
        cmd = arg.get("command")
        if cmd not in COMMANDS:
            result = {"ok": False, "error": f"Unknown command: {cmd}"}
        else:
            result = COMMANDS[cmd](arg)
    except Exception as e:
        result = {"ok": False, "error": str(e)}

    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
