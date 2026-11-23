"""
BIRGSOL Cloud Browser — a real Chromium in the cloud (Hugging Face Space),
driven by the BIRGSOL agent as a FALLBACK when the Chrome extension isn't available.

It mirrors the extension's model: every call returns a `fields` list where each
interactive element has a numeric [ref], so the existing agent BRAIN works unchanged.

Endpoints (all JSON):
  GET  /           -> health
  POST /session    -> {}                         -> {id}
  POST /goto       -> {id,url}                    -> look()
  POST /look       -> {id}                        -> look()
  POST /act        -> {id,action,ref,text,dir,key}-> look()   (action: click|type|select|scroll|key)
  POST /read       -> {id}                        -> {text,url,title}
  POST /close      -> {id}                        -> {ok}

look() = {ok, fields:[{ref,kind,label,value?,checked?}], screenshot, url, title, text}
`screenshot` is a JPEG data-URL of the current 1280x800 viewport.
"""
import base64
import time
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from playwright.async_api import async_playwright

app = FastAPI(title="BIRGSOL Cloud Browser")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

_pw = None
_browser = None
SESSIONS = {}            # id -> {"page","context","ts"}
SESSION_TTL = 600
MAX_SESSIONS = 6
VIEWPORT = {"width": 1280, "height": 800}

# Injected in the page: tag every visible interactive element with data-bref="N"
# and return the fields list the agent brain understands.
_LOOK_JS = r"""
() => {
  document.querySelectorAll('[data-bref]').forEach(e => e.removeAttribute('data-bref'));
  const sel = 'a[href],button,input,textarea,select,[role=button],[role=link],' +
              '[role=checkbox],[role=tab],[role=menuitem],[onclick],' +
              '[contenteditable=""],[contenteditable=true]';
  const els = Array.from(document.querySelectorAll(sel));
  const vh = innerHeight, vw = innerWidth, fields = [];
  let n = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue;
    n++;
    el.setAttribute('data-bref', String(n));
    const tag = el.tagName.toLowerCase();
    let kind = tag;
    if (tag === 'a') kind = 'link';
    else if (tag === 'button' || el.getAttribute('role') === 'button') kind = 'button';
    else if (tag === 'input') kind = (el.type || 'text');
    else if (tag === 'textarea') kind = 'textbox';
    else if (tag === 'select') kind = 'select';
    const label = (el.innerText || el.value || el.getAttribute('aria-label') ||
                   el.getAttribute('placeholder') || el.getAttribute('title') ||
                   el.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const f = { ref: n, kind: kind, label: label };
    if (tag === 'input' || tag === 'textarea' || tag === 'select') f.value = (el.value || '').slice(0, 80);
    if (el.type === 'checkbox' || el.type === 'radio') f.checked = !!el.checked;
    fields.push(f);
    if (n >= 60) break;
  }
  return { fields: fields, title: document.title, url: location.href,
           text: (document.body ? document.body.innerText.slice(0, 3000) : '') };
}
"""


async def _ensure_browser():
    global _pw, _browser
    if _browser is None:
        _pw = await async_playwright().start()
        _browser = await _pw.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
    return _browser


async def _reap():
    now = time.time()
    for sid in [s for s, v in SESSIONS.items() if now - v["ts"] > SESSION_TTL]:
        try:
            await SESSIONS[sid]["context"].close()
        except Exception:
            pass
        SESSIONS.pop(sid, None)


def _touch(sid):
    if sid in SESSIONS:
        SESSIONS[sid]["ts"] = time.time()


async def _shot(page) -> str:
    try:
        b = await page.screenshot(type="jpeg", quality=55, full_page=False)
        return "data:image/jpeg;base64," + base64.b64encode(b).decode()
    except Exception:
        return ""


async def _look(page, ok=True, error=None) -> dict:
    """Return the shape the agent brain + _agLook expect."""
    data = {"fields": [], "title": "", "url": "", "text": ""}
    try:
        data = await page.evaluate(_LOOK_JS)
    except Exception:
        try:
            data["url"] = page.url
            data["title"] = await page.title()
        except Exception:
            pass
    out = {
        "ok": ok,
        "acted": ok,
        "fields": data.get("fields", []),
        "title": data.get("title", ""),
        "url": data.get("url", "") or page.url,
        "text": data.get("text", ""),
        "screenshot": await _shot(page),
    }
    if error:
        out["error"] = str(error)[:200]
    return out


def _el(page, ref):
    return page.locator('[data-bref="%s"]' % int(ref))


class GotoReq(BaseModel):
    id: str
    url: str


class ActReq(BaseModel):
    id: str
    action: str
    ref: Optional[int] = None
    text: Optional[str] = None
    dir: Optional[str] = None
    key: Optional[str] = None


class IdReq(BaseModel):
    id: str


@app.get("/")
async def health():
    return {"ok": True, "service": "birgsol-cloud-browser", "sessions": len(SESSIONS)}


@app.post("/session")
async def session():
    await _reap()
    if len(SESSIONS) >= MAX_SESSIONS:
        raise HTTPException(429, "Too many live sessions, try again shortly")
    br = await _ensure_browser()
    ctx = await br.new_context(viewport=VIEWPORT, locale="he-IL", user_agent=_UA)
    page = await ctx.new_page()
    sid = uuid.uuid4().hex[:12]
    SESSIONS[sid] = {"page": page, "context": ctx, "ts": time.time()}
    return {"id": sid}


@app.post("/goto")
async def goto(r: GotoReq):
    s = SESSIONS.get(r.id)
    if not s:
        raise HTTPException(404, "no session")
    _touch(r.id)
    page = s["page"]
    url = r.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        await page.wait_for_timeout(900)
        return await _look(page)
    except Exception as e:
        return await _look(page, error=e)


@app.post("/look")
async def look(r: IdReq):
    s = SESSIONS.get(r.id)
    if not s:
        raise HTTPException(404, "no session")
    _touch(r.id)
    return await _look(s["page"])


@app.post("/act")
async def act(r: ActReq):
    s = SESSIONS.get(r.id)
    if not s:
        raise HTTPException(404, "no session")
    _touch(r.id)
    page = s["page"]
    a = (r.action or "").lower()
    try:
        if a == "click":
            loc = _el(page, r.ref)
            try:
                await loc.click(timeout=6000)
            except Exception:
                await loc.evaluate("el => el.click()")
        elif a == "type":
            loc = _el(page, r.ref)
            try:
                await loc.fill(r.text or "", timeout=6000)
            except Exception:
                await loc.click(timeout=4000)
                await page.keyboard.type(r.text or "", delay=20)
        elif a == "select":
            loc = _el(page, r.ref)
            try:
                await loc.select_option(label=r.text or "")
            except Exception:
                await loc.select_option(value=r.text or "")
        elif a == "scroll":
            dy = -600 if (r.dir or "down") == "up" else 600
            await page.mouse.wheel(0, dy)
        elif a == "key":
            await page.keyboard.press(r.key or r.text or "Enter")
        else:
            return await _look(page, error="unknown action: " + str(r.action))
        await page.wait_for_timeout(750)
        return await _look(page)
    except Exception as e:
        return await _look(page, error=e)


@app.post("/read")
async def read(r: IdReq):
    s = SESSIONS.get(r.id)
    if not s:
        raise HTTPException(404, "no session")
    _touch(r.id)
    page = s["page"]
    try:
        txt = await page.evaluate("() => document.body ? document.body.innerText.slice(0,4000) : ''")
    except Exception:
        txt = ""
    title = ""
    try:
        title = await page.title()
    except Exception:
        pass
    return {"text": txt, "url": page.url, "title": title}


@app.post("/close")
async def close(r: IdReq):
    s = SESSIONS.pop(r.id, None)
    if s:
        try:
            await s["context"].close()
        except Exception:
            pass
    return {"ok": True}
