import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Partners } from "@/components/Partners";
import { Problem } from "@/components/Problem";
import { WhyNow } from "@/components/WhyNow";
import { BuiltFor, Demo, Faq, FinalCta, Trust } from "@/components/Sections";
import { Footer, Header, Motion } from "@/components/ui";

export default function Home() {
  return (
    <Motion>
      <Header />
      <main id="main">
        <Hero />
        <Demo />
        <Problem />
        <HowItWorks />
        <BuiltFor />
        <WhyNow />
        <Trust />
        <Partners />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </Motion>
  );
}
