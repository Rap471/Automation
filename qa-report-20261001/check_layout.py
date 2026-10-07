from pathlib import Path
from PIL import Image,ImageOps,ImageDraw
import pdfplumber
r=Path(__file__).parent
pages=sorted(r.glob('page-*.png'))
for start in range(0,len(pages),6):
    chunk=pages[start:start+6]
    sheet=Image.new('RGB',(1080,1100),'#ccd6df')
    draw=ImageDraw.Draw(sheet)
    for i,path in enumerate(chunk):
        img=Image.open(path).convert('RGB')
        img.thumbnail((345,510))
        x=(i%3)*360+7;y=(i//3)*550+28
        sheet.paste(img,(x,y));draw.text((x,y-20),path.stem,fill='black')
    sheet.save(r/f'contact-{start//6+1}.png')
with pdfplumber.open(r.parent/'output/pdf/FYB-Functional-QA-Report-20261001.pdf') as doc:
    for i,p in enumerate(doc.pages):
        body=[c for c in p.chars if c['top']>40 and c['bottom']<800]
        bad=[c for c in body if c['x0']<40 or c['x1']>p.width-40]
        assert not bad,(i+1,bad[:3])
    print('Checked page boundaries; no text outside margins.')
