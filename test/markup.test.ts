import test from "node:test";
import assert from "node:assert/strict";
import { inertMarkdownHtml, validateStaticSvg } from "../src/storage/markup.js";

test("SVG keeps static geometry and rejects active, external, and entity content",()=>{
  const svg=(body:string)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  validateStaticSvg(svg('<path d="M0 0L1 1" stroke="black"/>'));
  for(const body of ['<script>alert(1)</script>','<foreignObject/>','<path onload="alert(1)"/>','<use href="https://example.org/image.svg"/>','<path fill="url(https://example.org/image.svg)"/>','<use href="javascript&#58;alert(1)"/>'])assert.throws(()=>validateStaticSvg(svg(body)));
  assert.throws(()=>validateStaticSvg(Buffer.from('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')),/DTD/);
});

test("raw HTML retains table structure but cannot carry scripts or event handlers",()=>{
  const output=inertMarkdownHtml('<table onclick="bad()"><tr><td colspan="2" style="background:url(https://example.org)">value</td></tr></table><script>alert(1)</script>');
  assert.match(output,/<td colspan="2">value<\/td>/);
  assert.doesNotMatch(output,/<script|onclick=|style=/);
  assert.match(output,/&lt;script&gt;/);
});
