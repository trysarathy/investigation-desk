import type { Config } from "tailwindcss";
export default {
 content:["./app/**/*.{ts,tsx}","./components/**/*.{ts,tsx}"],
 theme:{extend:{
  colors:{canvas:"#F5F1E8",ink:"#17212D",pine:"#D04B31",sage:"#F8E4D8",amber:"#A4621A",brick:"#AD3D32",line:"#DED6C9",quiet:"#63707A"},
  fontFamily:{sans:["Inter","system-ui","sans-serif"],mono:["JetBrains Mono","monospace"]},
  maxWidth:{site:"1240px"},
  boxShadow:{panel:"0 16px 46px rgba(25,43,31,.06)"},
  keyframes:{enter:{"0%":{opacity:"0",transform:"translateY(14px)"},"100%":{opacity:"1",transform:"translateY(0)"}}},
  animation:{enter:"enter .7s ease-out both"}
 }},
 plugins:[]
} satisfies Config;
