import type { Config } from "tailwindcss";
export default {
 content:["./app/**/*.{ts,tsx}","./components/**/*.{ts,tsx}"],
 theme:{extend:{
  colors:{canvas:"#F5F6F4",ink:"#1B1F1D",pine:"#2E6B4F",sage:"#E3EFE8",amber:"#B7791F",brick:"#B4443B",line:"#DCE2DA",quiet:"#66736B"},
  fontFamily:{sans:["Inter","system-ui","sans-serif"],mono:["JetBrains Mono","monospace"]},
  maxWidth:{site:"1240px"},
  boxShadow:{panel:"0 16px 46px rgba(25,43,31,.06)"},
  keyframes:{enter:{"0%":{opacity:"0",transform:"translateY(14px)"},"100%":{opacity:"1",transform:"translateY(0)"}}},
  animation:{enter:"enter .7s ease-out both"}
 }},
 plugins:[]
} satisfies Config;
