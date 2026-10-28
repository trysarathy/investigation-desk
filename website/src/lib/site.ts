// Everything Aashmiin needs to change lives here (or in environment variables).
export const site = {
  name: "Clearline",
  legalName: "Clearline (pre-launch project)",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://clearline.example",
  meetingUrl: process.env.NEXT_PUBLIC_MEETING_URL || "",
  formspreeId: process.env.NEXT_PUBLIC_FORMSPREE_ID || "",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "",
  linkedin: "https://www.linkedin.com/in/aashmiin-kaur-479665391",
  founder: "Aashmiin Kaur",
  headline: "Stablecoin payments, matched, explained and in your books.",
  subline:
    "Clearline asks for each payment clearly, matches it to its invoice, checks it's genuine, explains anything that went wrong in plain English, and posts it to your accounting system when you approve.",
  description:
    "Clearline asks for each stablecoin payment clearly, matches it to its invoice, checks it's genuine, explains anything that went wrong in plain English, and posts it to your accounting system when you approve. Working demo, seeking design partners.",
};

/** Where "Book a 15-minute call" goes: the booking page if set, otherwise the design-partner form. */
export const bookHref = () => site.meetingUrl || "#design-partners";
