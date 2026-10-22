const client = ZAFClient.init();
client.invoke("resize", { width: "100%", height: "520px" });
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = document.getElementById("result");
  out.textContent = "Reading saved evidence…";
  try {
    const metadata = await client.metadata(),
      origin = new URL(metadata.settings.desk_origin);
    if (origin.protocol !== "https:") throw Error("HTTPS desk URL required");
    const result = await client.request({
      url:
        origin.origin +
        "/api/integrations/ticket?q=" +
        encodeURIComponent(document.getElementById("query").value),
      type: "GET",
      headers: { Authorization: "Bearer {{setting.desk_token}}" },
      secure: true,
    });
    out.textContent = [
      result.demo ? "FICTIONAL COMPANY DEMO" : "SAVED INVESTIGATION",
      result.code + " · " + result.verdict,
      "Confidence: " + result.confidence,
      "Checked: " + result.checkedAt,
      result.nextStep,
      "",
      result.replyDraft || "Review required before replying.",
    ].join("\n");
  } catch {
    out.textContent =
      "Evidence unavailable. Check the case ID and installation settings.";
  }
});
