"""Render the dated internal-review Markdown sources to PDFs."""

import argparse
from html import escape
from pathlib import Path
import xml.etree.ElementTree as ET

import markdown
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, XPreformatted


def inline(node):
    parts = [escape(node.text or "")]
    for child in node:
        content = inline(child)
        if child.tag in ("strong", "b"):
            parts.append(f"<b>{content}</b>")
        elif child.tag in ("em", "i"):
            parts.append(f"<i>{content}</i>")
        elif child.tag == "code":
            parts.append(f'<font name="Courier" size="8.5">{content}</font>')
        elif child.tag == "a":
            href = escape(child.get("href", ""), quote=True)
            parts.append(f'<link href="{href}" color="#326144">{content}</link>')
        elif child.tag == "br":
            parts.append("<br/>")
        else:
            raise ValueError(f"Unsupported inline tag: {child.tag}")
        parts.append(escape(child.tail or ""))
    return "".join(parts)


def footer(canvas, document):
    canvas.setStrokeColor(colors.HexColor("#b5cbb8"))
    canvas.line(48, 42, A4[0] - 48, 42)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#326144"))
    canvas.drawString(48, 29, "AI-assisted internal review - NOT an external / third-party audit")
    canvas.drawRightString(A4[0] - 48, 29, str(document.page))


def render(source):
    styles = getSampleStyleSheet()
    body = ParagraphStyle("ReviewBody", fontName="Helvetica", fontSize=10.2,
                          leading=14.8, spaceAfter=9, textColor=colors.HexColor("#183b32"),
                          alignment=TA_LEFT, splitLongWords=True)
    title = ParagraphStyle("ReviewTitle", parent=body, fontSize=27, leading=33,
                           spaceBefore=28, spaceAfter=24, keepWithNext=True)
    code = ParagraphStyle("ReviewCode", parent=body, fontName="Courier", fontSize=8.1,
                          leading=11, backColor=colors.HexColor("#eff4ec"), borderPadding=8)
    headings = {}
    for level, size in ((2, 15), (3, 12)):
        headings[f"h{level}"] = ParagraphStyle(
            f"ReviewHeading{level}", parent=styles[f"Heading{level}"], fontSize=size,
            leading=size + 5, textColor=colors.HexColor("#183b32"),
            spaceBefore=14, spaceAfter=9, keepWithNext=True)
    root = ET.fromstring("<body>" + markdown.markdown(source.read_text()) + "</body>")
    story = []
    for node in root:
        if node.tag == "h1":
            story.append(Paragraph(inline(node), title))
        elif node.tag in headings:
            story.append(Paragraph(inline(node), headings[node.tag]))
        elif node.tag == "p":
            story.append(Paragraph(inline(node), body))
        elif node.tag in ("ul", "ol"):
            for index, item in enumerate(node, 1):
                marker = f"{index}. " if node.tag == "ol" else "- "
                story.append(Paragraph(marker + inline(item), body))
        elif node.tag == "pre":
            story.append(XPreformatted(escape("".join(node.itertext())), code))
            story.append(Spacer(1, 8))
        elif node.tag == "hr":
            story.append(PageBreak())
        else:
            raise ValueError(f"Unsupported block tag: {node.tag}")
    target = source.with_suffix(".pdf")
    document = SimpleDocTemplate(str(target), pagesize=A4, leftMargin=48, rightMargin=48,
                                 topMargin=42, bottomMargin=58,
                                 title="".join(root.find("h1").itertext()),
                                 author="Tuvyy internal review (AI-assisted)")
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-dir", type=Path)
    args = parser.parse_args()
    for source in sorted(Path(__file__).parent.glob("2026-*.md")):
        target = render(source)
        print(f"PDF generated: {target}")
        if args.image_dir:
            import pymupdf

            args.image_dir.mkdir(parents=True, exist_ok=True)
            with pymupdf.open(target) as pdf:
                image_path = args.image_dir / f"{target.stem}-page-1.png"
                pdf[0].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(image_path)
                print(f"PDF pages: {len(pdf)}; page 1 image: {image_path}")


if __name__ == "__main__":
    main()
