import io
from types import SimpleNamespace
import pytest
from app import ocr, pipeline
from app.ocr import _to_lines


class Page:
    width = 600
    height = 800
    images = []
    edges = []
    def __init__(self, text='', rows=None): self.text, self.rows = text, rows
    def extract_text(self): return self.text
    def extract_words(self, **_):
        return [{'text': t, 'x0': 50 * j, 'x1': 50 * j + 40, 'top': 100 + 12 * i, 'bottom': 110 + 12 * i}
                for i, line in enumerate(self.text.splitlines()) for j, t in enumerate(line.split())]
    def find_tables(self):
        return [SimpleNamespace(bbox=(0,100,600,400),extract=lambda:self.rows)] if self.rows else []
    def filter(self, predicate): return Page('流水号：OA-1234')


class Pdf:
    def __init__(self,pages): self.pages=pages
    def __enter__(self): return self
    def __exit__(self,*args): pass


def pdf(monkeypatch,pages):
    import pdfplumber
    monkeypatch.setattr(pdfplumber,'open',lambda _:Pdf(pages))


@pytest.mark.anyio
async def test_table_branch_preserves_unknown(monkeypatch):
    pdf(monkeypatch,[Page(rows=[['品名','数量'],['签字笔','2'],['荧光笔','']])])
    result=await pipeline.parse_pdf(b'pdf')
    assert [(i['itemName'],i['quantity']) for i in result['items']]==[('签字笔',2),('荧光笔',None)]
    assert result['pages'][0]['status']=='DONE'


@pytest.mark.anyio
async def test_mixed_pages_and_no_double_count(monkeypatch):
    pdf(monkeypatch,[Page('签字笔 2'),Page('')])
    calls=[]
    async def ocr(data,index):
        calls.append(index)
        return [{'text':'订书机 4','box':None}]
    monkeypatch.setattr(pipeline,'ocr_pdf_page',ocr)
    result=await pipeline.parse_pdf(b'pdf')
    assert calls==[1]
    assert [i['quantity'] for i in result['items']]==[2,4]
    assert [i['source']['page'] for i in result['items']]==[1,2]


@pytest.mark.anyio
async def test_page_failure_is_visible_and_other_page_survives(monkeypatch):
    pdf(monkeypatch,[Page('签字笔 2'),Page('')])
    async def fail(*args): raise RuntimeError('bad scan')
    monkeypatch.setattr(pipeline,'ocr_pdf_page',fail)
    result=await pipeline.parse_pdf(b'pdf')
    assert result['items'][0]['quantity']==2
    assert result['pages'][1]['status']=='FAILED'


@pytest.mark.anyio
async def test_over_limit_rejected_before_processing(monkeypatch):
    pdf(monkeypatch,[Page('签字笔 2')]*31)
    with pytest.raises(ValueError,match='拆分'): await pipeline.parse_pdf(b'pdf')


def test_result_adapter_restores_normalized_coordinates():
    item=SimpleNamespace(json={'res':{'rec_texts':['物品'],'rec_scores':[.9],'rec_polys':[[[10,20],[30,20],[30,40],[10,40]]],'doc_preprocessor_res':{'angle':90}}})
    result=_to_lines([item],100,200)[0]
    assert result['box'][0]==[.8,.05]
    assert result['rotation']==90


def _image(fmt, exif=None, size=(300, 100), color=(200, 60, 60)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new('RGB', size, color).save(buf, format=fmt, **({'exif': exif} if exif is not None else {}))
    buf.seek(0)
    return Image.open(buf)


def test_photos_are_turned_upright_grayed_and_stretched_before_ocr(monkeypatch):
    from PIL import Image
    exif = Image.Exif()
    exif[0x0112] = 6
    photo = ocr.prepare_image(_image('JPEG', exif, (4000, 100)))
    assert photo.size == (64, 2560)
    r, g, b = photo.getpixel((10, 10))
    assert r == g == b  # 灰度，三通道相同
    shot = ocr.prepare_image(_image('PNG'))
    assert shot.getpixel((10, 10)) == (200, 60, 60)  # 截图不改颜色
    monkeypatch.setattr(ocr, 'PHOTO_PREPROCESS', False)
    assert len(set(ocr.prepare_image(_image('JPEG')).getpixel((10, 10)))) > 1  # 关掉开关后照片保留颜色


@pytest.fixture
def anyio_backend(): return 'asyncio'
