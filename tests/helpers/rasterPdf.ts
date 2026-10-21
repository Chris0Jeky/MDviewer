import assert from "node:assert/strict";
import { crc32, inflateSync } from "node:zlib";

export interface RasterPdfPage {
  width: number;
  height: number;
  widthPt: number;
  heightPt: number;
  png: Buffer;
}

/**
 * Read the deliberately narrow PDF format emitted by download.ts: classic xref,
 * one opaque 8-bit RGB PNG per page, drawn over the complete MediaBox. Unsupported
 * structures fail rather than silently selecting an unrelated/unused image.
 *
 * jsPDF's FlateDecode + PNG predictor stream already contains PNG scanlines.
 * Rewrapping it lets Chromium's independent PNG decoder inspect the actual saved
 * pixels, without mocking html2canvas or adding a native PDF tool to the E2E lane.
 * This is not a general-purpose PDF reader or a substitute for viewer acceptance.
 */
export function readRasterPdf(pdf: Buffer): RasterPdfPage[] {
  const source = pdf.toString("latin1");
  assert.match(source, /^%PDF-/);
  const end = source.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  assert.ok(end, "PDF has a final cross-reference table");
  const xrefOffset = Number(end[1]);
  const lines = source.slice(xrefOffset).split(/\r?\n/);
  assert.equal(lines[0], "xref", "expected jsPDF's classic xref table");
  const section = lines[1]?.match(/^0 (\d+)$/);
  assert.ok(section, "expected one complete xref section");
  const count = Number(section[1]);
  const offsets = new Map<number, number>();
  for (let id = 1; id < count; id++) {
    const entry = lines[id + 2]?.match(/^(\d{10}) 00000 n\s*$/);
    assert.ok(entry, `xref entry ${id} is in use`);
    offsets.set(id, Number(entry[1]));
  }

  function object(id: number): { dictionary: string; stream?: Buffer } {
    const offset = offsets.get(id);
    assert.ok(offset !== undefined, `object ${id} exists`);
    const limit = Math.min(xrefOffset, ...[...offsets.values()].filter((n) => n > offset));
    const body = source.slice(offset, limit);
    assert.match(body, new RegExp(`^${id} 0 obj\\s`));
    const marker = /\r?\nstream\r?\n/.exec(body);
    if (!marker) return { dictionary: body };
    const dictionary = body.slice(0, marker.index);
    const length = dictionary.match(/\/Length\s+(\d+)\s*(?=\/|>>)/);
    assert.ok(length, `object ${id} has a direct stream length`);
    const start = offset + marker.index + marker[0].length;
    const finish = start + Number(length[1]);
    assert.match(source.slice(finish, limit), /^\r?\nendstream\s+endobj\s*$/);
    return { dictionary, stream: pdf.subarray(start, finish) };
  }

  function reference(dictionary: string, key: string): number {
    const match = dictionary.match(new RegExp(`/${key}\\s+(\\d+) 0 R\\b`));
    assert.ok(match, `PDF /${key} reference exists`);
    return Number(match[1]);
  }

  function integer(dictionary: string, key: string): number {
    const match = dictionary.match(new RegExp(`/${key}\\s+(\\d+)\\b`));
    assert.ok(match, `PDF /${key} integer exists`);
    return Number(match[1]);
  }

  const trailer = source.slice(xrefOffset);
  const catalog = object(reference(trailer, "Root")).dictionary;
  const tree = object(reference(catalog, "Pages")).dictionary;
  const unsupportedPageEffects = /\/(?:CropBox|Rotate|UserUnit|Annots|Group)\b/;
  assert.doesNotMatch(tree, unsupportedPageEffects, "no inherited page display transforms");
  const kids = tree.match(/\/Kids\s*\[([^\]]+)\]/);
  assert.ok(kids, "page tree contains pages");
  const pageIds = [...kids[1]!.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  assert.equal(pageIds.length, integer(tree, "Count"));
  assert.ok(pageIds.length > 0, "PDF contains at least one page");

  return pageIds.map((id) => {
    const page = object(id).dictionary;
    assert.match(page, /\/Type\s*\/Page\b/);
    assert.doesNotMatch(page, unsupportedPageEffects, "no page clipping, rotation or overlays");
    const mediaBox = page.match(/\/MediaBox\s*\[0(?:\.0*)? 0(?:\.0*)? ([\d.]+) ([\d.]+)\]/);
    assert.ok(mediaBox, "page has a portrait MediaBox at the origin");
    const contents = object(reference(page, "Contents"));
    assert.ok(contents.stream, "page content stream exists");
    assert.doesNotMatch(contents.dictionary, /\/Filter\b/, "page operators are uncompressed");
    const commands = contents.stream.toString("latin1");
    const imagePaints = [...commands.matchAll(/q\s+([\d.eE+\- ]+) cm\s+\/(I\d+) Do\s+Q/g)];
    assert.equal(imagePaints.length, 1, "one page-sized image is painted per page");
    assert.equal([...commands.matchAll(/\bDo\b/g)].length, 1, "no unexamined image paint");
    const paint = imagePaints[0]!;
    // jsPDF writes initial line-width/stroke-gray defaults. Reject everything
    // else: a correct image hidden by later vector paint is not visual evidence.
    assert.match(commands.replace(paint[0], ""), /^(?:\s|[\d.eE+-]+\s+[wG])*$/,
      "no other drawing, clipping or graphics-state operators");
    const matrix = paint[1]!.trim().split(/\s+/).map(Number);
    const expected = [Number(mediaBox[1]), 0, 0, Number(mediaBox[2]), 0, 0];
    assert.equal(matrix.length, expected.length);
    matrix.forEach((n, i) => assert.ok(Math.abs(n - expected[i]!) < 0.02,
      "image covers the full paper with no offset, crop, rotation or scaling error"));

    const resources = object(reference(page, "Resources")).dictionary;
    assert.doesNotMatch(resources, /\/DefaultRGB\b/, "no replacement RGB color space");
    const image = object(reference(resources, paint[2]!));
    assert.match(image.dictionary, /\/Subtype\s*\/Image\b/);
    assert.match(image.dictionary, /\/ColorSpace\s*\/DeviceRGB\b/);
    assert.match(image.dictionary, /\/Filter\s*\/FlateDecode\b/);
    assert.doesNotMatch(image.dictionary, /\/(?:SMask|Mask|Decode|ImageMask|OC)\b/,
      "the page image is opaque RGB without additional color/alpha transforms");
    assert.equal(integer(image.dictionary, "BitsPerComponent"), 8);
    assert.equal(integer(image.dictionary, "Colors"), 3);
    const predictor = integer(image.dictionary, "Predictor");
    assert.ok(predictor >= 10 && predictor <= 15, "image uses PNG row predictors");
    const width = integer(image.dictionary, "Width");
    const height = integer(image.dictionary, "Height");
    assert.equal(integer(image.dictionary, "Columns"), width);
    assert.ok(image.stream && width > 0 && height > 0);
    const scanlines = inflateSync(image.stream);
    const stride = width * 3 + 1;
    assert.equal(scanlines.length, height * stride, "all RGB scanlines are present");
    for (let y = 0; y < height; y++) assert.ok(scanlines[y * stride]! <= 4, "valid PNG row filter");

    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2; // PNG truecolor RGB, no alpha.
    return { width, height, widthPt: Number(mediaBox[1]), heightPt: Number(mediaBox[2]), png: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header), chunk("IDAT", image.stream), chunk("IEND", Buffer.alloc(0)),
    ]) };
  });
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}
