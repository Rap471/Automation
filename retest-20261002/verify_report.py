from pathlib import Path
from PIL import Image,ImageDraw
import pdfplumber,json
root=Path(__file__).parent.parent;d=root/'tmp/pdfs/retest-20261002';files=sorted(d.glob('page-*.png'))
for start in range(0,len(files),6):
 canvas=Image.new('RGB',(1500,1420),'#dbe3ea');draw=ImageDraw.Draw(canvas)
 for i,f in enumerate(files[start:start+6]):
  im=Image.open(f).convert('RGB');im.thumbnail((480,670));x=(i%3)*500+10;y=(i//3)*710+25
  canvas.paste(im,(x,y));draw.text((x,y-20),f'Page{start+i+1}',fill='black')
 canvas.save(d/f'contact-{start//6+1}.jpg')
issues=[];txt=''
with pdfplumber.open(root/'output/pdf/FYB-Three-Role-Retest-20261002.pdf') as pdf:
 for n,p in enumerate(pdf.pages,1):
  txt+=p.extract_text() or ''
  for ch in p.chars:
   if ch['x0']<40 or ch['x1']>p.width-40 or ch['top']<18 or ch['bottom']>p.height-20:issues.append(n)
missing=[f'R{i:03}' for i in range(1,51) if f'R{i:03}' not in txt]
assert not issues,issues
assert not missing,missing
print(json.dumps({'rendered_pages':len(files),'clipped_characters':len(issues),'missing_checks':missing}))
