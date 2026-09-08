import { SaxesParser } from "saxes";

const svgTags=new Set(["svg","g","defs","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","title","desc","clipPath","mask","linearGradient","radialGradient","stop","symbol","use","pattern","marker"]);
const svgAttributes=new Set(["id","xmlns","xmlns:xlink","x","y","x1","y1","x2","y2","width","height","viewBox","preserveAspectRatio","d","points","cx","cy","r","rx","ry","dx","dy","transform","fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","stroke-miterlimit","opacity","clip-path","clip-rule","mask","offset","stop-color","stop-opacity","gradientUnits","gradientTransform","spreadMethod","patternUnits","patternContentUnits","patternTransform","markerWidth","markerHeight","markerUnits","refX","refY","orient","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","href","xlink:href","version","role","aria-label"]);

/** Keep only inert SVG vocabulary; unsupported active/CSS content is rejected, not executed. */
export function validateStaticSvg(bytes:Uint8Array):void {
  if(bytes.byteLength>8*1024*1024)throw new Error("Unsafe SVG: exceeds 8 MB");
  const parser=new SaxesParser({xmlns:true});
  let depth=0,nodes=0;
  parser.on("doctype",()=>{throw new Error("Unsafe SVG: DTD/entity declarations are forbidden");});
  parser.on("processinginstruction",()=>{throw new Error("Unsafe SVG: processing instructions are forbidden");});
  parser.on("opentag",node=>{
    if(++nodes>100_000||++depth>128)throw new Error("Unsafe SVG: complexity limit exceeded");
    if((depth===1&&node.local!=="svg")||!svgTags.has(node.local)||node.uri!=="http://www.w3.org/2000/svg")throw new Error("Unsafe SVG: unsupported element or namespace");
    for(const attr of Object.values(node.attributes)){
      if(!svgAttributes.has(attr.name))throw new Error("Unsafe SVG: unsupported attribute");
      if(attr.name==="xmlns"&&attr.value!=="http://www.w3.org/2000/svg")throw new Error("Unsafe SVG namespace");
      if(attr.name==="xmlns:xlink"&&attr.value!=="http://www.w3.org/1999/xlink")throw new Error("Unsafe SVG namespace");
      if((attr.local==="href")&&!/^#[A-Za-z_][\w.:-]*$/.test(attr.value))throw new Error("Unsafe SVG: only local fragment references are allowed");
      const withoutLocal=attr.value.replace(/url\(\s*["']?#[A-Za-z_][\w.:-]*["']?\s*\)/gi,"");
      if(/url\s*\(|javascript\s*:|expression\s*\(|@import/i.test(withoutLocal))throw new Error("Unsafe SVG: external or active content");
    }
  });
  parser.on("closetag",()=>{depth--;});
  parser.write(new TextDecoder("utf-8",{fatal:true}).decode(bytes)).close();
}

const htmlTags=new Set(["table","thead","tbody","tfoot","tr","td","th","caption","colgroup","col","p","div","span","sub","sup","b","strong","i","em","br","hr","ul","ol","li","blockquote","pre","code"]);
const escape=(text:string)=>text.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
/** Rebuild inert HTML tags with a tiny attribute vocabulary; leave all other markup as text. */
export function inertMarkdownHtml(body:string):string {
  return body.replace(/<[^>]*>/g,tag=>{
    if(/^<(?:__ASSET_PREFIX__|\.\/assets)\/[^\r\n<>"'\\/]+>$/.test(tag))return tag;
    const match=/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)\b([\s\S]*?)\/?\s*>$/.exec(tag);
    if(!match)return escape(tag);
    const name=match[2]!.toLowerCase();
    if(name==="img"&&!match[1]){
      const source=/\bsrc="((?:__ASSET_PREFIX__|\.\/assets)\/[^\r\n<>"'\\/]+)"/.exec(match[3]!);
      if(!source)return escape(tag);
      const alt=/\balt="([^"]*)"/.exec(match[3]!)?.[1]??"";
      return `<img src="${source[1]}" alt="${alt.replaceAll("<","&lt;")}"/>`;
    }
    if(!htmlTags.has(name))return escape(tag);
    if(match[1])return `</${name}>`;
    const spans=[...match[3]!.matchAll(/\b(colspan|rowspan)\s*=\s*["']?(\d{1,3})["']?/gi)].map(part=>` ${part[1]!.toLowerCase()}="${part[2]}"`).join("");
    return `<${name}${spans}>`;
  });
}
