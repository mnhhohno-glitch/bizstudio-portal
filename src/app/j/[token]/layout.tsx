import "@fontsource-variable/noto-sans-jp";

export default function JimuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ fontFamily: '"Noto Sans JP Variable", sans-serif' }}>
      {children}
    </div>
  );
}
