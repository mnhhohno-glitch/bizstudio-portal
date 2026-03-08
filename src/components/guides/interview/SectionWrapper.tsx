interface SectionWrapperProps {
  id: string;
  number: string;
  title: string;
  children: React.ReactNode;
  bg?: "white" | "soft" | "navy";
}

const bgClasses = {
  white: "bg-white",
  soft: "bg-[#F4F7F9]",
  navy: "bg-[#003366]",
} as const;

export default function SectionWrapper({
  id,
  number,
  title,
  children,
  bg = "white",
}: SectionWrapperProps) {
  const isNavy = bg === "navy";
  const badgeBg = isNavy ? "bg-[#F39200]" : "bg-[#003366]";

  return (
    <section id={id} className={`py-16 md:py-20 px-4 ${bgClasses[bg]}`}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${badgeBg}`}
          >
            {number}
          </div>
          <h2
            className={`text-xl md:text-2xl font-black leading-tight ${
              isNavy ? "text-white" : "text-[#003366]"
            }`}
          >
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}
