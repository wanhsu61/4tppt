import os
import glob
import yaml
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(ROOT, 'templates', 'corporate-roadmap')

print("=== IMAGE DETAILS IN MEDIA ===")
for img_path in sorted(glob.glob(f'{TEMPLATE_DIR}/media/*')):
    name = os.path.basename(img_path)
    im = Image.open(img_path)
    print(f'{name}: format={im.format}, size={im.size}, mode={im.mode}')

print("\n=== USAGES ACROSS PAGES ===")
for page_path in sorted(glob.glob(f'{TEMPLATE_DIR}/pages/*.page')):
    pname = os.path.basename(page_path)
    doc = yaml.safe_load(open(page_path, encoding='utf-8'))
    images = []
    texts = []
    for el in doc.get('elements', []):
        if el.get('elementType') == 'image':
            images.append((el.get('elementId'), el.get('src'), el.get('bounds'), el.get('crop')))
        elif el.get('elementType') == 'text':
            t = el.get('content', {}).get('text', '').replace('\n', ' ').strip()
            texts.append((el.get('elementId'), t[:40]))
    if any('media/image' in str(img) for img in images):
        print(f"\n--- {pname} ---")
        for img in images:
            if 'image1.' not in img[1] and 'image5.' not in img[1] and 'image7.' not in img[1] and 'image15.' not in img[1] and 'image19.' not in img[1]:
                print(f"  IMAGE: {img[0]} -> {img[1]} (bounds: {img[2]}, crop: {img[3]})")
        for t in texts:
            if any(k in t[1] for k in ['李然', '王静', '陈浩', '林雪', '赵磊', '周敏', '孙杰', '张伟', '协作', '战略', '团队', '架构']):
                print(f"  TEXT: {t[0]} -> {t[1]}")
