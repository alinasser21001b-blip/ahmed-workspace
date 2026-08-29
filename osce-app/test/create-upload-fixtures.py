from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).parent / "fixtures"
text = ["Pediatrics OSCE 2026", "Dr. Layla Kareem", "Case: Nephrotic Syndrome", "What are the complications of nephrotic syndrome?", "How would you investigate this child?"]

pdf = canvas.Canvas(str(ROOT / "pediatrics-text.pdf"), pagesize=letter)
for index, line in enumerate(text):
    pdf.drawString(72, 720 - index * 24, line)
pdf.showPage()
pdf.drawString(72, 720, "Page two provenance marker")
pdf.save()

pdfmetrics.registerFont(TTFont("ArialUnicode", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"))
bilingual = canvas.Canvas(str(ROOT / "pediatrics-bilingual.pdf"), pagesize=letter)
bilingual.setFont("ArialUnicode", 14)
bilingual.drawString(72, 720, "Pediatrics أطفال OSCE 2026")
bilingual.drawString(72, 696, "Dr. Layla Kareem")
bilingual.drawString(72, 672, "Case: Nephrotic Syndrome")
bilingual.drawString(72, 648, "What are the complications?")
bilingual.save()

image = Image.new("RGB", (1200, 1600), "white")
draw = ImageDraw.Draw(image)
draw.text((90, 120), "Image-only scanned OSCE recollection", fill="black")
image.save(ROOT / "pediatrics-scanned.pdf", "PDF", resolution=150)

xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>""" + "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in text) + "</w:body></w:document>"
content_types = """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"""
with ZipFile(ROOT / "pediatrics-2026.docx", "w", ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", content_types)
    archive.writestr("word/document.xml", xml)
