# PDF visual regression

[[toc]]

## Code, math and document furniture

```typescript
const answer: number = 42;
console.log("Readable syntax", answer);
```

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

- [x] Checked task stays legible
- [ ] Unchecked task stays empty

| Content | Expected output |
| --- | --- |
| Code and equations | Visible on white paper |

<figure style="position:relative;width:408px;height:128px;margin:16px 0;break-inside:avoid">
<div data-raster-probe="hsl" style="position:absolute;left:0;top:0;width:96px;height:48px;background:hsl(210 100% 40%)"></div>
<div data-raster-probe="filter" style="position:absolute;left:104px;top:0;width:96px;height:48px;background:#ff0000;filter:brightness(.5) opacity(.5)"></div>
<div data-raster-probe="linear" style="position:absolute;left:208px;top:0;width:96px;height:48px;background:linear-gradient(to right,#ff0000,#0000ff)"></div>
<div data-raster-probe="radial" style="position:absolute;left:312px;top:0;width:96px;height:48px;background:radial-gradient(circle 20px at center,#008000 0% 40%,#ffffff 70% 100%)"></div>
<div style="position:absolute;left:0;top:64px;width:144px;height:48px"><svg data-raster-probe="svg" xmlns="http://www.w3.org/2000/svg" width="96" height="48" viewBox="0 0 96 48" style="display:block;transform:translateX(32px)"><rect width="96" height="48" fill="#e11d48" /><rect width="48" height="48" fill="#000000" style="visibility:hidden" /><rect x="48" width="48" height="48" fill="#000000" visibility="hidden" /></svg></div>
<div data-raster-probe="stacking" style="position:absolute;left:156px;top:64px;width:96px;height:48px;background:#f59e0b"><div style="position:absolute;left:24px;top:0;width:48px;height:48px;background:#2563eb;z-index:2"></div><div style="position:absolute;left:24px;top:0;width:48px;height:48px;background:#ff0000;z-index:1"></div></div>
</figure>
