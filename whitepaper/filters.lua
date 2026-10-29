-- statusbox divs become a tcolorbox; .vtag/.atag/.gtag spans become coloured labels (review copy only).
function Div(el)
  if el.classes:includes("statusbox") then
    local out = { pandoc.RawBlock("latex", "\\begin{statusbox}") }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, pandoc.RawBlock("latex", "\\end{statusbox}"))
    return out
  end
end
function Span(el)
  for _, c in ipairs({"vtag", "atag", "gtag"}) do
    if el.classes:includes(c) then
      local out = { pandoc.RawInline("latex", "\\" .. c .. "{") }
      for _, i in ipairs(el.content) do table.insert(out, i) end
      table.insert(out, pandoc.RawInline("latex", "}"))
      return out
    end
  end
end
-- keep headings with what follows (titlesec's own protection does not cover longtable)
function Header(el)
  local n = el.level == 1 and 8 or 5
  return { pandoc.RawBlock("latex", "\\needspace{" .. n .. "\\baselineskip}"), el }
end
