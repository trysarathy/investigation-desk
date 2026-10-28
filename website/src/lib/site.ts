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
  headline: "Get paid in digital dollars without the detective work.",
  subline:
    "Clearline is a smart cashier for stablecoin payments. It tells customers exactly how to pay, ticks off correct payments automatically, and explains the wrong ones in plain English, with the reply drafted.",
  description:
    "Clearline is a smart cashier for stablecoin payments: it tells customers exactly how to pay, ticks off correct payments automatically, and explains the wrong ones in plain English. Working demo, seeking design partners.",
};

/** Where "Book a 15-minute call" goes: the booking page if set, otherwise the design-partner form. */
export const bookHref = () => site.meetingUrl || "#design-partners";
