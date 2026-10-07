from pathlib import Path
from PIL import Image,ImageDraw
import pdfplumber,json
root=Path(__file__).parent.parent; d=root/'tmp/pdfs/detailed'
files=sorted(d.glob('page-*.png'))
for start in range(0,len(files),8):
 canvas=Image.new('RGB',(1600,1180),'#dbe3ea');draw=ImageDraw.Draw(canvas)
 for i,f in enumerate(files[start:start+8]):
  im=Image.open(f).convert('RGB');im.thumbnail((380,550));x=(i%4)*400+10;y=(i//4)*590+25
  canvas.paste(im,(x,y));draw.text((x,y-20),f'Page {start+i+1}',fill='black')
 canvas.save(d/f'contact-{start//8+1:02}.jpg')
issues=[];text=''
with pdfplumber.open(root/'output/pdf/FYB-Detailed-UI-and-Functions-QA-20261001.pdf') as pdf:
 for n,p in enumerate(pdf.pages,1):
  text+=p.extract_text() or ''
  for ch in p.chars:
   if ch['x0']<40 or ch['x1']>p.width-40 or ch['top']<18 or ch['bottom']>p.height-20:issues.append({'page':n,'text':ch['text']})
missing=[f'U{i:03}' for i in range(1,60) if f'U{i:03}' not in text]
assert not missing,missing
assert not issues,issues[:20]
print(json.dumps({'pages':len(files),'missing_check_ids':missing,'out_of_bounds_characters':len(issues),'contacts':len(list(d.glob('contact-*.jpg')))}))
