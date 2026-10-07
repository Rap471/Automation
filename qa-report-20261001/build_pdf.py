from pathlib import Path
import re, html, json
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader

ROOT = Path(__file__).parent
OUT = ROOT.parent / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
PDF = OUT / 'FYB-Functional-QA-Report-20261001.pdf'
source = (ROOT / 'Functional-QA-Report.md').read_text(encoding='utf-8')
pdfmetrics.registerFont(TTFont('ArialQA', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialQABold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('ArialQA', normal='ArialQA', bold='ArialQABold', italic='ArialQA', boldItalic='ArialQABold')
NAVY = colors.HexColor('#143048')
TEAL = colors.HexColor('#157E87')
GRAY = colors.HexColor('#526271')
LIGHT = colors.HexColor('#F0F5F8')
styles = getSampleStyleSheet()
for s in styles.byName.values():
    s.fontName = 'ArialQA'
    s.textColor = NAVY
styles.add(ParagraphStyle(name='BodyQA',fontName='ArialQA',fontSize=10,leading=15,spaceAfter=8))
styles.add(ParagraphStyle(name='SmallQA',fontName='ArialQA',fontSize=9,leading=13,spaceAfter=5))
styles.add(ParagraphStyle(name='CardTitle',fontName='ArialQABold',fontSize=10,leading=14,spaceAfter=5,textColor=NAVY))
styles.add(ParagraphStyle(name='LabelQA',fontName='ArialQABold',fontSize=8,leading=11,textColor=GRAY,spaceAfter=3))
styles['Heading1'].fontName='ArialQABold'; styles['Heading1'].fontSize=20; styles['Heading1'].leading=25; styles['Heading1'].spaceAfter=16
styles['Heading2'].fontName='ArialQABold'; styles['Heading2'].fontSize=13; styles['Heading2'].leading=18; styles['Heading2'].spaceBefore=12; styles['Heading2'].spaceAfter=9
styles['Title'].fontName='ArialQABold'; styles['Title'].fontSize=30; styles['Title'].leading=37; styles['Title'].textColor=NAVY

def markup(s):
    s=s.replace('—','-').replace('–','-').replace('‑','-')
    s=html.escape(s)
    s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',lambda m: m.group(1)+' (evidence appendix)' if m.group(2).endswith('.jpg') else m.group(1),s)
    s=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',s)
    s=re.sub(r'`([^`]+)`',r'<font color="#157E87">\1</font>',s)
    return s.replace('&lt;br/&gt;', '<br/>')

def p(s, style='BodyQA'):
    return Paragraph(markup(s),styles[style])

def card(title, entries, status=None):
    head = title
    if status:
        head += ' | '+status
    parts = [p(head,'CardTitle')]
    data=[]
    for label,body in entries:
        data.append([p(label.upper(),'LabelQA'),p(body,'SmallQA')])
    t=Table(data,colWidths=[92,415],hAlign='LEFT')
    t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,-1),LIGHT),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,-1),0.3,colors.HexColor('#DCE5EB'))]))
    parts += [t,Spacer(1,11)]
    return KeepTogether(parts)

story=[]
story += [Spacer(1,55),p('FYB TECHNOLOGIES','LabelQA'),Paragraph('Functional QA<br/>Report',styles['Title']),Spacer(1,18),p('Website testing - 1 October 2026'),p('https://dev-jira.fybtech.xyz/projects','SmallQA'),Spacer(1,24)]
summary=Table([[p('54','Heading1'),p('2','Heading1'),p('4','Heading1')],[p('Functional checks','SmallQA'),p('Reproduced defects','SmallQA'),p('Follow-up observations','SmallQA')]],colWidths=[169]*3)
summary.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
story += [summary,Spacer(1,24),p('Assessment: further validation required','Heading2'),p('Core workflows passed, but this run does not support an all-functions-correct sign-off. This PDF preserves the complete report, all expected and actual results, remaining coverage, and all seven saved screenshots.'),Spacer(1,20),p('Contents','Heading2'),p('1. Test context and outcome<br/>2. Reproduced defects<br/>3. Observations requiring follow-up<br/>4. All 54 executed checks<br/>5. Retained test data and coverage limitations<br/>6. Recommended next steps<br/>7. Screenshot evidence appendix'),PageBreak()]

lines=source.splitlines(); i=1
while i<len(lines):
    line=lines[i].strip()
    if not line: i+=1; continue
    if line.startswith('## '):
        heading=line[3:]
        if heading=='Evidence files': break
        if heading in ['Reproduced defects','Observations requiring follow-up','Executed functional checks','Test data left for review']:
            story.append(PageBreak())
        story.append(p(heading,'Heading1')); i+=1; continue
    if line.startswith('### '):
        story.append(p(line[4:],'Heading2')); i+=1; continue
    if line.startswith('|'):
        rows=[]
        while i<len(lines) and lines[i].strip().startswith('|'):
            cols=[x.strip() for x in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r'[-:]+',x) for x in cols): rows.append(cols)
            i+=1
        headers=rows.pop(0)
        for row in rows:
            if row[0].startswith('T'):
                story.append(card(row[0]+' - '+row[1],[('Expected',row[2]),('Actual',row[3])],row[4]))
            else:
                story.append(card(row[0],list(zip(headers[1:],row[1:]))))
        continue
    if re.match(r'^\d+\. ',line):
        story.append(p(line,'BodyQA')); i+=1; continue
    if line.startswith('- '):
        story.append(p('• '+line[2:],'BodyQA')); i+=1; continue
    para=[line]
    while i+1<len(lines) and lines[i+1].strip() and not lines[i+1].startswith(('#','|','- ')) and not re.match(r'^\d+\. ',lines[i+1]):
        i+=1;para.append(lines[i].strip())
    story.append(p('<br/>'.join(para).replace('<br/>','\n')).__class__(markup('\n'.join(para)).replace('\n','<br/>'),styles['BodyQA']))
    i+=1

evidence=[('project-created.jpg','E01 - QA project creation','The created QAFYB project is visible in the filtered project directory.'),('issue-lifecycle.jpg','E02 - QA issue lifecycle','SPS-19 after summary, status, priority, assignment, comment and subtask testing.'),('admin-zero-users.jpg','E03 - Admin dashboard (D01)','Dashboard displays zero user totals and unavailable recent-user content.'),('accounts-253-users.jpg','E04 - Account directory (D01)','The matching SuperAdmin account and directory statistics provide the comparison for D01.'),('gantt-invented-epic-dates.jpg','E05 - Gantt date display (D02)','The undated QA epic appears with a concrete Oct 1, 2025 to Oct 1, 2027 schedule.'),('project-overview-counts.jpg','E06 - Project overview (O01)','Overview counts after QA additions. Counting semantics require clarification.'),('global-search-no-result.jpg','E07 - Global search (O03)','Existing issue key entered in global search without a visible search result.')]
for filename,title,caption in evidence:
    story.extend([PageBreak(),p('Screenshot evidence','LabelQA'),p(title,'Heading1'),p(caption),Spacer(1,12)])
    img=Image(str(ROOT/filename))
    scale=min(507/img.imageWidth,600/img.imageHeight)
    img.drawWidth=img.imageWidth*scale;img.drawHeight=img.imageHeight*scale
    story += [img,Spacer(1,12),p('File: '+filename,'SmallQA')]

def footer(canvas,doc):
    w,h=A4
    canvas.setStrokeColor(colors.HexColor('#DCE5EB'));canvas.line(44,40,w-44,40)
    canvas.setFont('ArialQA',8);canvas.setFillColor(GRAY)
    canvas.drawString(44,27,'FYB | Functional QA | 1 October 2026')
    canvas.drawRightString(w-44,27,str(doc.page))
    if doc.page>1:
        canvas.setFont('ArialQA',8);canvas.drawString(44,h-27,'FUNCTIONAL TESTING REPORT')

doc=SimpleDocTemplate(str(PDF),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=49,bottomMargin=55,title='FYB Functional QA Report - 1 October 2026',author='Codex',pageCompression=1)
doc.build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(str(PDF))
text='\n'.join(page.extract_text() for page in reader.pages)
missing=[f'T{x:02}' for x in range(1,55) if f'T{x:02}' not in text]
assert not missing,missing
for key in ['D01','D02','O01','O02','O03','O04','Remaining coverage','253','SPS-20']:
    assert key in text,key
assert len(reader.pages)>=7
(ROOT/'pdf-validation.json').write_text(json.dumps({'pages':len(reader.pages),'all_54_checks_present':not missing,'embedded_images':sum(len(page.images) for page in reader.pages),'pdf':str(PDF)},indent=2))
print(json.dumps({'pages':len(reader.pages),'pdf':str(PDF),'all_checks_present':True}))
try:
    import fitz
    render=ROOT/'rendered';render.mkdir(exist_ok=True)
    fd=fitz.open(str(PDF))
    for n,page in enumerate(fd):
        page.get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(str(render/f'page-{n+1:02}.png'))
    print('Rendered all pages with PyMuPDF')
except ImportError:
    print('PyMuPDF unavailable; use Poppler for rendering')
