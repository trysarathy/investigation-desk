/** Saves text as a file in the browser. Nothing leaves the device. */
export function download(name: string, text: string, type: string) {
  // Names embed workspace ids, which a hand-edited workspace controls: keep them to safe characters (review nit n3).
  name = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 120) || "clearline-download";
  const blob = new Blob([text], { type: type + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
